import type { CellLayer, FitMode, FrameDescriptor, Layer, Renderer, Shot } from '../types';
import {
  backdropPlacement,
  blurKey,
  blurSize,
  cellGeometry,
  isFullFrameCell,
  parseHex,
  placePhoto,
} from './layout';
import type { TransitionProgramSpec } from './transitionSpec';
import { transitionPrograms } from './transitions/index';

export interface RendererStats {
  /** Resident photo textures. */
  photoTextures: number;
  /** Cached blurred backgrounds (one per photo per frame/cell size). */
  blurCaches: number;
  /** Whether the cell scratch target (multi-photo shots) is allocated. */
  cellScratch: boolean;
  width: number;
  height: number;
  contextLost: boolean;
}

export interface MontageRenderer extends Renderer {
  stats(): RendererStats;
  isContextLost(): boolean;
  /** Notified when the GL context is lost / restored. After 'restored', all photo textures are gone: re-call setPhoto. */
  onContextEvent(cb: (e: 'lost' | 'restored') => void): void;
}

const VERT = `#version 300 es
out vec2 vUv; // GL orientation (y up) 0..1
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Draws a textured rect (photo or blurred bg). Output pixel p (top-left origin) -> uv inside rect. */
const PHOTO_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform vec2 uSize;
uniform float uDim;
uniform float uFlipY;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 uv = (p - uCenter) / uSize + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  if (uFlipY > 0.5) uv.y = 1.0 - uv.y;
  outColor = vec4(texture(uTex, uv).rgb * uDim, 1.0);
}`;

