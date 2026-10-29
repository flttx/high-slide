import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export interface InterleaveConfig {
  pitch: number;
  slant: number;
  views: number;
  offset: number;
  span: number;
  focus: number;
  scale: number;
  reverse: boolean;
}

export function readInterleaveConfig(params: URLSearchParams): InterleaveConfig {
  const number = (key: string, fallback: number, min: number, max: number) => {
    const raw = params.get(key);
    const value = raw?.trim() ? Number(raw) : NaN;
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  };
  return {
    pitch: number('pitch', 10.0298, 1, 100),
    slant: number('slant', 0.27781, -2, 2),
    views: Math.round(number('views', 24, 2, 32)),
    offset: number('offset', -1.5, -100, 100),
    span: number('viewSpan', 0.065, 0, 0.5),
    focus: number('focus', 8, 0.5, 1000),
    scale: number('viewScale', 0.25, 0.125, 1),
    reverse: params.get('reverse') === '1',
  };
}

export function interleaveParams(config: InterleaveConfig): URLSearchParams {
  return new URLSearchParams({ pitch: String(config.pitch), slant: String(config.slant),
    views: String(config.views), offset: String(config.offset), viewSpan: String(config.span),
    focus: String(config.focus), viewScale: String(config.scale), reverse: config.reverse ? '1' : '0' });
}

/** Python interleaveV2.py convention: top-left origin, reversed x and BGR phase. */
export function createViewMap(width: number, height: number, config: InterleaveConfig): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = ((height - 1 - y) * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      const phase = config.offset + y * 3 * config.slant + (width - 1 - x) * 3 + 2 - channel;
      const remainder = ((phase % config.pitch) + config.pitch) % config.pitch;
      data[pixel + channel] = Math.floor(remainder / config.pitch * config.views);
    }
    data[pixel + 3] = 255;
  }
  return data;
}

