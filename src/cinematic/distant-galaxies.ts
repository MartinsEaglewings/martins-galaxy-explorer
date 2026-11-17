import * as THREE from 'three';

type GalaxySystem = {
  facing: THREE.Group;
  stars: THREE.Group;
  dust: THREE.Group;
  halo: THREE.Mesh;
  core: THREE.Mesh;
  starSpeed: number;
  dustSpeed: number;
  phase: number;
};

const designs = [
  {
    name: 'Azure Colossus',
    position: [-8000, 0, -6500] as [number, number, number],
    radius: 1050,
    colors: [0xffffff, 0x62d9ff, 0x2455ff],
    starSpeed: 1.75,
    dustSpeed: 2.65,
    arms: 5,
  },
  {
    name: 'Violet Dominion',
    position: [8000, 0, -6500] as [number, number, number],
    radius: 1120,
    colors: [0xfff0ff, 0xff65df, 0x792cff],
    starSpeed: 1.95,
    dustSpeed: 2.9,
    arms: 5,
  },
  {
    name: 'Golden Eternity',
    position: [7000, 0, -8200] as [number, number, number],
    radius: 950,
    colors: [0xffffff, 0xffdf86, 0xff7029],
    starSpeed: 2.15,
    dustSpeed: 3.15,
    arms: 4,
  },
];

function makeGalaxyParticles(
  count: number,
  radius: number,
  colors: number[],
  arms: number,
  dust = false
) {
  const positions = new Float32Array(count * 3);
  const vertexColors = new Float32Array(count * 3);

  const inner = new THREE.Color(colors[0]);
  const middle = new THREE.Color(colors[1]);
  const outer = new THREE.Color(colors[2]);

  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(Math.random()) * radius;
    const normalized = r / radius;
    const arm = Math.floor(Math.random() * arms);

    const armAngle =
      arm * Math.PI * 2 / arms +
      r * (dust ? 0.009 : 0.008);

    const scatter = dust
      ? 0.035 + normalized * 0.10
      : 0.065 + normalized * 0.15;

    const angle = armAngle +
      (Math.random() - 0.5) * scatter * 2;

    const radiusVariation = dust
      ? (Math.random() - 0.5) * 45
      : (Math.random() - 0.5) * 28;

    const finalRadius = Math.max(0, r + radiusVariation);

    positions[i * 3] = Math.cos(angle) * finalRadius;
    positions[i * 3 + 1] = Math.sin(angle) * finalRadius;
    positions[i * 3 + 2] =
      (Math.random() - 0.5) *
      (dust ? 20 + normalized * 45 : 8 + normalized * 28);

    const color = new THREE.Color();

    if (normalized < 0.32) {
      color.lerpColors(inner, middle, normalized / 0.32);
    } else {
      color.lerpColors(middle, outer, (normalized - 0.32) / 0.68);
    }

    const brightness = dust
      ? 0.85 + Math.random() * 0.55
      : 0.8 + Math.random() * 0.65;

    color.multiplyScalar(brightness);

    vertexColors[i * 3] = color.r;
    vertexColors[i * 3 + 1] = color.g;
    vertexColors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3)
  );
  geometry.setAttribute(
    'color',
    new THREE.BufferAttribute(vertexColors, 3)
  );

  return geometry;
}

export function createDistantGalaxies(scene: THREE.Scene) {
  const systems: GalaxySystem[] = [];

  designs.forEach((design, index) => {
    const facing = new THREE.Group();
    facing.name = `enormous-galaxy-${index + 1}`;
    facing.position.set(...design.position);

    // Face the spiral toward the starting flight corridor.
    facing.lookAt(0, 0, 0);

    const stars = new THREE.Group();
    stars.name = `${design.name}-spiral-stars`;

    const starGeometry = makeGalaxyParticles(
      4800,
      design.radius,
      design.colors,
      design.arms
    );

    const starField = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        size: 2.9,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );

    stars.add(starField);

    // Independent luminous dust streams.
    const dust = new THREE.Group();
    dust.name = `${design.name}-rotating-light-dust`;

    const dustGeometry = makeGalaxyParticles(
      1600,
      design.radius * 0.98,
      design.colors,
      design.arms,
      true
    );

    const dustField = new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({
        size: 2.15,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );

    dust.add(dustField);

    // Bright central galactic glow.
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(115, 16, 12),
      new THREE.MeshBasicMaterial({
        color: design.colors[1],
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(38, 16, 12),
      new THREE.MeshBasicMaterial({
        color: design.colors[0],
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );

    facing.add(stars, dust, halo, core);
    scene.add(facing);

    systems.push({
      facing,
      stars,
      dust,
      halo,
      core,
      starSpeed: design.starSpeed,
      dustSpeed: design.dustSpeed,
      phase: index * 2.1,
    });
  });

  let elapsed = 0;

  function update(dt: number) {
    elapsed += dt;

    systems.forEach(system => {
      // These speeds exceed the black hole's 1.15 rad/s inner disk.
      system.stars.rotation.z += dt * system.starSpeed;
      system.dust.rotation.z += dt * system.dustSpeed;

      const pulse = 1 + Math.sin(elapsed * 2.4 + system.phase) * 0.09;

      system.halo.scale.setScalar(pulse);
      system.core.scale.setScalar(
        1 + Math.sin(elapsed * 3.2 + system.phase) * 0.055
      );
    });
  }

  function dispose() {
    systems.forEach(system => {
      scene.remove(system.facing);

      system.facing.traverse(object => {
        if (
          object instanceof THREE.Points ||
          object instanceof THREE.Mesh
        ) {
          object.geometry.dispose();

          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];

          materials.forEach(material => material.dispose());
        }
      });
    });

    systems.length = 0;
  }

  return { update, dispose };
}