const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir; // texel step along axis
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = -8; i <= 8; i++) {
    float f = float(i);
    float w = exp(-f * f / 32.0); // sigma = 4 taps
    acc += texture(uTex, vUv + uDir * f).rgb * w;
    wsum += w;
  }
  outColor = vec4(acc / wsum, 1.0);
}`;

const TRANSITION_HEADER = `#version 300 es
precision highp float;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uProgress;
uniform vec2 uRes;
uniform vec3 uBackground;
in vec2 vUv;
out vec4 outColor;
vec4 texFrom(vec2 uv) { return texture(uFrom, vec2(uv.x, 1.0 - uv.y)); }
vec4 texTo(vec2 uv) { return texture(uTo, vec2(uv.x, 1.0 - uv.y)); }
`;
const TRANSITION_FOOTER = `
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  outColor = vec4(transition(uv, uProgress).rgb, 1.0);
}`;

/**
 * Composites one rendered cell (sub-rect of the cell scratch texture) as a rotated, scaled card with a
 * signed-distance edge (~1px anti-aliasing, no MSAA), optional white polaroid frame and analytic soft shadow.
 * Positions are output pixels, top-left origin; local = card-centred, unrotated.
 */
const COMPOSITE_VERT = `#version 300 es
uniform vec2 uRes;
uniform vec2 uCenter;
uniform vec2 uQuadHalf;
uniform float uRot;
out vec2 vLocal;
void main() {
  int i = gl_VertexID;
  // two triangles: (0,1,2) (2,1,3) over corners (-1,-1) (1,-1) (-1,1) (1,1)
  int k = i < 3 ? i : (i == 3 ? 2 : (i == 4 ? 1 : 3));
  vec2 corner = vec2(float(k & 1) * 2.0 - 1.0, float((k >> 1) & 1) * 2.0 - 1.0);
  vec2 local = corner * uQuadHalf;
  float c = cos(uRot), s = sin(uRot);
  vec2 p = uCenter + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vLocal = local;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexScale;   // content size / scratch size
uniform vec2 uTexMax;     // clamp (half a texel inside the content)
uniform vec2 uCardHalf;
uniform vec2 uPhotoOff;
uniform vec2 uPhotoHalf;
uniform float uAlpha;
uniform float uShadowBlur;
uniform float uShadowOffset;
uniform float uShadowOpacity;
in vec2 vLocal;
out vec4 outColor;
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
void main() {
  float dCard = sdBox(vLocal, uCardHalf);
  float card = clamp(0.5 - dCard, 0.0, 1.0);
  vec2 q = vLocal - uPhotoOff;
  float photo = clamp(0.5 - sdBox(q, uPhotoHalf), 0.0, 1.0);
  vec2 uv = q / (2.0 * uPhotoHalf) + 0.5; // 0..1, top-left origin
  vec2 st = clamp(vec2(uv.x, 1.0 - uv.y) * uTexScale, vec2(0.0), uTexMax);
  vec3 rgb = mix(vec3(1.0), texture(uTex, st).rgb, photo);
  float shadow = 0.0;
  if (uShadowOpacity > 0.0) {
    float dS = sdBox(vLocal - vec2(0.0, uShadowOffset), uCardHalf);
    shadow = uShadowOpacity * (1.0 - smoothstep(-uShadowBlur, uShadowBlur, dS));
  }
  float a = card + shadow * (1.0 - card);
  outColor = vec4(rgb * card, a) * uAlpha; // premultiplied
}`;

const BLUR_DARKEN = 0.55;
const BLUR_STEP = 2; // texel spacing of taps

type Gl = WebGL2RenderingContext;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

interface Prog {
  p: WebGLProgram;
  u: Map<string, WebGLUniformLocation | null>;
}
interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}
interface PhotoTex {
  tex: WebGLTexture;
  w: number;
  h: number;
}

export function createRenderer(canvas: AnyCanvas): MontageRenderer {
  const getGl = () =>
    (canvas as HTMLCanvasElement).getContext('webgl2', {
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
      depth: false,
      stencil: false,
    }) as Gl | null;
  const gl = getGl();
  if (!gl) throw new Error('WebGL2 is not available');

  let width = canvas.width || 1;
  let height = canvas.height || 1;
  let bg: [number, number, number] = [0, 0, 0];
  let lost = false;
  let disposed = false;
  let listener: ((e: 'lost' | 'restored') => void) | null = null;

  let photos = new Map<number, PhotoTex>();
  /** photoIndex -> blurKey(frame or cell size) -> blurred cover. */
  let blurCache = new Map<number, Map<string, Target>>();
  let scratch: Target | null = null; // blur ping-pong
  let cellScratch: Target | null = null; // output-sized; a cell renders into its bottom-left sub-rect
  let layerA: Target | null = null;
  let layerB: Target | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let photoProg: Prog;
  let blurProg: Prog;
  let compositeProg: Prog;
  let transProgs = new Map<string, Prog>();

  function compile(type: number, src: string): WebGLShader {
    const s = gl!.createShader(type)!;
    gl!.shaderSource(s, src);
    gl!.compileShader(s);
    if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
      const log = gl!.getShaderInfoLog(s);
      gl!.deleteShader(s);
      throw new Error(`Shader compile failed: ${log}`);
    }
    return s;
  }
  function program(frag: string, vert = VERT): Prog {
    const g = gl!;
    const p = g.createProgram()!;
    const vs = compile(g.VERTEX_SHADER, vert);
    const fs = compile(g.FRAGMENT_SHADER, frag);
    g.attachShader(p, vs);
    g.attachShader(p, fs);
    g.linkProgram(p);
    g.deleteShader(vs);
    g.deleteShader(fs);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) {
      const log = g.getProgramInfoLog(p);
      g.deleteProgram(p);
      throw new Error(`Program link failed: ${log}`);
    }
    return { p, u: new Map() };
  }
  function loc(pr: Prog, name: string): WebGLUniformLocation | null {
    if (!pr.u.has(name)) pr.u.set(name, gl!.getUniformLocation(pr.p, name));
    return pr.u.get(name) ?? null;
  }

  function initResources() {
    vao = gl!.createVertexArray();
    photoProg = program(PHOTO_FRAG);
    blurProg = program(BLUR_FRAG);
    compositeProg = program(COMPOSITE_FRAG, COMPOSITE_VERT);
    transProgs = new Map();
  }
  initResources();

  function makeTarget(w: number, h: number): Target {
    const g = gl!;
    const tex = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, tex);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    const fbo = g.createFramebuffer()!;
    g.bindFramebuffer(g.FRAMEBUFFER, fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }
  function freeTarget(t: Target | null) {
    if (!t) return;
    gl!.deleteFramebuffer(t.fbo);
    gl!.deleteTexture(t.tex);
  }
  function freeBlurCache() {
    for (const m of blurCache.values()) for (const t of m.values()) freeTarget(t);
    blurCache.clear();
    freeTarget(scratch);
    scratch = null;
  }
  function freeCellScratch() {
    freeTarget(cellScratch);
    cellScratch = null;
  }
  function freeLayerTargets() {
    freeTarget(layerA);
    freeTarget(layerB);
    layerA = layerB = null;
  }

  function bindTarget(t: Target | null, w: number, h: number) {
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, t ? t.fbo : null);
    gl!.viewport(0, 0, w, h);
  }
  function bindTex(unit: number, tex: WebGLTexture) {
    gl!.activeTexture(gl!.TEXTURE0 + unit);
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
  }
  function clear(c: [number, number, number]) {
    gl!.clearColor(c[0], c[1], c[2], 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
  }
  function fullscreen() {
    gl!.bindVertexArray(vao);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  function drawRect(
    tex: WebGLTexture,
    fw: number,
    fh: number,
    r: { cx: number; cy: number; w: number; h: number },
    dim: number,
    flipY: boolean,
  ) {
    const g = gl!;
    g.useProgram(photoProg.p);
    bindTex(0, tex);
    g.uniform1i(loc(photoProg, 'uTex'), 0);
    g.uniform2f(loc(photoProg, 'uRes'), fw, fh);
    g.uniform2f(loc(photoProg, 'uCenter'), r.cx, r.cy);
    g.uniform2f(loc(photoProg, 'uSize'), r.w, r.h);
    g.uniform1f(loc(photoProg, 'uDim'), dim);
    g.uniform1f(loc(photoProg, 'uFlipY'), flipY ? 1 : 0);
    fullscreen();
  }

  function blurredBackground(
    index: number,
    ph: PhotoTex,
    focus: { x: number; y: number },
    fw: number,
    fh: number,
  ): Target {
    const key = blurKey(fw, fh);
    let perPhoto = blurCache.get(index);
    const cached = perPhoto?.get(key);
    if (cached) return cached;
    const g = gl!;
    const { w, h } = blurSize(fw, fh);
    const out = makeTarget(w, h);
    if (!scratch || scratch.w !== w || scratch.h !== h) {
      freeTarget(scratch);
      scratch = makeTarget(w, h);
    }
    g.disable(g.BLEND);
    // 1: cover copy at reduced resolution
    bindTarget(out, w, h);
    clear([0, 0, 0]);
    const r = placePhoto(ph.w, ph.h, w, h, 'cover', focus, { scale: 1, tx: 0, ty: 0 });
    drawRect(ph.tex, w, h, r, 1, false);
    // 2: horizontal, 3: vertical
    g.useProgram(blurProg.p);
    g.uniform1i(loc(blurProg, 'uTex'), 0);
    bindTarget(scratch, w, h);
    bindTex(0, out.tex);
    g.uniform2f(loc(blurProg, 'uDir'), BLUR_STEP / w, 0);
    fullscreen();
    bindTarget(out, w, h);
    bindTex(0, scratch.tex);
    g.uniform2f(loc(blurProg, 'uDir'), 0, BLUR_STEP / h);
    fullscreen();
    if (!perPhoto) {
      perPhoto = new Map();
      blurCache.set(index, perPhoto);
    }
    perPhoto.set(key, out);
    return out;
  }

  /**
   * Draw one layer into `target` (null = canvas) whose frame is fw x fh pixels, without clearing. With
   * fw x fh = output size this is exactly v1's single-layer drawing (the invariant-1 fast path).
   */
  function drawLayer(layer: Layer, target: Target | null, fw: number, fh: number) {
    bindTarget(target, fw, fh);
    const ph = photos.get(layer.photoIndex);
    if (!ph) return;
    const fit: FitMode = layer.fit;
    if (fit === 'blur') {
      const b = blurredBackground(layer.photoIndex, ph, layer.focus, fw, fh);
      bindTarget(target, fw, fh); // blurredBackground rebinds
      drawRect(b.tex, fw, fh, backdropPlacement(fw, fh, layer.focus, layer.transform), BLUR_DARKEN, true);
      drawRect(
        ph.tex,
        fw,
        fh,
        placePhoto(ph.w, ph.h, fw, fh, 'contain', layer.focus, layer.transform),
        1,
        false,
      );
    } else {
      drawRect(ph.tex, fw, fh, placePhoto(ph.w, ph.h, fw, fh, fit, layer.focus, layer.transform), 1, false);
    }
  }

  /** Full-frame blurred, darkened cover of the shot's backdrop photo, following its transform. */
  function drawBackdrop(layer: Layer, target: Target | null) {
    const ph = photos.get(layer.photoIndex);
    if (!ph) return;
    const b = blurredBackground(layer.photoIndex, ph, layer.focus, width, height);
    bindTarget(target, width, height);
    drawRect(
      b.tex,
      width,
      height,
      backdropPlacement(width, height, layer.focus, layer.transform),
      BLUR_DARKEN,
      true,
    );
  }

  /** General path: render the cell's content at its own pixel size, then composite it as one card. */
  function drawCell(cell: CellLayer, target: Target | null) {
    if (!photos.has(cell.photoIndex)) return;
    const g = gl!;
    const geo = cellGeometry(cell, width, height);
    if (!cellScratch || cellScratch.w !== width || cellScratch.h !== height) {
      freeCellScratch();
      cellScratch = makeTarget(width, height);
    }
    const cw = Math.min(geo.contentW, width);
    const ch = Math.min(geo.contentH, height);
    bindTarget(cellScratch, cw, ch);
    clear(bg);
    drawLayer(cell, cellScratch, cw, ch);

    bindTarget(target, width, height);
    const pr = compositeProg;
    g.useProgram(pr.p);
    bindTex(0, cellScratch.tex);
    g.uniform1i(loc(pr, 'uTex'), 0);
    g.uniform2f(loc(pr, 'uRes'), width, height);
    g.uniform2f(loc(pr, 'uCenter'), geo.cx, geo.cy);
    g.uniform2f(loc(pr, 'uQuadHalf'), geo.quadHalfW, geo.quadHalfH);
    g.uniform1f(loc(pr, 'uRot'), geo.rotation);
    g.uniform2f(loc(pr, 'uTexScale'), cw / width, ch / height);
    g.uniform2f(loc(pr, 'uTexMax'), (cw - 0.5) / width, (ch - 0.5) / height);
    g.uniform2f(loc(pr, 'uCardHalf'), geo.cardHalfW, geo.cardHalfH);
    g.uniform2f(loc(pr, 'uPhotoOff'), geo.photoOffX, geo.photoOffY);
    g.uniform2f(loc(pr, 'uPhotoHalf'), geo.photoHalfW, geo.photoHalfH);
    g.uniform1f(loc(pr, 'uAlpha'), geo.alpha);
    g.uniform1f(loc(pr, 'uShadowBlur'), Math.max(geo.shadowBlur, 1e-3));
    g.uniform1f(loc(pr, 'uShadowOffset'), geo.shadowOffset);
    g.uniform1f(loc(pr, 'uShadowOpacity'), geo.shadowOpacity);
    g.enable(g.BLEND);
    // premultiplied over; keep destination alpha (targets are opaque)
    g.blendFuncSeparate(g.ONE, g.ONE_MINUS_SRC_ALPHA, g.ZERO, g.ONE);
    g.bindVertexArray(vao);
    g.drawArrays(g.TRIANGLES, 0, 6);
    g.disable(g.BLEND);
  }

  /** Composite a whole shot into `target` (null = canvas): background, backdrop, then cells back to front. */
  function renderShot(shot: Shot, target: Target | null) {
    bindTarget(target, width, height);
    clear(bg);
    if (shot.backdrop) drawBackdrop(shot.backdrop, target);
    for (const cell of shot.cells) {
      if (!(cell.reveal > 0)) continue;
      if (isFullFrameCell(cell)) drawLayer(cell, target, width, height);
      else drawCell(cell, target);
    }
  }

  function transitionProgram(style: string, spec: TransitionProgramSpec): Prog {
    let p = transProgs.get(style);
    if (!p) {
      p = program(`${TRANSITION_HEADER}\n${spec.fragment}\n${TRANSITION_FOOTER}`);
      transProgs.set(style, p);
    }
    return p;
  }

  function draw(frame: FrameDescriptor) {
    if (lost || disposed) return;
    const g = gl!;
    g.disable(g.BLEND);
    g.disable(g.DEPTH_TEST);
    if (frame.kind === 'single') {
      renderShot(frame.shot, null);
      return;
    }
    let spec = transitionPrograms[frame.style];
    let key: string = frame.style;
    if (!spec) {
      spec = transitionPrograms.crossfade!;
      key = 'crossfade';
    }
    if (!layerA || layerA.w !== width || layerA.h !== height) {
      freeLayerTargets();
      layerA = makeTarget(width, height);
      layerB = makeTarget(width, height);
    }
    renderShot(frame.from, layerA);
    renderShot(frame.to, layerB!);
    const pr = transitionProgram(key, spec);
    bindTarget(null, width, height);
    g.useProgram(pr.p);
    bindTex(0, layerA.tex);
    bindTex(1, layerB!.tex);
    g.uniform1i(loc(pr, 'uFrom'), 0);
    g.uniform1i(loc(pr, 'uTo'), 1);
    const progress = Math.min(1, Math.max(0, frame.progress));
    g.uniform1f(loc(pr, 'uProgress'), progress);
    g.uniform2f(loc(pr, 'uRes'), width, height);
    g.uniform3f(loc(pr, 'uBackground'), bg[0], bg[1], bg[2]);
    if (spec.uniforms) {
      for (const [name, v] of Object.entries(spec.uniforms({ width, height, progress }))) {
        const l = loc(pr, name);
        if (!l) continue;
        if (typeof v === 'number') g.uniform1f(l, v);
        else if (v.length === 2) g.uniform2f(l, v[0] ?? 0, v[1] ?? 0);
        else if (v.length === 3) g.uniform3f(l, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
        else if (v.length === 4) g.uniform4f(l, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0);
        else if (v.length === 1) g.uniform1f(l, v[0] ?? 0);
      }
    }
    fullscreen();
    bindTex(1, layerA.tex); // leave units bound to harmless textures
  }

  function deletePhoto(index: number) {
    const old = photos.get(index);
    if (old) {
      gl!.deleteTexture(old.tex);
      photos.delete(index);
    }
    const b = blurCache.get(index);
    if (b) {
      for (const t of b.values()) freeTarget(t);
      blurCache.delete(index);
    }
  }

  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    listener?.('lost');
  };
  const onRestored = () => {
    // All GL objects were invalidated; rebuild shared resources. Photos must be re-supplied by the caller.
    photos = new Map();
    blurCache = new Map();
    scratch = cellScratch = layerA = layerB = null;
    initResources();
    lost = false;
    listener?.('restored');
  };
  canvas.addEventListener('webglcontextlost', onLost as EventListener);
  canvas.addEventListener('webglcontextrestored', onRestored as EventListener);

  return {
    setSize(w, h) {
      width = Math.max(1, Math.round(w));
      height = Math.max(1, Math.round(h));
      canvas.width = width;
      canvas.height = height;
      if (lost || disposed) return;
      freeBlurCache();
      freeLayerTargets();
      freeCellScratch();
    },
    setPhoto(index, bitmap) {
      if (lost || disposed) return;
      deletePhoto(index);
      if (!bitmap) return;
      const g = gl!;
      const tex = g.createTexture()!;
      g.bindTexture(g.TEXTURE_2D, tex);
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, bitmap);
      g.generateMipmap(g.TEXTURE_2D);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      photos.set(index, { tex, w: bitmap.width, h: bitmap.height });
    },
    setBackground(hex) {
      bg = parseHex(hex);
    },
    draw,
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onLost as EventListener);
      canvas.removeEventListener('webglcontextrestored', onRestored as EventListener);
      if (!lost) {
        for (const i of [...photos.keys()]) deletePhoto(i);
        freeBlurCache();
        freeLayerTargets();
        freeCellScratch();
        gl.deleteProgram(photoProg.p);
        gl.deleteProgram(blurProg.p);
        gl.deleteProgram(compositeProg.p);
        for (const p of transProgs.values()) gl.deleteProgram(p.p);
        gl.deleteVertexArray(vao);
      }
      photos.clear();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
    stats: () => ({
      photoTextures: photos.size,
      blurCaches: [...blurCache.values()].reduce((n, m) => n + m.size, 0),
      cellScratch: cellScratch !== null,
      width,
      height,
      contextLost: lost,
    }),
    isContextLost: () => lost,
    onContextEvent(cb) {
      listener = cb;
    },
  };
}