const vertexShader = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Small view atlas; one native-resolution pass selects the RGB subpixels. */
export class Interleave {
  readonly config: InterleaveConfig;
  readonly camera = new THREE.PerspectiveCamera();
  readonly atlas = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  private readonly renderer: THREE.WebGLRenderer;
  private readonly copy = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { source: { value: null as THREE.Texture | null } }, vertexShader,
    fragmentShader: 'uniform sampler2D source; varying vec2 vUv; void main() { gl_FragColor = texture2D(source, vUv); }',
    depthTest: false, depthWrite: false, toneMapped: false,
  }));
  private readonly output = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: {
      atlas: { value: this.atlas.texture }, viewMap: { value: null as THREE.Texture | null },
      grid: { value: new THREE.Vector2() }, tile: { value: new THREE.Vector2() },
      preview: { value: -1 },
    }, vertexShader,
    fragmentShader: `
      uniform sampler2D atlas, viewMap;
      uniform vec2 grid, tile;
      uniform float preview;
      varying vec2 vUv;
      vec3 sampleView(float index) {
        vec2 cell = vec2(mod(index, grid.x), floor(index / grid.x));
        // Clamp to texel centres so filtering cannot bleed into adjacent views.
        vec2 local = clamp(vUv, 0.5 / tile, 1.0 - 0.5 / tile);
        return texture2D(atlas, (cell + local) / grid).rgb;
      }
      void main() {
        vec3 ids = floor(texture2D(viewMap, vUv).rgb * 255.0 + 0.5);
        if (preview >= 0.0) ids = vec3(preview);
        gl_FragColor = vec4(sampleView(ids.r).r, sampleView(ids.g).g, sampleView(ids.b).b, 1.0);
      }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  }));
  private map: THREE.DataTexture | null = null;
  private width = 0;
  private height = 0;
  viewWidth = 1;
  viewHeight = 1;
  private readonly right = new THREE.Vector3();

  constructor(renderer: THREE.WebGLRenderer, config: InterleaveConfig) {
    this.renderer = renderer;
    this.config = { ...config };
  }

  updateConfig(config: InterleaveConfig): void {
    const mapChanged = config.pitch !== this.config.pitch || config.slant !== this.config.slant
      || config.offset !== this.config.offset || config.views !== this.config.views;
    const sizeChanged = config.scale !== this.config.scale || config.views !== this.config.views;
    Object.assign(this.config, config);
    if (mapChanged) { this.map?.dispose(); this.map = null; }
    if (mapChanged || sizeChanged) {
      const width = this.width, height = this.height;
      this.width = 0;
      this.setSize(width, height);
    }
  }

  setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    const mapSizeChanged = this.map?.image.width !== width || this.map?.image.height !== height;
    this.width = width; this.height = height;
    const cols = Math.ceil(Math.sqrt(this.config.views));
    const rows = Math.ceil(this.config.views / cols);
    const limit = this.renderer.capabilities.maxTextureSize;
    this.viewWidth = Math.max(1, Math.min(Math.floor(width * this.config.scale), Math.floor(limit / cols)));
    this.viewHeight = Math.max(1, Math.min(Math.floor(height * this.config.scale), Math.floor(limit / rows)));
    this.atlas.setSize(cols * this.viewWidth, rows * this.viewHeight);
    if (!this.map || mapSizeChanged) {
      this.map?.dispose();
      // Compute in double precision only when calibration or output size changes.
      this.map = new THREE.DataTexture(createViewMap(width, height, this.config), width, height);
      this.map.needsUpdate = true;
    }
    const uniforms = (this.output.material as THREE.ShaderMaterial).uniforms;
    uniforms.viewMap.value = this.map;
    uniforms.grid.value.set(cols, rows);
    uniforms.tile.value.set(this.viewWidth, this.viewHeight);
  }

  render(base: THREE.PerspectiveCamera, renderView: (camera: THREE.PerspectiveCamera) => THREE.Texture, preview = -1): void {
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const shadowNeedsUpdate = renderer.shadowMap.needsUpdate;
    const cols = Math.ceil(Math.sqrt(this.config.views));
    const selected = Number.isInteger(preview) && preview >= 0 ? Math.min(preview, this.config.views - 1) : -1;
    (this.output.material as THREE.ShaderMaterial).uniforms.preview.value = selected;
    base.updateWorldMatrix(true, false);
    this.right.setFromMatrixColumn(base.matrixWorld, 0).normalize();
    try {
      // All cameras see the same world/time. Reuse the first view's shadow maps.
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = shadowAutoUpdate || shadowNeedsUpdate;
      for (let index = selected < 0 ? 0 : selected; index < (selected < 0 ? this.config.views : selected + 1); index++) {
        const shift = (index / (this.config.views - 1) - 0.5) * this.config.span * (this.config.reverse ? -1 : 1);
        this.camera.copy(base, false);
        base.matrixWorld.decompose(this.camera.position, this.camera.quaternion, this.camera.scale);
        this.camera.position.addScaledVector(this.right, shift);
        // Parallel optical axes, asymmetric frusta converge at the focus plane.
        this.camera.projectionMatrix.elements[8] -= shift * this.camera.projectionMatrix.elements[0] / this.config.focus;
        this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
        this.camera.updateMatrixWorld(true);
        renderer.setRenderTarget(null);
        renderer.autoClear = autoClear;
        (this.copy.material as THREE.ShaderMaterial).uniforms.source.value = renderView(this.camera);
        // Render-target viewports are physical pixels; renderer.setViewport would
        // multiply by devicePixelRatio again and corrupt tiles on HiDPI screens.
        this.atlas.viewport.set((index % cols) * this.viewWidth, Math.floor(index / cols) * this.viewHeight, this.viewWidth, this.viewHeight);
        renderer.setRenderTarget(this.atlas);
        renderer.autoClear = false;
        this.copy.render(renderer);
      }
      renderer.setRenderTarget(previousTarget);
      this.output.render(renderer);
    } finally {
      renderer.autoClear = autoClear;
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      renderer.shadowMap.needsUpdate = shadowNeedsUpdate;
      renderer.setRenderTarget(previousTarget);
    }
  }

  dispose(): void {
    this.map?.dispose(); this.atlas.dispose();
    this.copy.material.dispose(); this.copy.dispose();
    this.output.material.dispose(); this.output.dispose();
  }
}
