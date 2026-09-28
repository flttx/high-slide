import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { oceanNormalTexture } from './textures.ts';

export const SUN_ELEVATION = 16;
export const SUN_AZIMUTH = 200;

export interface Environment {
  sky: Sky;
  sunDir: THREE.Vector3;
  sun: THREE.DirectionalLight;
  envMap: THREE.Texture;
  skyCube: THREE.CubeTexture;
  fogColor: THREE.Color;
}

export function buildEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): Environment {
  const sky = new Sky();
  sky.scale.setScalar(450000);
  const u = sky.material.uniforms;
  u.turbidity.value = 3.2;
  u.rayleigh.value = 1.35;
  u.mieCoefficient.value = 0.0045;
  u.mieDirectionalG.value = 0.86;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - SUN_ELEVATION),
    THREE.MathUtils.degToRad(SUN_AZIMUTH),
  );
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  // Sky-only scene for reflections / IBL.
  const skyScene = new THREE.Scene();
  const skyClone = new Sky();
  skyClone.scale.setScalar(450000);
  skyClone.material.uniforms.turbidity.value = u.turbidity.value;
  skyClone.material.uniforms.rayleigh.value = u.rayleigh.value;
  skyClone.material.uniforms.mieCoefficient.value = u.mieCoefficient.value;
  skyClone.material.uniforms.mieDirectionalG.value = u.mieDirectionalG.value;
  skyClone.material.uniforms.sunPosition.value.copy(sunDir);
  skyScene.add(skyClone);
  // a dark sea "floor" so the IBL lower hemisphere is ocean-coloured, not sky
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.05, 0.07), side: THREE.DoubleSide }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -40;
  floor.scale.setScalar(5000);
  const pmrem = new THREE.PMREMGenerator(renderer);
  skyScene.add(floor);
  // the DirectionalLight already lights with the sun; a sun disc in the IBL double-counts it and
  // shows up as blooming white glints on distant glossy slide rims. The sea cube below keeps it.
  skyClone.material.uniforms.showSunDisc.value = 0;
  // Keep the broad solar halo out of ambient lighting; it washes sun-facing surfaces white.
  skyClone.material.uniforms.mieCoefficient.value = 0.0005;
  const envRT = pmrem.fromScene(skyScene, 0, 1, 100000);
  skyClone.material.uniforms.showSunDisc.value = 1;
  skyClone.material.uniforms.mieCoefficient.value = u.mieCoefficient.value;
  skyScene.remove(floor);

  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCam = new THREE.CubeCamera(1, 1000000, cubeRT);
  cubeCam.update(renderer, skyScene);

  const sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
  sun.position.copy(sunDir).multiplyScalar(1000);
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x0b3a4a, 0.9);
  scene.add(hemi);

  const fogColor = new THREE.Color(0.62, 0.72, 0.84);
  scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.00016);
  scene.environment = null;

  return { sky, sunDir, sun, envMap: envRT.texture, skyCube: cubeRT.texture, fogColor };
}

export interface Ocean {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  update(time: number, camera: THREE.Camera): void;
}

export function buildOcean(env: Environment): Ocean {
  const normalMap = oceanNormalTexture();
  // Smaller triangles keep depth interpolation stable beneath distant shoreline foam.
  const geo = new THREE.PlaneGeometry(120000, 120000, 32, 32);
  geo.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSunDir: { value: env.sunDir.clone() },
        uSunColor: { value: new THREE.Color(1.0, 0.86, 0.66) },
        uNormal: { value: null },
        uSky: { value: null },
        uDeep: { value: new THREE.Color(0.004, 0.033, 0.05) },
        uShallow: { value: new THREE.Color(0.018, 0.15, 0.165) },
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform sampler2D uNormal;
      uniform samplerCube uSky;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      varying vec3 vWorld;
      #include <fog_pars_fragment>

      vec3 nrm(vec2 uv) {
        vec3 n = texture2D(uNormal, uv).xyz * 2.0 - 1.0;
        return vec3(n.x, n.z, n.y);
      }
      void main() {
        vec2 p = vWorld.xz;
        float t = uTime;
        vec3 n = nrm(p / 31.0 + vec2(0.021, 0.013) * t)
               + nrm(p / 97.0 + vec2(-0.011, 0.017) * t)
               + nrm(p / 311.0 + vec2(0.004, -0.006) * t) * 1.3
               + nrm(p / 1400.0 + vec2(0.0015, 0.001) * t) * 1.5;
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 v = toCam / dist;
        float flatK = clamp(dist / 9000.0, 0.0, 1.0);
        n = normalize(vec3(n.x, n.y * (1.0 + flatK * 5.0) + 2.4, n.z));
        vec3 r = reflect(-v, n);
        r.y = abs(r.y);
        vec3 sky = textureCube(uSky, r).rgb;
        float cosT = max(dot(n, v), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        // body colour: deeper when looking straight down, lighter on crests facing the sun
        float scatter = pow(max(dot(n, normalize(uSunDir * vec3(1.0, 0.2, 1.0))), 0.0), 3.0);
        vec3 body = mix(uShallow, uDeep, clamp(v.y * 1.2, 0.0, 1.0)) + uShallow * scatter * 0.8;
        vec3 col = mix(body, sky, fres);
        float sd = max(dot(r, uSunDir), 0.0);
        col += uSunColor * (pow(sd, 900.0) * 60.0 + pow(sd, 120.0) * 3.0 + pow(sd, 18.0) * 0.12);
        gl_FragColor = vec4(col, mix(0.48, 1.0, fres));
        #include <fog_fragment>
      }
    `,
    fog: true,
    transparent: true,
    depthWrite: true,
  });
  material.uniforms.uNormal.value = normalMap;
  material.uniforms.uSky.value = env.skyCube;
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  // murky seabed under the (partly transparent) surface so sharks read against dark water
  const bed = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.005, 0.03, 0.045) }));
  bed.position.y = -70;
  bed.frustumCulled = false;
  mesh.add(bed);
  const camPos = new THREE.Vector3();
  const update = (time: number, camera: THREE.Camera) => {
    material.uniforms.uTime.value = time;
    camera.getWorldPosition(camPos);
    mesh.position.x = Math.round(camPos.x / 100) * 100;
    mesh.position.z = Math.round(camPos.z / 100) * 100;
  };
  return { mesh, material, update };
}
