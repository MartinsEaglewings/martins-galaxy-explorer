import * as THREE from 'three';

export function createBlackHoleAnimation(root: THREE.Group) {
  const get = (name: string): THREE.Object3D | undefined =>
    root.getObjectByName(name);

  const inner = get('AccretionDiskInner');
  const outer = get('AccretionDiskOuter');
  const photon = get('PhotonRing');
  const halo = get('LensingHalo');
  const jetTop = get('RelativisticJetTop');
  const jetBottom = get('RelativisticJetBottom');
  const horizon = get('EventHorizon');

  // Additional luminous rings make the black hole readable at long range.
  // The central event horizon remains untouched and completely dark.
  const visualRings = [
    { radius: 2.35, tube: 0.11, color: 0x20dfff, speed: 0.52 },
    { radius: 3.25, tube: 0.13, color: 0xa34dff, speed: -0.34 },
    { radius: 4.15, tube: 0.10, color: 0xff8b35, speed: 0.22 },
  ].map((config) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(config.radius, config.tube, 8, 96),
      new THREE.MeshBasicMaterial({
        color: config.color,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.name = 'BlackHoleColourRing';
    ring.rotation.x = Math.PI / 2;
    root.add(ring);
    return { mesh: ring, speed: config.speed, material: ring.material as THREE.MeshBasicMaterial };
  });

  const baseInner = inner?.rotation.y ?? 0;
  const baseOuter = outer?.rotation.y ?? 0;
  const basePhoton = photon?.rotation.y ?? 0;

  const baseHaloScale = halo?.scale.clone();
  const baseJetTopScale = jetTop?.scale.clone();
  const baseJetBottomScale = jetBottom?.scale.clone();

  const coreLight = new THREE.PointLight(0xff8a42, 7, 16, 2);
  coreLight.position.set(0, 0.1, 0);
  root.add(coreLight);

  const blueLight = new THREE.PointLight(0x397dff, 4, 24, 2);
  blueLight.position.set(0, 2.6, 0);
  root.add(blueLight);

  const count = 220;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const radii = new Float32Array(count);
  const angles = new Float32Array(count);
  const heights = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    radii[i] = 1.55 + Math.random() * 2.95;
    angles[i] = Math.random() * Math.PI * 2;
    heights[i] = (Math.random() - 0.5) * 0.32;
    speeds[i] = (0.35 + Math.random()) / Math.pow(radii[i], 0.65);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3)
  );

  const material = new THREE.PointsMaterial({
    color: 0xffc28a,
    size: 0.055,
    transparent: true,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const particles = new THREE.Points(geometry, material);
  particles.name = 'AnimatedBlackHoleParticles';
  root.add(particles);

  function update(deltaSeconds: number, elapsedSeconds: number) {
    const dt = Math.min(Math.max(deltaSeconds || 0, 0), 0.05);
    const t = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;

    if (inner) inner.rotation.y = baseInner + t * 1.15;
    if (outer) outer.rotation.y = baseOuter - t * 0.48;
    if (photon) photon.rotation.y = basePhoton + t * 0.22;

    if (halo && baseHaloScale) {
      halo.rotation.y -= dt * 0.08;
      const pulse = 1 + Math.sin(t * 1.7) * 0.018;
      halo.scale.copy(baseHaloScale).multiplyScalar(pulse);
    }

    const jetPulse = 1 + Math.sin(t * 3.4) * 0.045;

    if (jetTop && baseJetTopScale) {
      jetTop.scale.copy(baseJetTopScale).multiplyScalar(jetPulse);
    }

    if (jetBottom && baseJetBottomScale) {
      jetBottom.scale.copy(baseJetBottomScale).multiplyScalar(jetPulse);
    }

    if (horizon) horizon.rotation.y += dt * 0.035;

    visualRings.forEach(({ mesh, speed, material }, index) => {
      mesh.rotation.z += dt * speed;
      material.opacity = 0.68 + Math.sin(t * (1.8 + index * 0.45) + index) * 0.22;
    });

    coreLight.intensity = 6.2 + Math.sin(t * 4.2) * 1.1;
    blueLight.intensity = 3.5 + Math.sin(t * 2.6 + 1.2) * 0.7;

    for (let i = 0; i < count; i++) {
      angles[i] += speeds[i] * dt;
      const a = angles[i];
      const r = radii[i];

      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] =
        heights[i] + Math.sin(a * 3 + t * 1.8) * 0.035;
      positions[i * 3 + 2] = Math.sin(a) * r;
    }

    geometry.attributes.position.needsUpdate = true;
  }

  function dispose() {
    root.remove(particles);
    geometry.dispose();
    material.dispose();
    root.remove(coreLight);
    root.remove(blueLight);
    visualRings.forEach(({ mesh, material }) => {
      root.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    });
  }

  return { update, dispose, particles };
}
