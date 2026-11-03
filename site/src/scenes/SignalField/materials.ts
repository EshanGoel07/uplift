import { AdditiveBlending, Color, ShaderMaterial, Vector3 } from 'three';
import { SIMPLEX_3D, SPECTRAL_RAMP } from '../shaders/noise';
import { SPECTRAL } from '../palette';

const spectralUniforms = () => ({
  uCyan: { value: new Color(SPECTRAL.cyan) },
  uBlue: { value: new Color(SPECTRAL.blue) },
  uViolet: { value: new Color(SPECTRAL.violet) },
  uMagenta: { value: new Color(SPECTRAL.magenta) },
});

export interface MembraneOpts {
  radius: number;
  phase: number;
  freq: number;
  bias: number;      // shifts the spectral ramp: 0 = cyan/blue, 1 = magenta
  opacity: number;
  lines: boolean;
}

/** Shared vertex logic: multi-frequency noise displacement, rim folds, breathing, pointer bump. */
const MEMBRANE_VERT = /* glsl */ `
${SIMPLEX_3D}
uniform float uTime;
uniform float uRadius;
uniform float uPhase;
uniform float uFreq;
uniform float uAmp;
uniform float uExplode;
uniform vec3 uPointer;       // world space, on z = 0
uniform float uPointerStr;
attribute float aRim;
attribute float aSeed;
varying float vRim;
varying float vDisp;
varying float vHot;
varying vec3 vDir;
varying float vDepth;

void main() {
  vec3 p = position;
  float t = uTime;
  float rimW = smoothstep(0.3, 1.0, aRim);
  float n1 = snoise(p * 1.15 * uFreq + vec3(t * 0.055 + uPhase, -t * 0.03, uPhase * 0.7));
  float n2 = snoise(p * 2.7 * uFreq + vec3(uPhase, t * 0.09, -t * 0.04));
  float n3 = snoise(p * 6.4 + vec3(t * 0.16, uPhase, 0.0));
  float breathe = sin(t * 0.55 + uPhase * 2.0) * 0.025;
  float disp = n1 * 0.27 + n2 * (0.06 + 0.09 * rimW) + n3 * 0.016 + breathe;
  disp += rimW * rimW * n1 * 0.3;                       // cloth-like folds toward the torn rim
  float r = uRadius * (1.0 + disp * uAmp) * (1.0 + uExplode * (0.55 + 0.5 * aSeed * rimW));
  vec3 pos = p * r;
  pos.z += rimW * n2 * 0.26 * uAmp;                     // rim curls toward and away from the viewer
  pos.xy += rimW * vec2(n2, n1) * 0.05;

  vec4 world = modelMatrix * vec4(pos, 1.0);
  float d = distance(world.xy, uPointer.xy);
  float hot = exp(-d * d * 2.2) * uPointerStr;
  world.xyz += normalize(world.xyz - (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz) * hot * 0.22;

  vRim = aRim;
  vDisp = disp;
  vHot = hot;
  vDir = p;
  vec4 mv = viewMatrix * world;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const MEMBRANE_FRAG = /* glsl */ `
${SPECTRAL_RAMP}
uniform float uBias;
uniform float uOpacity;
uniform float uIntensity;
uniform float uLines;
uniform vec3 uAmber;
varying float vRim;
varying float vDisp;
varying float vHot;
varying vec3 vDir;
varying float vDepth;

void main() {
  float rimW = smoothstep(0.55, 1.0, vRim);
  // Position-dependent spectral flow, nudged by the displacement so colour follows the folds.
  float t = 0.5 + 0.32 * vDir.y - 0.22 * vDir.x + vDisp * 0.9 + uBias;
  t = mix(t, 0.05, rimW * 0.55);                         // rims run toward cyan
  vec3 c = spectral(t);
  c = mix(c, uAmber, smoothstep(0.35, 0.0, vRim) * 0.35); // warm light near the core-facing pole
  // Meridians converge at the pole: fade them there so the mesh stays legible around the core.
  float edge = smoothstep(0.1, 0.62, vRim) * (0.5 + 0.5 * smoothstep(0.55, 1.0, vRim));
  float depthFade = smoothstep(16.0, 7.0, vDepth);
  float a = uOpacity * edge * depthFade;
  if (uLines < 0.5) a *= 0.1;
  c *= uIntensity * (1.0 + vHot * 1.6);
  gl_FragColor = vec4(c * a, a);
}
`;

export function membraneMaterial(o: MembraneOpts): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: MEMBRANE_VERT,
    fragmentShader: MEMBRANE_FRAG,
    uniforms: {
      ...spectralUniforms(),
      uAmber: { value: new Color(SPECTRAL.amber) },
      uTime: { value: 0 },
      uRadius: { value: o.radius },
      uPhase: { value: o.phase },
      uFreq: { value: o.freq },
      uAmp: { value: 1 },
      uExplode: { value: 0 },
      uPointer: { value: new Vector3(999, 999, 0) },
      uPointerStr: { value: 0 },
      uBias: { value: o.bias },
      uOpacity: { value: o.opacity },
      uIntensity: { value: 1 },
      uLines: { value: o.lines ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    premultipliedAlpha: true,
  });
}

/** The warm core: hot white centre falling to amber at the limb; values above 1 feed the bloom. */
export function coreMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCore: { value: new Color(SPECTRAL.core) }, uAmber: { value: new Color(SPECTRAL.amber) }, uIntensity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCore; uniform vec3 uAmber; uniform float uTime; uniform float uIntensity;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = clamp(dot(vN, vV), 0.0, 1.0);
        vec3 c = mix(uAmber, uCore, smoothstep(0.0, 0.75, f));
        float pulse = 1.0 + 0.04 * sin(uTime * 1.3);
        gl_FragColor = vec4(c * (1.05 + 0.75 * f) * pulse * uIntensity, 1.0);
      }`,
  });
}

