import type { FitMode, FrameDescriptor, Layer, Renderer } from '../types';
import { blurSize, parseHex, placePhoto } from './layout';
import type { TransitionProgramSpec } from './transitionSpec';
import { transitionPrograms } from './transitions/index';

export interface RendererStats {
  /** Resident photo textures. */
  photoTextures: number;
  /** Cached blurred backgrounds. */
  blurCaches: number;
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
  let blurCache = new Map<number, Target>();
  let scratch: Target | null = null; // blur ping-pong
  let layerA: Target | null = null;
  let layerB: Target | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let photoProg: Prog;
  let blurProg: Prog;
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
  function program(frag: string): Prog {
    const g = gl!;
    const p = g.createProgram()!;
    const vs = compile(g.VERTEX_SHADER, VERT);
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
    for (const t of blurCache.values()) freeTarget(t);
    blurCache.clear();
    freeTarget(scratch);
    scratch = null;
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

  function blurredBackground(index: number, ph: PhotoTex, focus: { x: number; y: number }): Target {
    const cached = blurCache.get(index);
    if (cached) return cached;
    const g = gl!;
    const { w, h } = blurSize(width, height);
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
    blurCache.set(index, out);
    return out;
  }

  /** Render one layer into `target` (null = canvas). */
  function renderLayer(layer: Layer, target: Target | null) {
    bindTarget(target, width, height);
    clear(bg);
    const ph = photos.get(layer.photoIndex);
    if (!ph) return;
    const fit: FitMode = layer.fit;
    if (fit === 'blur') {
      const b = blurredBackground(layer.photoIndex, ph, layer.focus);
      bindTarget(target, width, height); // blurredBackground rebinds
      drawRect(
        b.tex,
        width,
        height,
        { cx: width / 2, cy: height / 2, w: width, h: height },
        BLUR_DARKEN,
        true,
      );
      drawRect(
        ph.tex,
        width,
        height,
        placePhoto(ph.w, ph.h, width, height, 'contain', layer.focus, layer.transform),
        1,
        false,
      );
    } else {
      drawRect(
        ph.tex,
        width,
        height,
        placePhoto(ph.w, ph.h, width, height, fit, layer.focus, layer.transform),
        1,
        false,
      );
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
      renderLayer(frame.layer, null);
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
    renderLayer(frame.from, layerA);
    renderLayer(frame.to, layerB!);
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
      freeTarget(b);
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
    scratch = layerA = layerB = null;
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
        gl.deleteProgram(photoProg.p);
        gl.deleteProgram(blurProg.p);
        for (const p of transProgs.values()) gl.deleteProgram(p.p);
        gl.deleteVertexArray(vao);
      }
      photos.clear();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
    stats: () => ({
      photoTextures: photos.size,
      blurCaches: blurCache.size,
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
