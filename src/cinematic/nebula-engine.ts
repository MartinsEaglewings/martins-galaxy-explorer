import * as THREE from 'three';

export function createCinematicNebula(scene: THREE.Scene) {
  const geometry = new THREE.SphereGeometry(10800, 48, 32);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);

        float n000 = hash(i + vec3(0.0, 0.0, 0.0));
        float n100 = hash(i + vec3(1.0, 0.0, 0.0));
        float n010 = hash(i + vec3(0.0, 1.0, 0.0));
        float n110 = hash(i + vec3(1.0, 1.0, 0.0));
        float n001 = hash(i + vec3(0.0, 0.0, 1.0));
        float n101 = hash(i + vec3(1.0, 0.0, 1.0));
        float n011 = hash(i + vec3(0.0, 1.0, 1.0));
        float n111 = hash(i + vec3(1.0, 1.0, 1.0));

        float x00 = mix(n000, n100, f.x);
        float x10 = mix(n010, n110, f.x);
        float x01 = mix(n001, n101, f.x);
        float x11 = mix(n011, n111, f.x);

        return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
      }

      void main() {
        vec2 uv = vUv;

        vec3 p = vec3(
          uv.x * 7.0 + uTime * 0.012,
          uv.y * 4.0 + sin(uTime * 0.035 + uv.x * 5.0) * 0.22,
          sin(uv.x * 6.28318) * 1.8 + cos(uv.y * 3.14159) * 1.2
        );

        float cloud = noise(p * 2.1);
        cloud = cloud * 0.58 + noise(p * 4.2 + vec3(3.1, 1.7, 2.4)) * 0.29;
        cloud += noise(p * 8.0 + vec3(7.0, 2.0, 4.0)) * 0.13;

        float ribbons = sin(
          uv.y * 17.0 +
          sin(uv.x * 13.0 + uTime * 0.045) * 2.0 +
          cloud * 5.0
        );

        float density = smoothstep(0.34, 0.79, cloud + ribbons * 0.055);
        density *= 0.72 + 0.28 * sin(uv.y * 8.0 + uv.x * 5.0);

        vec3 deepBlue = vec3(0.015, 0.055, 0.22);
        vec3 electricBlue = vec3(0.055, 0.30, 0.95);
        vec3 violet = vec3(0.34, 0.075, 0.72);
        vec3 magenta = vec3(0.82, 0.055, 0.43);
        vec3 gold = vec3(0.95, 0.32, 0.075);

        float colourFlow = noise(p * 1.35 + vec3(5.0, 0.0, uTime * 0.018));

        vec3 colour = mix(deepBlue, electricBlue, smoothstep(0.28, 0.68, colourFlow));
        colour = mix(colour, violet, smoothstep(0.42, 0.76, cloud));
        colour = mix(colour, magenta, smoothstep(0.61, 0.88, colourFlow + cloud * 0.18));
        colour = mix(colour, gold, smoothstep(0.76, 0.96, noise(p * 1.8 + 9.0)) * 0.72);

        float glow = smoothstep(0.48, 0.92, cloud);
        float alpha = density * (0.12 + glow * 0.24);

        gl_FragColor = vec4(colour * (0.72 + glow * 0.8), alpha);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const shell = new THREE.Mesh(geometry, material);
  shell.name = 'procedural-cinematic-nebula';
  shell.renderOrder = -2;
  scene.add(shell);

  return {
    update(time: number) {
      material.uniforms.uTime.value = time;
    },

    dispose() {
      scene.remove(shell);
      geometry.dispose();
      material.dispose();
    },
  };
}