/** Soft halo sprite behind the core. */
export function haloMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uCore: { value: new Color(SPECTRAL.amber) }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCore; uniform float uOpacity; varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - d), 2.6) * 0.55 * uOpacity;
        gl_FragColor = vec4(uCore * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    premultipliedAlpha: true,
  });
}

/** Strands: magenta to amber, a travelling pulse, a few bright enough to bloom, brighter near the pointer. */
export function strandMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...spectralUniforms(),
      uAmber: { value: new Color(SPECTRAL.amber) },
      uTime: { value: 0 }, uOpacity: { value: 1 }, uPointer: { value: new Vector3(999, 999, 0) }, uPointerStr: { value: 0 }, uSpread: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform vec3 uPointer; uniform float uPointerStr; uniform float uSpread;
      attribute float aT; attribute float aSeed;
      varying float vT; varying float vSeed; varying float vHot;
      void main() {
        vec3 p = position;
        float w = sin(uTime * 0.7 + aSeed * 40.0 + aT * 5.0) * 0.07 * aT;
        p += vec3(w, -w * 0.6, w * 0.4);
        p *= 1.0 + uSpread * aT * 0.8;
        vec4 world = modelMatrix * vec4(p, 1.0);
        float d = distance(world.xy, uPointer.xy);
        vHot = exp(-d * d * 3.0) * uPointerStr;
        vT = aT; vSeed = aSeed;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      ${SPECTRAL_RAMP}
      uniform vec3 uAmber; uniform float uTime; uniform float uOpacity;
      varying float vT; varying float vSeed; varying float vHot;
      void main() {
        vec3 c = mix(uAmber, spectral(0.55 + vSeed * 0.45), smoothstep(0.0, 0.7, vT));
        float pulse = smoothstep(0.09, 0.0, abs(fract(uTime * 0.12 + vSeed * 7.0) - vT));
        float bright = step(0.86, vSeed);
        float a = (0.18 + 0.5 * (1.0 - vT)) * uOpacity;
        float k = 0.9 + pulse * (1.2 + bright * 2.4) + bright * 0.8 + vHot * 2.5;
        gl_FragColor = vec4(c * k * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    premultipliedAlpha: true,
  });
}

/** Round, soft, twinkling points. Inner dust is spectral; the far field is dim warm white. */
export function dustMaterial(pixelRatio: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...spectralUniforms(),
      uCore: { value: new Color(SPECTRAL.core) },
      uTime: { value: 0 }, uOpacity: { value: 1 }, uPR: { value: pixelRatio }, uSpread: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uPR; uniform float uSpread;
      attribute float aSize; attribute float aSeed;
      varying float vSeed; varying float vFar; varying float vTw;
      void main() {
        vec3 p = position;
        float far = step(5.0, length(p));
        float a = uTime * (0.04 + aSeed * 0.05) * (1.0 - far);
        p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
        p *= 1.0 + uSpread * (1.0 - far) * 0.9;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vSeed = aSeed; vFar = far;
        vTw = 0.55 + 0.45 * sin(uTime * (1.2 + aSeed * 2.0) + aSeed * 50.0);
        gl_PointSize = aSize * uPR * (far > 0.5 ? 1.6 : 26.0 / -mv.z) * (far > 0.5 ? 1.0 : 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${SPECTRAL_RAMP}
      uniform vec3 uCore; uniform float uOpacity;
      varying float vSeed; varying float vFar; varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        vec3 c = vFar > 0.5 ? uCore * 0.55 : spectral(vSeed);
        float hot = vFar < 0.5 ? step(0.93, vSeed) * 1.8 : 0.0;
        a *= vTw * uOpacity * (vFar > 0.5 ? 0.45 : 0.8);
        gl_FragColor = vec4(c * (1.0 + hot) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    premultipliedAlpha: true,
  });
}
