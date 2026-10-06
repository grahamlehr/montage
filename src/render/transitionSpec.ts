/**
 * TRANSITION PLUG-IN CONTRACT (owned by T3; T5 implements programs in ./transitions/index.ts).
 *
 * The core renders the `from` and `to` layers (full fit/transform/blur-background handling) into two
 * offscreen textures of the output size, then draws ONE fullscreen pass with the program for the frame's
 * TransitionStyle. Styles with no spec fall back to `crossfade`.
 *
 * `fragment` is GLSL ES 3.00 source for a *body only*. The core prepends this header (do not redeclare):
 *
 *   #version 300 es
 *   precision highp float;
 *   uniform sampler2D uFrom, uTo;   // layer renders, opaque RGBA
 *   uniform float uProgress;        // 0..1 already eased; 0 must equal pure `from`, 1 pure `to`
 *   uniform vec2  uRes;             // output size in pixels
 *   uniform vec3  uBackground;      // background colour (0..1), e.g. for dip-to-black style fills
 *   in vec2 vUv;                    // 0..1, origin TOP-LEFT, +y DOWN (same as image/Transform convention)
 *   out vec4 outColor;
 *   vec4 texFrom(vec2 uv);          // sample `from` layer (uv: top-left origin, y down; clamps to edge)
 *   vec4 texTo(vec2 uv);            // sample `to` layer
 *
 * and appends `void main(){ outColor = vec4(transition(vUv, uProgress).rgb, 1.0); }`.
 * The body must therefore define:   vec4 transition(vec2 uv, float progress)
 *
 * Optional `uniforms(ctx)` returns extra float uniforms (declare them in `fragment`, e.g.
 * `uniform float uAspect;`) as name -> number | number[] (length 2..4 => vec2..vec4). Names are looked up
 * on the linked program; unknown names are ignored. Called once per draw.
 */
export interface TransitionUniformContext {
  width: number;
  height: number;
  progress: number;
}

export interface TransitionProgramSpec {
  fragment: string;
  uniforms?: (ctx: TransitionUniformContext) => Record<string, number | number[]>;
}
