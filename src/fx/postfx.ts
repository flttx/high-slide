import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Interleave, interleaveParams, readInterleaveConfig } from './interleave.ts';
import type { InterleaveConfig } from './interleave.ts';

/** Tunables driven by the game every frame (all 0..1 unless noted). */
export interface FxParams {
  blur: number;
  center: THREE.Vector2;
  aberration: number;
  vignette: number;
  danger: number;
  desat: number;
  white: number;
  black: number;
  flash: number;
  gore: number;
}

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uBlur: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uCA: { value: 0 },
    uVignette: { value: 0.35 },
    uDanger: { value: 0 },
    uDesat: { value: 0 },
    uWhite: { value: 0 },
    uBlack: { value: 0 },
    uFlash: { value: 0 },
    uGore: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uBlur, uCA, uVignette, uDanger, uDesat, uWhite, uBlack, uFlash, uGore, uAspect;
    uniform vec2 uCenter;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec2 d = vUv - uCenter;
      float r = length(d * vec2(uAspect, 1.0));
      // radial motion blur, strongest at the edges of the view
      float mask = smoothstep(0.08, 0.75, r);
      vec2 step = d * uBlur * 0.055 * mask;
      float jitter = hash(vUv * 931.7 + uTime) - 0.5;
      vec3 col = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 10; i++) {
        float t = (float(i) + jitter) / 10.0;
        float w = 1.0 - t * 0.6;
        vec2 uv = vUv - step * t * 1.6;
        // chromatic aberration grows along the blur direction
        vec2 ca = d * uCA * 0.012 * mask;
        col.r += texture2D(tDiffuse, uv + ca).r * w;
        col.g += texture2D(tDiffuse, uv).g * w;
        col.b += texture2D(tDiffuse, uv - ca).b * w;
        wsum += w;
      }
      col /= wsum;

      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(lum) * vec3(1.02, 0.98, 0.95), uDesat);

      // danger: pulsing crimson creeping in from the edges
      float edge = smoothstep(0.35, 0.95, r);
      col = mix(col, col * vec3(1.35, 0.35, 0.3) + vec3(0.25, 0.0, 0.0), uDanger * edge);

      // gore: closing jaws / dark red interior
      col = mix(col, vec3(0.16, 0.01, 0.01) * (0.6 + 0.4 * (1.0 - r)), uGore);

      // vignette
      col *= 1.0 - uVignette * smoothstep(0.45, 1.05, r);

      col = mix(col, vec3(1.6, 1.62, 1.66), uWhite);
      col += vec3(1.2, 1.1, 1.0) * uFlash;
      col = mix(col, vec3(0.0), uBlack);

      // film grain
      float g = hash(vUv * vec2(1733.0, 911.0) + fract(uTime * 7.1)) - 0.5;
      col += g * 0.035 * (0.4 + lum);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class PostFX {
  readonly composer: EffectComposer;
  readonly params: FxParams;
  private readonly final: ShaderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly scenePass: RenderPass;
  private interleave: Interleave | null = null;
  private config = readInterleaveConfig(new URLSearchParams(location.search));
  private preview = -1;

  get interleaveConfig(): InterleaveConfig { return { ...this.config }; }
  get previewView(): number { return this.preview; }

  setInterleaveConfig(config: InterleaveConfig): void {
    this.config = readInterleaveConfig(interleaveParams(config));
    this.interleave?.updateConfig(this.config);
    this.setPreviewView(this.preview);
  }

  setPreviewView(index: number): void {
    this.preview = Number.isInteger(index) && index >= 0 ? Math.min(index, this.config.views - 1) : -1;
  }

  get interleaved(): boolean { return this.interleave !== null; }

  setInterleaved(enabled: boolean): void {
    if (enabled === this.interleaved) return;
    this.interleave?.dispose();
    this.interleave = enabled ? new Interleave(this.renderer, this.config) : null;
    this.preview = -1;
  }

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.renderer = renderer;
    this.camera = camera;
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.scenePass = new RenderPass(scene, camera);
    this.composer.addPass(this.scenePass);
    // Ordinary sunlit slide panels should retain detail; reserve bloom for lights and glints.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.12, 0.4, 1.6);
    // Bound only the bloom source: the HDR sun/reflections must not spread a white veil
    // over the track. The scene's exposure and marker colours stay unchanged.
    this.bloom.materialHighPassFilter.fragmentShader = /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float luminosityThreshold;
      uniform float smoothWidth;
      varying vec2 vUv;
      void main() {
        vec3 color = texture2D(tDiffuse, vUv).rgb;
        float brightness = luminance(color);
        float mask = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, brightness);
        color *= min(1.0, 1.0 / max(brightness, 0.0001));
        gl_FragColor = vec4(color * mask, mask);
      }
    `;
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
    this.params = {
      blur: 0,
      center: new THREE.Vector2(0.5, 0.5),
      aberration: 0,
      vignette: 0.35,
      danger: 0,
      desat: 0,
      white: 0,
      black: 0,
      flash: 0,
      gore: 0,
    };
  }

  setSize(w: number, h: number): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.interleave?.setSize(size.x, size.y);
    this.composer.setPixelRatio(this.interleave ? 1 : this.renderer.getPixelRatio());
    this.composer.setSize(this.interleave?.viewWidth ?? w, this.interleave?.viewHeight ?? h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.final.uniforms.uAspect.value = w / h;
  }

  render(time: number): void {
    const u = this.final.uniforms;
    const p = this.params;
    u.uTime.value = time;
    u.uBlur.value = p.blur;
    u.uCenter.value.copy(p.center);
    u.uCA.value = p.aberration;
    u.uVignette.value = p.vignette;
    u.uDanger.value = p.danger;
    u.uDesat.value = p.desat;
    u.uWhite.value = p.white;
    u.uBlack.value = p.black;
    u.uFlash.value = p.flash;
    u.uGore.value = p.gore;
    if (!this.interleave) {
      this.composer.render();
      return;
    }
    this.composer.renderToScreen = false;
    const scene = this.scenePass.scene;
    const matrixAutoUpdate = scene.matrixWorldAutoUpdate;
    try {
      this.interleave.render(this.camera, (camera) => {
        this.scenePass.camera = camera;
        this.composer.render();
        // Simulation/animation already advanced once; reuse transforms for the other views.
        scene.matrixWorldAutoUpdate = false;
        return this.composer.readBuffer.texture;
      }, this.preview);
    } finally {
      this.scenePass.camera = this.camera;
      scene.matrixWorldAutoUpdate = matrixAutoUpdate;
      this.composer.renderToScreen = true;
    }
  }
}
