import { AdditiveBlending, Color, ShaderMaterial } from 'three';
import { SPECTRAL_RAMP } from '../shaders/noise';
import { INTERFACE, SPECTRAL } from '../palette';

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

/** Dark ceramic for solid parts: near-black, lit only at its rim and by what it represents. */
export function ceramicMaterial(accent: string): ShaderMaterial {
  return new ShaderMaterial({
    depthWrite: true,
    uniforms: {
      uBase: { value: new Color(INTERFACE.carbon) }, uTop: { value: new Color(INTERFACE.elevated) },
      uAccent: { value: new Color(accent) }, uSelectColor: { value: new Color(INTERFACE.ember) },
      uFade: { value: 1 }, uGlow: { value: 0 }, uSelect: { value: 0 }, uDim: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vWorldN;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vWorldN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase; uniform vec3 uTop; uniform vec3 uAccent; uniform vec3 uSelectColor;
      uniform float uFade; uniform float uGlow; uniform float uSelect; uniform float uDim;
      varying vec3 vN; varying vec3 vV; varying vec3 vWorldN;
      void main() {
        float rim = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.4);
        float up = smoothstep(-0.2, 1.0, vWorldN.y);
        vec3 c = mix(uBase, uTop, up * 0.75);
        c += uAccent * (rim * (1.0 - up) * 0.3 + uGlow * (0.008 + up * 0.016));
        c = mix(c, c + uSelectColor * (0.03 + rim * 0.3), uSelect);
        gl_FragColor = vec4(c * uDim, uFade);
        #include <colorspace_fragment>
      }`,
  });
}

/** A fine lit edge along a solid part. */
export function edgeMaterial(accent: string): ShaderMaterial {
  return new ShaderMaterial({
    ...ADDITIVE,
    uniforms: { uColor: { value: new Color(accent) }, uSelectColor: { value: new Color(INTERFACE.ember) }, uFade: { value: 1 }, uSelect: { value: 0 } },
    vertexShader: /* glsl */ `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uSelectColor; uniform float uFade; uniform float uSelect;
      void main() {
        gl_FragColor = vec4(mix(uColor, uSelectColor, uSelect), 1.0);
        #include <colorspace_fragment>
        float a = uFade * (0.8 + 0.2 * uSelect);
        gl_FragColor = vec4(gl_FragColor.rgb * a, a);
      }`,
  });
}

/** A lit connection between two parts. */
export function filamentLineMaterial(accent: string): ShaderMaterial {
  return new ShaderMaterial({
    ...ADDITIVE,
    uniforms: { uColor: { value: new Color(accent) }, uFade: { value: 0 } },
    vertexShader: /* glsl */ `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uFade;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
        #include <colorspace_fragment>
        gl_FragColor = vec4(gl_FragColor.rgb * uFade, uFade);
      }`,
  });
}

export interface HazeOpts { seed: number; intensity: number; warmth: number }

/** A still spectral atmosphere behind a model: soft bands under a radial mask, warmer toward its centre. */
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
      ${SPECTRAL_RAMP}
      uniform vec3 uCore;
      uniform float uSeed;
      uniform float uIntensity;
      uniform float uWarmth;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float mask = smoothstep(1.0, 0.1, length(p * vec2(1.0, 1.25)));
        // Layered sines, not noise: the haze is faint, and noise costs far more to compile on ANGLE.
        float n = sin(p.x * 2.1 + uSeed) * 0.5 + sin(p.y * 3.3 - p.x * 1.3 + uSeed * 1.7) * 0.35 + sin((p.x + p.y) * 4.7 + uSeed * 0.6) * 0.15;
        float density = smoothstep(-0.7, 0.9, n);
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
