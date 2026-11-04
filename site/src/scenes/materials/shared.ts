import { AdditiveBlending, Color, ShaderMaterial } from 'three';
import { SIMPLEX_3D, SPECTRAL_RAMP } from '../shaders/noise';
import { SPECTRAL } from '../palette';

// The shared Nebula material language: every luminous scene takes its light from here, so the Lattice,
// the story scenes and the Nebula read as one environment. StageViews sit outside the Workbench's bloom
// pass, so glow is drawn by the materials themselves (see HALO_FALLOFF), not by post-processing.

export const spectralUniforms = () => ({
  uCyan: { value: new Color(SPECTRAL.cyan) },
  uBlue: { value: new Color(SPECTRAL.blue) },
  uViolet: { value: new Color(SPECTRAL.violet) },
  uMagenta: { value: new Color(SPECTRAL.magenta) },
});

/** Light that adds to what is behind it. Shaders output premultiplied colour, weighted after the colour-space conversion so faint light stays faint. */
export const ADDITIVE = { transparent: true, depthWrite: false, blending: AdditiveBlending, premultipliedAlpha: true, toneMapped: false } as const;

/** A soft bloom-like falloff across a quad; `d` is 0 at the centre and 1 at the edge. */
export const HALO_FALLOFF = /* glsl */ `float haloFalloff(float d) { return exp(-d * d * 4.0) * smoothstep(1.0, 0.72, d); }`;

export interface HazeOpts { seed: number; intensity: number; warmth: number }

/** A still spectral atmosphere behind a model: noise under a radial mask, warmer toward its centre. */
export function hazeMaterial(o: HazeOpts): ShaderMaterial {
  return new ShaderMaterial({
    ...ADDITIVE,
    depthTest: false,
    uniforms: {
      ...spectralUniforms(),
      uCore: { value: new Color(SPECTRAL.amber) },
      uSeed: { value: o.seed },
      uIntensity: { value: o.intensity },
      uWarmth: { value: o.warmth },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      ${SIMPLEX_3D}
      ${SPECTRAL_RAMP}
      uniform vec3 uCore;
      uniform float uSeed;
      uniform float uIntensity;
      uniform float uWarmth;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float mask = smoothstep(1.0, 0.1, length(p * vec2(1.0, 1.25)));
        vec3 q = vec3(p * vec2(1.5, 1.1), uSeed);
        float n = snoise(q) * 0.6 + snoise(q * 2.3 + 4.0) * 0.28;
        float density = smoothstep(-0.55, 0.85, n);
        vec3 c = spectral(0.5 + 0.42 * p.x + 0.3 * n);
        c = mix(c, uCore, smoothstep(0.55, 0.0, length(p)) * uWarmth);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        float a = mask * mask * density * uIntensity;
        gl_FragColor = vec4(gl_FragColor.rgb * a, a);
      }
    `,
  });
}
