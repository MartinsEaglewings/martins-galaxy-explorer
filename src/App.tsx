import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { api, ws } from './appdeploy-client';
import {
  Activity, Crosshair, Eye, EyeOff, Gauge, Globe2, Mountain, Radar,
  Rocket, Satellite, Scan, Shield, Sparkles, Target, Zap,
} from 'lucide-react';

type Planet = {
  id: string;
  name: string;
  kind: string;
  color: string;
  size: number;
  position: [number, number, number];
  description: string;
  scanned: boolean;
};

const initialPlanets: Planet[] = [
  { id: 'aurelia', name: 'Mercury', kind: 'Terrestrial planet', color: '#a99b8d', size: 17, position: [-180, 5, -650], description: 'The smallest planet: a cratered, airless world of ancient impact basins and extreme temperatures.', scanned: false },
  { id: 'ignis', name: 'Venus', kind: 'Terrestrial planet', color: '#e7b879', size: 23, position: [210, -7, -1500], description: 'A bright world wrapped in dense golden clouds, with a fiercely hot volcanic surface.', scanned: false },
  { id: 'verdant', name: 'Earth', kind: 'Habitable planet', color: '#54b879', size: 24, position: [340, 15, -2450], description: 'Our blue home world, with oceans, continents, cloud systems and living settlements.', scanned: false },
  { id: 'nyx', name: 'Mars', kind: 'Terrestrial planet', color: '#c96e52', size: 19, position: [-390, 22, -3400], description: 'The red planet, shaped by giant volcanoes, dusty plains, canyons and polar ice.', scanned: false },
  { id: 'cinder', name: 'Jupiter', kind: 'Gas giant', color: '#d8ae87', size: 45, position: [430, -16, -4350], description: 'The Solar System’s largest planet, with immense swirling cloud bands and a giant storm.', scanned: false },
  { id: 'thalassa', name: 'Saturn', kind: 'Gas giant', color: '#d7c18c', size: 39, position: [-260, 35, -5300], description: 'A golden gas giant surrounded by a spectacular system of icy rings.', scanned: false },
  { id: 'zephyr', name: 'Uranus', kind: 'Ice giant', color: '#9bd8df', size: 31, position: [370, 8, -6250], description: 'A pale cyan ice giant that rotates on an unusually tilted axis.', scanned: false },
  { id: 'umbra', name: 'Neptune', kind: 'Ice giant', color: '#477bd7', size: 30, position: [-440, -12, -7200], description: 'A deep-blue, distant ice giant with powerful winds and dynamic storms.', scanned: false },
  { id: 'pluto', name: 'Pluto', kind: 'Dwarf planet', color: '#b9a18e', size: 13, position: [120, 18, -8150], description: 'A small icy dwarf world in the distant Kuiper Belt, with frozen plains and rugged mountains.', scanned: false },
];

type SurfaceObstacle = { x: number; z: number; radius: number; topY: number };

type FlightScene = {
  ship: THREE.Group;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  planets: Map<string, THREE.Group>;
  surfaces: Map<string, THREE.Group>;
  keys: Set<string>;
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  stars: THREE.Points;
  mode: 'space' | 'landing' | 'surface';
  activePlanet: string | null;
  landingProgress: number;
  surfaceGroundY: number;
  originalBackground: THREE.Color;
  originalFog: THREE.FogExp2 | null;
  surfaceSky: THREE.Mesh;
  autopilotTarget: string | null;
  surfaceObstacles: Map<string, SurfaceObstacle[]>;
  asteroids: Array<{ mesh: THREE.Mesh; radius: number }>;
  remoteShips: Map<string, THREE.Group>;
};

function terrainHeight(x: number, z: number, seed: number) {
  const broad = Math.sin(x * 0.018 + seed * 0.003) * 8 + Math.cos(z * 0.015 + seed * 0.002) * 7;
  const ridges = Math.sin((x + z) * 0.042 + seed * 0.005) * 3.5 + Math.cos((x - z) * 0.031 - seed * 0.004) * 3;
  const peaks = Math.pow(Math.max(0, Math.sin(x * 0.009 + Math.cos(z * 0.012 + seed * 0.002) * 2)), 3) * 30;
  const curvature = -((x * x + z * z) / (760 * 760)) * 34;
  return broad + ridges + peaks + curvature;
}

function makeEarthCity(group: THREE.Group, obstacles: SurfaceObstacle[], seed: number) {
  const asphalt = new THREE.MeshStandardMaterial({ color: '#303943', roughness: 0.96 });
  const pavement = new THREE.MeshStandardMaterial({ color: '#aeb5b6', roughness: 1 });
  const lines = new THREE.MeshBasicMaterial({ color: '#f4e6ad' });
  const walls = ['#e8d8bd', '#c9d5d7', '#d9b99b', '#b8c9ae', '#d7d1c4'].map(
    color => new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
  );
  const roofs = ['#654b42', '#46545d', '#795d48'].map(
    color => new THREE.MeshStandardMaterial({ color, roughness: 0.95 })
  );
  const glass = new THREE.MeshStandardMaterial({ color: '#8bd6ed', emissive: '#245b70', emissiveIntensity: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: '#60432f' });

  const strip = (x1: number, z1: number, x2: number, z2: number, width: number, offset: number, material: THREE.Material) => {
    const dx = x2 - x1, dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    const px = -dz / length, pz = dx / length;
    const steps = Math.max(12, Math.ceil(length / 7));
    const vertices: number[] = [], indices: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x1 + dx * t + px * offset;
      const cz = z1 + dz * t + pz * offset;
      for (const side of [-1, 1]) {
        const x = cx + px * width * side / 2;
        const z = cz + pz * width * side / 2;
        vertices.push(x, terrainHeight(x, z, seed) + 0.48, z);
      }
      if (i < steps) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  const horizontal = [-160, -70, 20];
  const vertical = [-90, 0, 90];
  horizontal.forEach(z => {
    strip(-125, z, 125, z, 9, 0, asphalt);
    strip(-125, z, 125, z, 3, 7.5, pavement);
    strip(-125, z, 125, z, 3, -7.5, pavement);
    for (let x = -112; x <= 112; x += 25) strip(x, z, x + 10, z, 0.28, 0, lines);
  });
  vertical.forEach(x => {
    strip(x, -195, x, 55, 9, 0, asphalt);
    strip(x, -195, x, 55, 3, 7.5, pavement);
    strip(x, -195, x, 55, 3, -7.5, pavement);
    for (let z = -185; z <= 45; z += 25) strip(x, z, x, z + 10, 0.28, 0, lines);
  });

  const spots: Array<[number, number]> = [];
  for (const cx of [-45, 45]) {
    for (const cz of [-115, -25]) {
      for (const ox of [-18, 18]) {
        for (const oz of [-18, 18]) spots.push([cx + ox, cz + oz]);
      }
    }
  }
  spots.forEach(([x, z], i) => {
    const w = 11 + (i % 3) * 1.5;
    const d = 11 + ((i + 1) % 3) * 1.5;
    const h = i % 5 === 0 ? 22 + (i % 3) * 3 : 9 + (i % 4) * 2;
    const ground = terrainHeight(x, z, seed);
    const building = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), walls[i % walls.length]);
    building.position.set(x, ground + h / 2, z);
    building.castShadow = true;
    group.add(building);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 1.1, d + 0.8), roofs[i % roofs.length]);
    roof.position.set(x, ground + h + 0.55, z);
    group.add(roof);
    for (const side of [-1, 1]) {
      const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.8, 0.22), glass);
      windowMesh.position.set(x + side * w * 0.24, ground + 3.1, z - d / 2 - 0.13);
      group.add(windowMesh);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.8, 0.25), dark);
    door.position.set(x, ground + 1.4, z - d / 2 - 0.16);
    group.add(door);
    obstacles.push({ x, z, radius: Math.max(w, d) * 0.72 + 2, topY: ground + h + 2 });
  });

  const route = [
    new THREE.Vector2(-90, -160), new THREE.Vector2(90, -160),
    new THREE.Vector2(90, 20), new THREE.Vector2(-90, 20)
  ];
  const carPaint = new THREE.MeshStandardMaterial({ color: '#d83f32', metalness: 0.3, roughness: 0.4 });
  const carGlass = new THREE.MeshStandardMaterial({ color: '#243b4b', metalness: 0.3, roughness: 0.2 });
  const wheels = new THREE.MeshStandardMaterial({ color: '#15191e' });
  for (let i = 0; i < 4; i++) {
    const car = new THREE.Group();
    car.name = 'earth-car';
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.25, 6), carPaint);
    body.position.y = 1.15;
    car.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.25, 2.9), carGlass);
    cabin.position.set(0, 2.15, 0.25);
    car.add(cabin);
    for (const side of [-1, 1]) {
      for (const front of [-1, 1]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.38, 10), wheels);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 1.82, 0.72, front * 1.9);
        car.add(wheel);
      }
    }
    const start = route[i];
    car.position.set(start.x, terrainHeight(start.x, start.y, seed) + 0.5, start.y);
    car.userData.route = route;
    car.userData.routeIndex = (i + 1) % route.length;
    car.userData.speed = 8 + (i % 2);
    group.add(car);
  }

  const paths: Array<[THREE.Vector2, THREE.Vector2]> = [];
  horizontal.forEach(z => {
    paths.push([new THREE.Vector2(-115, z - 7.5), new THREE.Vector2(115, z - 7.5)]);
    paths.push([new THREE.Vector2(115, z + 7.5), new THREE.Vector2(-115, z + 7.5)]);
  });
  vertical.forEach(x => {
    paths.push([new THREE.Vector2(x - 7.5, -185), new THREE.Vector2(x - 7.5, 45)]);
    paths.push([new THREE.Vector2(x + 7.5, 45), new THREE.Vector2(x + 7.5, -185)]);
  });
  const clothes = new THREE.MeshStandardMaterial({ color: '#e9a34b' });
  const skin = new THREE.MeshStandardMaterial({ color: '#986342' });
  for (let i = 0; i < 10; i++) {
    const person = new THREE.Group();
    person.name = 'earth-pedestrian';
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 2.1, 8), clothes);
    torso.position.y = 1.7;
    person.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.48, 10, 8), skin);
    head.position.y = 3.05;
    person.add(head);
    const [start, end] = paths[i];
    person.position.set(start.x, terrainHeight(start.x, start.y, seed) + 0.5, start.y);
    person.userData.walkStart = start;
    person.userData.walkEnd = end;
    person.userData.walkProgress = (i % 3) * 0.12;
    person.userData.walkDirection = 1;
    person.userData.walkSpeed = 3.1 + (i % 3) * 0.35;
    group.add(person);
  }
}


function makeSurface(planet: Planet, groundY: number) {
  const group = new THREE.Group();
  group.position.set(planet.position[0], groundY, planet.position[2]);
  const size = 760;
  const segments = 128;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const colors: number[] = [];
  const obstacles: SurfaceObstacle[] = [];
  const base = new THREE.Color(planet.color).multiplyScalar(0.58);
  const high = new THREE.Color(planet.color).lerp(new THREE.Color('#ffffff'), 0.42);
  const terrainSeed = planet.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const height = terrainHeight(x, z, terrainSeed);
    positions.setY(i, height);
    const tint = THREE.MathUtils.clamp((height + 22) / 65, 0, 1);
    const color = base.clone().lerp(high, tint * 0.82);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const terrain = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
  );
  terrain.receiveShadow = true;
  group.add(terrain);

  const rockMat = new THREE.MeshStandardMaterial({ color: high, roughness: 1 });
  for (let i = 0; i < 100; i++) {
    const x = Math.sin(i * 91.7) * 320;
    const z = Math.cos(i * 47.3) * 320;
    const radius = 1.2 + (i % 6) * 0.9;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), rockMat);
    const rockY = terrainHeight(x, z, terrainSeed) + radius * 0.55;
    rock.position.set(x, rockY, z);
    rock.rotation.set(i * 0.31, i * 0.73, i * 0.19);
    group.add(rock);
    obstacles.push({ x, z, radius: radius + 2.5, topY: rockY + radius });
  }

  const mountainMat = new THREE.MeshStandardMaterial({ color: high, roughness: 1 });
  for (let i = 0; i < 18; i++) {
    const x = Math.sin(i * 17.2) * 270;
    const z = -130 - Math.cos(i * 12.4) * 260;
    const height = 28 + (i % 5) * 15;
    const mountain = new THREE.Mesh(
      new THREE.ConeGeometry(18 + (i % 4) * 8, height, 7),
      mountainMat
    );
    const mountainBase = terrainHeight(x, z, terrainSeed);
    mountain.position.set(x, mountainBase + height / 2, z);
    mountain.rotation.y = i * 0.7;
    group.add(mountain);
    obstacles.push({ x, z, radius: 20 + (i % 4) * 8, topY: mountainBase + height });
  }

  if (['verdant', 'aurelia'].includes(planet.id)) {
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#65452f', roughness: 1 });
    const leafMaterial = new THREE.MeshStandardMaterial({ color: planet.id === 'verdant' ? '#287d4b' : '#397d68', roughness: 0.9 });
    for (let i = 0; i < 42; i++) {
      const x = Math.sin(i * 28.31 + terrainSeed) * 285;
      const z = Math.cos(i * 19.73 + terrainSeed) * 285;
      const ground = terrainHeight(x, z, terrainSeed);
      const trunkHeight = 7 + (i % 5) * 1.8;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.25, trunkHeight, 7), trunkMaterial);
      trunk.position.set(x, ground + trunkHeight / 2, z);
      group.add(trunk);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(4 + (i % 3), 10 + (i % 4) * 2, 7), leafMaterial);
      crown.position.set(x, ground + trunkHeight + 5, z);
      group.add(crown);
      obstacles.push({ x, z, radius: 3.4, topY: ground + trunkHeight + 11 });
    }
  }

  if (['aurelia', 'thalassa'].includes(planet.id)) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(520, 520, 1, 1), new THREE.MeshPhysicalMaterial({ color: planet.id === 'aurelia' ? '#168bc1' : '#13b8c5', roughness: 0.2, metalness: 0.18, transparent: true, opacity: 0.78, transmission: 0.12, side: THREE.DoubleSide }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 3.5, 0);
    water.name = 'ocean-surface';
    group.add(water);
  }

  if (planet.id === 'ignis') {
    const lavaMaterial = new THREE.MeshStandardMaterial({ color: '#ff4b12', emissive: '#ff2a00', emissiveIntensity: 2.2, roughness: 0.35 });
    const fireMaterial = new THREE.MeshBasicMaterial({ color: '#ff9b22', transparent: true, opacity: 0.88 });
    const vents = [[-115, -145], [95, -220], [170, 90], [-190, 170]];
    vents.forEach(([x, z], index) => {
      const ground = terrainHeight(x, z, terrainSeed);
      const coneHeight = 36 + index * 9;
      const volcano = new THREE.Mesh(new THREE.ConeGeometry(24 + index * 3, coneHeight, 9), new THREE.MeshStandardMaterial({ color: '#4b2520', roughness: 1 }));
      volcano.position.set(x, ground + coneHeight / 2, z);
      group.add(volcano);
      const crater = new THREE.Mesh(new THREE.CylinderGeometry(8, 12, 2, 12), lavaMaterial);
      crater.position.set(x, ground + coneHeight, z);
      group.add(crater);
      const plume = new THREE.Mesh(new THREE.ConeGeometry(8 + index, 34 + index * 7, 9), fireMaterial);
      plume.position.set(x, ground + coneHeight + 16, z);
      plume.name = 'volcano-flame';
      group.add(plume);
      const glow = new THREE.PointLight(0xff4b12, 18, 115);
      glow.position.set(x, ground + coneHeight + 5, z);
      group.add(glow);
      obstacles.push({ x, z, radius: 27 + index * 3, topY: ground + coneHeight + 12 });
    });
    const lavaCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-115, 8, -145), new THREE.Vector3(-80, 5, -105), new THREE.Vector3(-45, 3, -55), new THREE.Vector3(-5, 2, 0)]);
    const lavaFlow = new THREE.Mesh(new THREE.TubeGeometry(lavaCurve, 48, 2.8, 8, false), lavaMaterial);
    group.add(lavaFlow);
  }

  if (planet.id === 'cinder' || planet.id === 'umbra') {
    const crystalMaterial = new THREE.MeshStandardMaterial({ color: planet.id === 'cinder' ? '#c77b4b' : '#8b9aab', metalness: 0.28, roughness: 0.72 });
    for (let i = 0; i < 26; i++) {
      const x = Math.sin(i * 13.7 + terrainSeed) * 260;
      const z = Math.cos(i * 21.3 + terrainSeed) * 260;
      const ground = terrainHeight(x, z, terrainSeed);
      const crystal = new THREE.Mesh(new THREE.ConeGeometry(3 + i % 4, 12 + i % 6 * 3, 6), crystalMaterial);
      crystal.position.set(x, ground + 8, z);
      group.add(crystal);
      obstacles.push({ x, z, radius: 4, topY: ground + 18 });
    }
  }

  if (planet.id === 'nyx' || planet.id === 'zephyr') {
    const iceMaterial = new THREE.MeshStandardMaterial({ color: '#d7eaff', roughness: 0.28, metalness: 0.12 });
    for (let i = 0; i < 34; i++) {
      const x = Math.sin(i * 17.1 + terrainSeed) * 275;
      const z = Math.cos(i * 11.9 + terrainSeed) * 275;
      const ground = terrainHeight(x, z, terrainSeed);
      const shard = new THREE.Mesh(new THREE.ConeGeometry(3 + i % 4, 16 + i % 5 * 4, 5), iceMaterial);
      shard.position.set(x, ground + 9, z);
      group.add(shard);
      obstacles.push({ x, z, radius: 4.5, topY: ground + 20 });
    }
  }

  // Every world has its own inhabited-looking settlement architecture.
  const cityPalettes: Record<string, string> = {
    aurelia: '#70d9ed', ignis: '#ff8a55', verdant: '#a5d98b', nyx: '#c8c5ff',
    cinder: '#e5b47d', thalassa: '#6cf0e6', zephyr: '#e3d8ff',    umbra: '#9eb2c9', pluto: '#d6c6b6',
  };
  const cityMaterial = new THREE.MeshStandardMaterial({ color: cityPalettes[planet.id], emissive: cityPalettes[planet.id], emissiveIntensity: 0.16, metalness: 0.42, roughness: 0.48 });
  const windowMaterial = new THREE.MeshBasicMaterial({ color: planet.id === 'ignis' ? '#ffbd72' : '#9ceaff' });
  if (planet.id !== 'verdant') {
  for (let i = 0; i < 11; i++) {
    const angle = i * Math.PI * 2 / 11;
    const x = Math.cos(angle) * (78 + (i % 3) * 19);
    const z = Math.sin(angle) * (78 + (i % 3) * 19) - 70;
    const ground = terrainHeight(x, z, terrainSeed);
    const height = 17 + (i % 4) * 9 + (planet.id === 'zephyr' ? 12 : 0);
    const width = 7 + (i % 3) * 2;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(width, height, width), cityMaterial);
    tower.position.set(x, ground + height / 2, z);
    tower.rotation.y = angle * 0.4;
    group.add(tower);
    const crown = new THREE.Mesh(planet.id === 'ignis' ? new THREE.ConeGeometry(width * 0.7, 9, 6) : new THREE.BoxGeometry(width * 0.72, 3, width * 0.72), cityMaterial);
    crown.position.set(x, ground + height + 4, z);
    group.add(crown);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), windowMaterial);
    beacon.position.set(x, ground + height * 0.72, z + width / 2 + 0.3);
    group.add(beacon);
    obstacles.push({ x, z, radius: width * 0.8, topY: ground + height + 8 });
  }
  }
  if (planet.id === 'verdant') makeEarthCity(group, obstacles, terrainSeed);

  const landmarkGround = terrainHeight(0, -70, terrainSeed);
  const landmark = new THREE.Mesh(new THREE.TorusGeometry(25, 2.8, 8, 40), cityMaterial);
  landmark.position.set(0, landmarkGround + 20, -70);
  landmark.rotation.x = Math.PI / 2;
  group.add(landmark);

  // A distinct autonomous creature silhouette and patrol for each planet.
  const species: Record<string, { name: string; color: string; accent: string; scale: number; style: number }> = {
    aurelia: { name: 'TIDAL GLIDER', color: '#277fba', accent: '#8df4ed', scale: 1.25, style: 0 },
    ignis: { name: 'MAGMA STALKER', color: '#682c24', accent: '#ff8a36', scale: 1.05, style: 1 },
    verdant: { name: 'CANOPY SENTINEL', color: '#326d45', accent: '#a5ed79', scale: 1.2, style: 2 },
    nyx: { name: 'FROST WARDEN', color: '#7585c7', accent: '#e0f6ff', scale: 1.5, style: 3 },
    cinder: { name: 'DUNE RUNNER', color: '#a85f3d', accent: '#ffc17a', scale: 0.95, style: 4 },
    thalassa: { name: 'ABYSSAL WALKER', color: '#167c86', accent: '#6ff5e5', scale: 1.35, style: 5 },
    zephyr: { name: 'SKY MANTA', color: '#8d7cc5', accent: '#e6dfff', scale: 1.3, style: 6 },
    umbra: { name: 'VOID SENTINEL', color: '#465365', accent: '#91b6d5', scale: 1.4, style: 7 },
    pluto: { name: 'KUIPER WARDEN', color: '#817568', accent: '#d9d1c4', scale: 0.9, style: 8 },
  };
  const speciesData = species[planet.id];
  if (speciesData) {
    const creature = new THREE.Group();
    creature.name = 'planet-creature';
    const skin = new THREE.MeshStandardMaterial({ color: speciesData.color, roughness: 0.72, metalness: 0.12 });
    const glow = new THREE.MeshStandardMaterial({ color: speciesData.accent, emissive: speciesData.accent, emissiveIntensity: 1.1 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(5.8, 18, 14), skin);
    body.scale.set(speciesData.style === 6 ? 1.8 : 1.1, speciesData.style === 5 ? 0.75 : 1, speciesData.style === 6 ? 0.65 : 1.25);
    creature.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), skin);
    head.position.set(0, 3.7, -4.6);
    creature.add(head);
    head.position.set(0, 3.7, -4.6);
    creature.add(head);
    [-1, 1].forEach(side => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.75, 8, 8), glow);
      eye.position.set(side * 1.35, 4.1, -7.1);
      creature.add(eye);
      const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.45, speciesData.style === 5 ? 7 : 9, 7), skin);
      limb.position.set(side * 3.5, -5.5, side * 0.8);
      limb.rotation.z = side * 0.22;
      creature.add(limb);
      if ([0, 3, 6].includes(speciesData.style)) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(3.1, 10, 5), glow);
        fin.position.set(side * 7, 0.5, 0);
        fin.rotation.z = side * Math.PI / 2;
        creature.add(fin);
      }
    });
    const crest = new THREE.Mesh(new THREE.ConeGeometry(2.3, 7 + speciesData.style, 6), glow);
    crest.position.set(0, 8, -2.8);
    creature.add(crest);
    creature.scale.setScalar(speciesData.scale);
    const creatureX = -38;
    const creatureZ = -125;
    creature.position.set(creatureX, terrainHeight(creatureX, creatureZ, terrainSeed) + 8, creatureZ);
    creature.userData.patrolX = creatureX;
    creature.userData.patrolZ = creatureZ;
    creature.userData.species = speciesData.name;
    group.add(creature);
    obstacles.push({ x: creatureX, z: creatureZ, radius: 10 * speciesData.scale, topY: creature.position.y + 12 * speciesData.scale });
  }
  return { group, obstacles };
}

function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FlightScene | null>(null);
  const nearPlanetRef = useRef<string | null>(null);
  const [planets, setPlanets] = useState(initialPlanets);
  const [target, setTarget] = useState('aurelia');
  const [speed, setSpeed] = useState(0);
  const [coordinates, setCoordinates] = useState<[number, number, number]>([0, 0, 0]);
  const [shield] = useState(100);
  const [boosting, setBoosting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState('FLIGHT SYSTEMS ONLINE · READY FOR DEPARTURE');
  const [showMap, setShowMap] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [flightMode, setFlightMode] = useState<'space' | 'landing' | 'surface'>('space');
  const [nearPlanet, setNearPlanet] = useState<string | null>(null);
  const [activePlanet, setActivePlanet] = useState<Planet | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState(1);
  const [multiplayerStatus, setMultiplayerStatus] = useState('CONNECTING');
  const [pilotName, setPilotName] = useState(() => localStorage.getItem('galaxy-explorer-username') || '');
  const [usernameDraft, setUsernameDraft] = useState(() => localStorage.getItem('galaxy-explorer-username') || '');
  const [gameStarted, setGameStarted] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const pilotIdRef = useRef(`pilot-${Math.random().toString(36).slice(2, 12)}`);
  const scannedCount = planets.filter(p => p.scanned).length;
  const currentTarget = planets.find(p => p.id === target) ?? planets[0];

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#030611');
    const originalBackground = scene.background.clone();
    const originalFog = new THREE.FogExp2('#030611', 0.000018);
    scene.fog = originalFog;
    const camera = new THREE.PerspectiveCamera(62, host.clientWidth / host.clientHeight, 0.1, 12000);
    camera.position.set(0, 4, 13);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0x9bbdff, 0x11101c, 1.35));
    const sun = new THREE.DirectionalLight(0xffe5c1, 3.3);
    sun.position.set(-120, 90, -160);
    scene.add(sun);
    const surfaceLight = new THREE.DirectionalLight(0xffedcf, 2.1);
    surfaceLight.position.set(-180, 220, 120);
    scene.add(surfaceLight);
    const rim = new THREE.PointLight(0x438cff, 65, 500);
    rim.position.set(80, 25, -130);
    scene.add(rim);

    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(7600 * 3);
    for (let i = 0; i < 7600; i++) {
      starPositions[i * 3] = (Math.random() - 0.5) * 11000;
      starPositions[i * 3 + 1] = (Math.random() - 0.5) * 5000;
      starPositions[i * 3 + 2] = (Math.random() - 0.5) * 11000;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xc7d8ff, size: 1.05 }));
    scene.add(stars);

    const nebula = new THREE.Mesh(
      new THREE.SphereGeometry(720, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0x101b43, side: THREE.BackSide, transparent: true, opacity: 0.28 })
    );
    scene.add(nebula);
    const galaxyPositions = new Float32Array(2600 * 3);
    for (let i = 0; i < 2600; i++) {
      const arm = i % 4;
      const radius = 90 + Math.random() * 1050;
      const angle = radius * 0.0038 + arm * Math.PI / 2 + (Math.random() - 0.5) * 0.42;
      galaxyPositions[i * 3] = Math.cos(angle) * radius;
      galaxyPositions[i * 3 + 1] = (Math.random() - 0.5) * (70 + radius * 0.08);
      galaxyPositions[i * 3 + 2] = -2500 + Math.sin(angle) * radius;
    }
    const galaxyGeometry = new THREE.BufferGeometry();
    galaxyGeometry.setAttribute('position', new THREE.BufferAttribute(galaxyPositions, 3));
    const galaxy = new THREE.Points(galaxyGeometry, new THREE.PointsMaterial({ color: 0xb6a7ff, size: 2.1, transparent: true, opacity: 0.9 }));
    scene.add(galaxy);
    const violetCloud = new THREE.Mesh(new THREE.SphereGeometry(1150, 20, 14), new THREE.MeshBasicMaterial({ color: 0x38265f, side: THREE.BackSide, transparent: true, opacity: 0.12, depthWrite: false }));
    violetCloud.position.set(0, 0, -2500);
    scene.add(violetCloud);

    const asteroidField = new THREE.Group();
    const asteroids: Array<{ mesh: THREE.Mesh; radius: number }> = [];
    const asteroidMaterial = new THREE.MeshStandardMaterial({ color: 0x777b88, roughness: 0.96, metalness: 0.12 });
    for (let i = 0; i < 115; i++) {
      const radius = 5 + (i % 7) * 1.65;
      const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), asteroidMaterial);
      mesh.position.set(Math.sin(i * 19.13) * (170 + (i % 5) * 42), Math.cos(i * 7.71) * 115, -260 - i * 67);
      mesh.rotation.set(i * 0.43, i * 0.71, i * 0.23);
      asteroidField.add(mesh);
      asteroids.push({ mesh, radius: radius + 4.5 });
    }
    scene.add(asteroidField);

    const sunPosition = new THREE.Vector3(0, 0, -6500);

    const orbitSettings: Record<string, {
      radius: number;
      eccentricity: number;
      speed: number;
      phase: number;
      inclination: number;
    }> = {
      aurelia: { radius: 420, eccentricity: 0.06, speed: 0.075, phase: 0.1, inclination: 8 },
      ignis: { radius: 620, eccentricity: 0.04, speed: 0.055, phase: 1.1, inclination: 12 },
      verdant: { radius: 850, eccentricity: 0.035, speed: 0.045, phase: 2.2, inclination: 7 },
      nyx: { radius: 1120, eccentricity: 0.07, speed: 0.036, phase: 3.1, inclination: 18 },
      cinder: { radius: 1650, eccentricity: 0.045, speed: 0.022, phase: 4.0, inclination: 24 },
      thalassa: { radius: 2150, eccentricity: 0.055, speed: 0.017, phase: 5.0, inclination: 30 },
      zephyr: { radius: 2650, eccentricity: 0.035, speed: 0.013, phase: 2.7, inclination: 36 },
      umbra: { radius: 3150, eccentricity: 0.04, speed: 0.010, phase: 4.8, inclination: 42 },
      pluto: { radius: 3600, eccentricity: 0.12, speed: 0.008, phase: 0.7, inclination: 48 },
    };

    const getOrbitPosition = (
      settings: typeof orbitSettings[string],
      angle: number
    ) => new THREE.Vector3(
      sunPosition.x + Math.cos(angle) * settings.radius * (1 - settings.eccentricity),
      sunPosition.y + Math.sin(angle * 0.7) * settings.inclination,
      sunPosition.z + Math.sin(angle) * settings.radius
    );

    const planetGroups = new Map<string, THREE.Group>();
    const surfaces = new Map<string, THREE.Group>();
    const surfaceObstacles = new Map<string, SurfaceObstacle[]>();

    const planetTextureFiles: Record<string, { albedo: string; bump: string }> = {
      aurelia: {
        albedo: new URL('./assets/textures/mercury-albedo.png', import.meta.url).href,
        bump: new URL('./assets/textures/mercury-bump.png', import.meta.url).href,
      },
      ignis: {
        albedo: new URL('./assets/textures/venus-albedo.png', import.meta.url).href,
        bump: new URL('./assets/textures/venus-bump.png', import.meta.url).href,
      },
      verdant: {
        albedo: new URL('./assets/textures/earth-albedo.png', import.meta.url).href,
        bump: new URL('./assets/textures/earth-bump.png', import.meta.url).href,
      },
      nyx: {
        albedo: new URL('./assets/textures/mars-albedo.png', import.meta.url).href,
        bump: new URL('./assets/textures/mars-bump.png', import.meta.url).href,
      },
      cinder: {
        albedo: new URL('./assets/textures/jupiter-albedo.png', import.meta.url).href,
        bump: new URL('./assets/textures/jupiter-bump.png', import.meta.url).href,
      },
      thalassa: {
        albedo: new URL('./assets/textures/saturn-albedo.png', import.meta.url).href,
        bump: new URL('./assets/textures/saturn-bump.png', import.meta.url).href,
      },
      zephyr: {
        albedo: new URL('./assets/textures/uranus-albedo.png', import.meta.url).href,
        bump: new URL('./assets/textures/uranus-bump.png', import.meta.url).href,
      },
      umbra: {
        albedo: new URL('./assets/textures/neptune-albedo.png', import.meta.url).href,
        bump: new URL('./assets/textures/neptune-bump.png', import.meta.url).href,
      },
      pluto: {
        albedo: new URL('./assets/textures/pluto-albedo.png', import.meta.url).href,
        bump: new URL('./assets/textures/pluto-bump.png', import.meta.url).href,
      },
    };

    const planetTextures: THREE.Texture[] = [];
    const textureLoader = new THREE.TextureLoader();

    const loadPlanetTexture = (url: string, isColor = false) => {
      const texture = textureLoader.load(url);
      if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      planetTextures.push(texture);
      return texture;
    };

    const earthCloudTexture = loadPlanetTexture(
      new URL('./assets/textures/earth-clouds.png', import.meta.url).href,
      true
    );
    const earthNightTexture = loadPlanetTexture(
      new URL('./assets/textures/earth-night-lights.png', import.meta.url).href,
      true
    );
    const saturnRingTexture = loadPlanetTexture(
      new URL('./assets/textures/saturn-rings.png', import.meta.url).href,
      true
    );
    const sunTexture = loadPlanetTexture(
      new URL('./assets/textures/sun-emissive.png', import.meta.url).href,
      true
    );
    const moonAlbedo = loadPlanetTexture(
      new URL('./assets/textures/moon-albedo.png', import.meta.url).href,
      true
    );
    const moonBump = loadPlanetTexture(
      new URL('./assets/textures/moon-bump.png', import.meta.url).href
    );

    const sunGroup = new THREE.Group();
    sunGroup.name = 'solar-sun';
    sunGroup.position.copy(sunPosition);

    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(88, 48, 36),
      new THREE.MeshBasicMaterial({ map: sunTexture })
    );
    sunMesh.name = 'sun-surface';
    sunGroup.add(sunMesh);

    const sunGlow = new THREE.Mesh(
      new THREE.SphereGeometry(108, 40, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffa34d,
        transparent: true,
        opacity: 0.19,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    sunGlow.name = 'sun-corona';
    sunGroup.add(sunGlow);
    scene.add(sunGroup);

    const sunlight = new THREE.PointLight(0xffd4a0, 1800, 18000, 2);
    sunlight.position.copy(sunPosition);
    scene.add(sunlight);

    const orbitGroup = new THREE.Group();
    orbitGroup.name = 'planetary-orbit-paths';

    Object.entries(orbitSettings).forEach(([id, settings]) => {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i < 180; i++) {
        points.push(getOrbitPosition(settings, (i / 180) * Math.PI * 2));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: 0x6685aa,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      });
      const orbit = new THREE.LineLoop(geometry, material);
      orbit.name = `orbit-path-${id}`;
      orbitGroup.add(orbit);
    });

    scene.add(orbitGroup);

    const earthMoonPivot = new THREE.Group();
    earthMoonPivot.name = 'earth-moon-orbit';

    initialPlanets.forEach((planet) => {
      const group = new THREE.Group();
      const orbit = orbitSettings[planet.id];
      group.position.copy(getOrbitPosition(orbit, orbit.phase));
      group.name = `planet-group-${planet.id}`;

      const textures = planetTextureFiles[planet.id];
      if (!textures) throw new Error(`Missing planetary textures for ${planet.id}`);

      const albedo = loadPlanetTexture(textures.albedo, true);
      const bump = loadPlanetTexture(textures.bump);

      const bodyMaterial = new THREE.MeshStandardMaterial({
        map: albedo,
        bumpMap: bump,
        bumpScale: planet.id === 'verdant' ? 0.7 : 1.05,
        roughness: 0.92,
        metalness: 0.0,
      });

      const globe = new THREE.Mesh(
        new THREE.SphereGeometry(planet.size, 64, 48),
        bodyMaterial
      );
      globe.name = 'planet-surface';
      group.add(globe);

      if (planet.id === 'verdant') {
        const clouds = new THREE.Mesh(
          new THREE.SphereGeometry(planet.size * 1.012, 64, 48),
          new THREE.MeshLambertMaterial({
            map: earthCloudTexture,
            transparent: true,
            opacity: 0.76,
            depthWrite: false,
          })
        );
        clouds.name = 'earth-cloud-layer';
        group.add(clouds);

        const nightLights = new THREE.Mesh(
          new THREE.SphereGeometry(planet.size * 1.004, 64, 48),
          new THREE.MeshBasicMaterial({
            map: earthNightTexture,
            transparent: true,
            opacity: 0.62,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        nightLights.name = 'earth-night-lights';
        group.add(nightLights);
      }

      if (planet.id === 'thalassa') {
        const rings = new THREE.Mesh(
          new THREE.RingGeometry(planet.size * 1.35, planet.size * 2.45, 160),
          new THREE.MeshBasicMaterial({
            map: saturnRingTexture,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.94,
            depthWrite: false,
          })
        );
        rings.name = 'saturn-rings';
        rings.rotation.x = -Math.PI / 2.35;
        group.add(rings);
      }

      const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(planet.size * 1.16, 40, 28),
        new THREE.MeshBasicMaterial({
          color: planet.color,
          transparent: true,
          opacity: planet.id === 'verdant' ? 0.16 : 0.11,
          side: THREE.BackSide,
          depthWrite: false,
        })
      );
      atmosphere.name = 'planet-atmosphere';
      group.add(atmosphere);

      if (planet.id === 'verdant') {
        const moon = new THREE.Mesh(
          new THREE.SphereGeometry(6.2, 40, 32),
          new THREE.MeshStandardMaterial({
            map: moonAlbedo,
            bumpMap: moonBump,
            bumpScale: 0.75,
            roughness: 1,
          })
        );
        moon.name = 'earth-moon';
        moon.position.set(55, 3, 0);
        earthMoonPivot.add(moon);
        group.add(earthMoonPivot);
      }

      scene.add(group);
      planetGroups.set(planet.id, group);

      const surfaceData = makeSurface(planet, planet.position[1] + planet.size);
      surfaceData.group.visible = false;
      scene.add(surfaceData.group);
      surfaces.set(planet.id, surfaceData.group);
      surfaceObstacles.set(planet.id, surfaceData.obstacles);
    });

    const surfaceSky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 16),
      new THREE.MeshBasicMaterial({ color: '#92c5e7', side: THREE.BackSide })
    );
    surfaceSky.visible = false;
    scene.add(surfaceSky);

    const ship = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xc9d8eb, metalness: 0.82, roughness: 0.26 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x182943, metalness: 0.7, roughness: 0.34 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x3bdcff });
    const body = new THREE.Mesh(new THREE.ConeGeometry(1.15, 5.8, 8), hullMat);
    body.rotation.x = -Math.PI / 2;
    ship.add(body);
    const cockpit = new THREE.Mesh(
      new THREE.SphereGeometry(0.78, 24, 18),
      new THREE.MeshPhysicalMaterial({ color: 0x2a9ec8, metalness: 0.4, roughness: 0.12, transmission: 0.18, transparent: true, opacity: 0.9 })
    );
    cockpit.position.set(0, 0.45, -0.35);
    cockpit.scale.set(0.78, 0.55, 1.15);
    ship.add(cockpit);
    [-1, 1].forEach(side => {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.18, 1.65), hullMat);
      wing.position.set(side * 1.6, -0.1, 0.8);
      wing.rotation.y = side * -0.12;
      ship.add(wing);
      const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.15, 16), darkMat);
      engine.rotation.x = Math.PI / 2;
      engine.position.set(side * 1.45, -0.08, 2.4);
      ship.add(engine);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.23, 2.4, 16), glowMat);
      flame.rotation.x = Math.PI / 2;
      flame.position.set(side * 1.45, -0.08, 4.05);
      flame.name = 'engine-flame';
      ship.add(flame);
    });
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.35, 1.25), hullMat);
    fin.position.set(0, 0.65, 1.2);
    ship.add(fin);
    scene.add(ship);

    const state: FlightScene = {
      ship, camera, renderer, scene, planets: planetGroups, surfaces,
      keys: new Set<string>(), velocity: new THREE.Vector3(),
      yaw: 0, pitch: 0, roll: 0, stars, mode: 'space',
      activePlanet: null, landingProgress: 0, surfaceGroundY: 0,
      originalBackground, originalFog, surfaceSky, autopilotTarget: null, surfaceObstacles,
      asteroids, remoteShips: new Map<string, THREE.Group>(),
    };
    sceneRef.current = state;
    let frame = 0;
    let last = performance.now();
    let currentSpeed = 0;
    let telemetryAt = 0;
    let mapTelemetryAt = 0;

    const orbitAngles: Record<string, number> = {};
    Object.entries(orbitSettings).forEach(([id, settings]) => {
      orbitAngles[id] = settings.phase;
    });

    const resize = () => {
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    const keyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) e.preventDefault();
      state.keys.add(key);
    };
    const keyUp = (e: KeyboardEvent) => state.keys.delete(e.key.toLowerCase());
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);

    const animate = (now: number) => {
      frame = requestAnimationFrame(animate);
      const dt = Math.min((now - last) / 1000, 0.04);
      last = now;

      if (state.mode === 'landing') {
        state.landingProgress = Math.min(1, state.landingProgress + dt / 3.4);
        const t = state.landingProgress;
        const eased = t * t * (3 - 2 * t);
        const targetY = state.surfaceGroundY + 11;
        const startY = state.surfaceGroundY + 150;
        ship.position.y = THREE.MathUtils.lerp(startY, targetY, eased);
        ship.position.x += Math.sin(now * 0.001) * dt * 0.6;
        camera.position.lerp(new THREE.Vector3(ship.position.x, ship.position.y + 7, ship.position.z + 19), 1 - Math.pow(0.001, dt));
        camera.lookAt(ship.position.x, ship.position.y - 2, ship.position.z - 24);
        if (t >= 1) {
          state.mode = 'surface';
          setFlightMode('surface');
          setMessage('SURFACE LANDING COMPLETE · PLANETARY TERRAIN ACCESSIBLE');
        }
      } else {
        const forward = state.keys.has('w') || state.keys.has('arrowup') || Boolean(state.autopilotTarget);
        const reverse = state.keys.has('s') || state.keys.has('arrowdown');
        const left = state.keys.has('a') || state.keys.has('arrowleft');
        const right = state.keys.has('d') || state.keys.has('arrowright');
        const up = state.keys.has(' ');
        const down = state.keys.has('f');
        const climb = state.keys.has('r');
        const descend = state.keys.has('f');
        const boost = state.keys.has('shift');
        const turn = (state.mode === 'surface' ? 0.95 : 1.25) * dt;
        if (state.autopilotTarget && state.mode === 'space') {
          const destination = initialPlanets.find(item => item.id === state.autopilotTarget);
          const liveDestination = destination
            ? state.planets.get(destination.id)
            : undefined;
          if (destination && liveDestination) {
            const delta = liveDestination.position.clone().sub(ship.position);
            const desiredYaw = Math.atan2(-delta.x, -delta.z);
            const desiredPitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
            const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
            state.yaw += wrap(desiredYaw - state.yaw) * Math.min(1, dt * 2.8);
            state.pitch += wrap(desiredPitch - state.pitch) * Math.min(1, dt * 2.8);
            if (delta.length() < destination.size * 2.55) {
              state.autopilotTarget = null;
              currentSpeed = 0;
            }
          } else state.autopilotTarget = null;
        }
        if (left) state.yaw += turn;
        if (right) state.yaw -= turn;
        if (up) state.pitch += turn;
        if (down) state.pitch -= turn;
        if (state.keys.has('q')) state.roll += turn * 1.4;
        if (state.keys.has('e')) state.roll -= turn * 1.4;
        const desired = forward ? (boost ? 78 : 38) : reverse ? -18 : 0;
        currentSpeed += (desired - currentSpeed) * Math.min(1, dt * 1.8);
        ship.rotation.set(state.pitch, state.yaw, state.roll, 'YXZ');
        const direction = new THREE.Vector3(0, 0, -1).applyEuler(ship.rotation);
        const previousPosition = ship.position.clone();
        ship.position.addScaledVector(direction, currentSpeed * dt);
        ship.position.y += ((climb ? 1 : 0) - (descend ? 1 : 0)) * (state.mode === 'surface' ? 34 : 48) * dt;
        if (state.mode === 'space') {
          const impact = state.asteroids.find(item => ship.position.distanceTo(item.mesh.position) < item.radius + 3.2);
          if (impact) {
            ship.position.copy(previousPosition);
            currentSpeed *= 0.18;
            if (now - telemetryAt > 900) setMessage('ASTEROID IMPACT · SOLID ROCK FIELD · CHANGE COURSE');
          }
        }
        if (state.mode === 'surface' && state.activePlanet) {
          const surfacePlanet = initialPlanets.find(item => item.id === state.activePlanet);
          if (surfacePlanet) {
            const seed = surfacePlanet.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
            const surfaceOrigin = state.surfaces.get(surfacePlanet.id)?.position;
            const originX = surfaceOrigin?.x ?? surfacePlanet.position[0];
            const originZ = surfaceOrigin?.z ?? surfacePlanet.position[2];
            const localX = ship.position.x - originX;
            const localZ = ship.position.z - originZ;
            const groundY = state.surfaceGroundY + terrainHeight(localX, localZ, seed);
            const obstacle = (state.surfaceObstacles.get(surfacePlanet.id) ?? []).find(item => Math.hypot(localX - item.x, localZ - item.z) < item.radius + 3 && ship.position.y < state.surfaceGroundY + item.topY + 8);
            if (obstacle) {
              ship.position.x = previousPosition.x;
              ship.position.z = previousPosition.z;
              ship.position.y = Math.max(ship.position.y, state.surfaceGroundY + obstacle.topY + 12);
              currentSpeed *= 0.22;
              if (now - telemetryAt > 900) setMessage('TERRAIN IMPACT · OBSTACLE AHEAD · CHANGE COURSE OR GAIN ALTITUDE');
            }
            const safeGroundY = state.surfaceGroundY + terrainHeight(ship.position.x - originX, ship.position.z - originZ, seed) + 8;
            if (ship.position.y < safeGroundY) {
              ship.position.y = safeGroundY;
              currentSpeed *= 0.42;
              if (now - telemetryAt > 900) setMessage('GROUND COLLISION · HULL SCRAPE · PULL UP');
            }
            ship.position.y = Math.min(state.surfaceGroundY + 320, ship.position.y);
          }
          camera.position.lerp(ship.position.clone().add(new THREE.Vector3(0, 5.3, 14).applyEuler(ship.rotation)), 1 - Math.pow(0.001, dt));
          camera.lookAt(ship.position.clone().add(direction.clone().multiplyScalar(16)));
        } else {
          const desiredCamera = ship.position.clone().add(new THREE.Vector3(0, 5.3, 14).applyEuler(ship.rotation));
          camera.position.lerp(desiredCamera, 1 - Math.pow(0.001, dt));
          camera.lookAt(ship.position.clone().add(direction.clone().multiplyScalar(16)));
        }
        ship.children.forEach(child => {
          if (child.name === 'engine-flame') child.scale.setScalar(forward ? (boost ? 1.5 + Math.sin(now * 0.035) * 0.15 : 0.85) : 0.08);
        });
      }

      if (state.mode === 'space') {
        Object.entries(orbitSettings).forEach(([id, settings]) => {
          orbitAngles[id] += dt * settings.speed;
          const body = planetGroups.get(id);
          if (body) body.position.copy(getOrbitPosition(settings, orbitAngles[id]));
        });

        earthMoonPivot.rotation.y += dt * 0.19;
        sunMesh.rotation.y += dt * 0.025;
        sunGlow.rotation.y -= dt * 0.012;

        stars.rotation.y += dt * 0.0015;
        galaxy.rotation.z += dt * 0.000035;
        state.asteroids.forEach(item => { item.mesh.rotation.x += dt * 0.035; item.mesh.rotation.y += dt * 0.022; });
        planetGroups.forEach((group, planetId) => {
          const planetIndex = initialPlanets.findIndex(planet => planet.id === planetId);
          const planet = initialPlanets[planetIndex];
          if (!planet) return;
          group.rotation.y += dt * (0.025 + planetIndex * 0.006);
          const earthClouds = group.getObjectByName('earth-cloud-layer');
          if (earthClouds) earthClouds.rotation.y += dt * 0.025;
          const distance = camera.position.distanceTo(group.position);
          const atmosphere = group.children.find(child => child instanceof THREE.Mesh && child.geometry instanceof THREE.SphereGeometry && (child.geometry.parameters.radius ?? 0) > planet.size * 1.1) as THREE.Mesh | undefined;
          if (atmosphere && atmosphere.material instanceof THREE.MeshBasicMaterial) {
            atmosphere.material.opacity = THREE.MathUtils.clamp(0.2 - Math.max(0, distance - 1800) * 0.000008, 0.1, 0.2);
          }
        });
        let closest: string | null = null;
        let closestDistance = Infinity;
        initialPlanets.forEach(planet => {
          const body = planetGroups.get(planet.id);
          if (!body) return;
          const distance = ship.position.distanceTo(body.position);
          if (distance < planet.size * 3.25 && distance < closestDistance) {
            closest = planet.id;
            closestDistance = distance;
          }
        });
        if (closest !== nearPlanetRef.current) {
          nearPlanetRef.current = closest;
          setNearPlanet(closest);
        }

        if (now - mapTelemetryAt > 700) {
          mapTelemetryAt = now;
          setPlanets(old => old.map(planet => {
            const body = planetGroups.get(planet.id);
            if (!body) return planet;
            return {
              ...planet,
              position: [
                body.position.x,
                body.position.y,
                body.position.z,
              ] as [number, number, number],
            };
          }));
        }
      }
      if (state.mode === 'surface' && state.activePlanet) {
        const surface = state.surfaces.get(state.activePlanet);
        if (surface) {
          surfaceSky.position.copy(ship.position);
          surface.children.forEach(child => {
            if (child.name === 'volcano-flame') child.scale.setScalar(0.9 + Math.sin(now * 0.006 + child.position.x) * 0.18);
            if (child.name === 'ocean-surface') child.rotation.z = Math.sin(now * 0.00035) * 0.012;
            if (child.name === 'planet-creature') {
              const patrolX = Number(child.userData.patrolX ?? child.position.x);
              const patrolZ = Number(child.userData.patrolZ ?? child.position.z);
              child.position.x = patrolX + Math.sin(now * 0.00045 + patrolZ) * 13;
              child.position.z = patrolZ + Math.cos(now * 0.00032 + patrolX) * 11;
              child.position.y = terrainHeight(child.position.x, child.position.z, state.activePlanet!.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) + 8 + Math.sin(now * 0.003) * 1.5;
              child.rotation.y = Math.sin(now * 0.0004) * 0.45;
              child.rotation.z = Math.sin(now * 0.0017) * 0.08;
            }
          });
        }
      }
      state.remoteShips.forEach(remote => {
        const targetPosition = remote.userData.targetPosition as THREE.Vector3 | undefined;
        if (!targetPosition) return;

        const smoothing = 1 - Math.exp(-12 * dt);
        remote.position.lerp(targetPosition, smoothing);

        const targetYaw = Number(remote.userData.targetYaw ?? remote.rotation.y);
        const targetPitch = Number(remote.userData.targetPitch ?? remote.rotation.x);
        const yawDifference = Math.atan2(
          Math.sin(targetYaw - remote.rotation.y),
          Math.cos(targetYaw - remote.rotation.y)
        );

        remote.rotation.y += yawDifference * smoothing;
        remote.rotation.x += (targetPitch - remote.rotation.x) * smoothing;
      });

      renderer.render(scene, camera);
      if (now - telemetryAt > 350) {
        telemetryAt = now;
        setSpeed(Math.max(0, Math.round(Math.abs(currentSpeed) * (state.mode === 'surface' ? 2.5 : 12))));
        setCoordinates([state.ship.position.x, state.ship.position.y, state.ship.position.z]);
      }
    };
    animate(performance.now());

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      renderer.dispose();
      if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement);
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => material.dispose());
        }
      });
      planetTextures.forEach(texture => texture.dispose());
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!gameStarted) return;
    const connection = ws.connect();
    let heartbeat = 0;
    let alive = true;
    const applyPlayer = (player: { id: string; name?: string; x: number; y: number; z: number; yaw?: number; pitch?: number; removed?: boolean }) => {
      if (!alive || player.id === pilotIdRef.current) return;
      const state = sceneRef.current;
      if (!state) return;
      if (player.removed) {
        const existing = state.remoteShips.get(player.id);
        if (existing) {
          state.scene.remove(existing);
          state.remoteShips.delete(player.id);
        }
        setOnlinePlayers(state.remoteShips.size + 1);
        return;
      }
      let remote = state.remoteShips.get(player.id);
      if (!remote) {
        remote = new THREE.Group();
        const hull = new THREE.Mesh(new THREE.ConeGeometry(1.05, 5.2, 7), new THREE.MeshStandardMaterial({ color: 0x8c9cff, metalness: 0.72, roughness: 0.28, emissive: 0x253d9a, emissiveIntensity: 0.35 }));
        hull.rotation.x = -Math.PI / 2;
        remote.add(hull);
        const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.58, 12, 10), new THREE.MeshBasicMaterial({ color: 0x63e6ff }));
        cockpit.position.set(0, 0.35, -0.3);
        remote.add(cockpit);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.14, 1.2), new THREE.MeshStandardMaterial({ color: 0x4b5f94, metalness: 0.65, roughness: 0.32 }));
        wing.position.z = 0.65;
        remote.add(wing);
        remote.scale.setScalar(3.5);
        const locatorRing = new THREE.Mesh(
          new THREE.TorusGeometry(3.1, 0.12, 8, 36),
          new THREE.MeshBasicMaterial({ color: 0x5de7ff, transparent: true, opacity: 0.92 })
        );
        locatorRing.rotation.x = Math.PI / 2;
        locatorRing.position.y = -0.35;
        remote.add(locatorRing);
        const labelCanvas = document.createElement('canvas');
        labelCanvas.width = 256;
        labelCanvas.height = 64;
        const context = labelCanvas.getContext('2d');
        if (context) {
          context.fillStyle = 'rgba(3, 10, 28, 0.72)';
          context.fillRect(0, 0, 256, 64);
          context.strokeStyle = '#62dfff';
          context.strokeRect(1, 1, 254, 62);
          context.fillStyle = '#eaf7ff';
          context.font = 'bold 25px Arial';
          context.textAlign = 'center';
          context.fillText(String(player.name || 'PILOT').slice(0, 18), 128, 41);
        }
        const labelTexture = new THREE.CanvasTexture(labelCanvas);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false }));
        label.scale.set(4.8, 1.2, 1);
        label.position.y = 2.4;
        remote.add(label);
        remote.userData.playerId = player.id;
        state.scene.add(remote);
        state.remoteShips.set(player.id, remote);
      }
      const targetPosition = new THREE.Vector3(
        Number(player.x), Number(player.y), Number(player.z)
      );
      if (!remote.userData.hasReceivedPosition) {
        remote.position.copy(targetPosition);
        remote.userData.hasReceivedPosition = true;
      }
      remote.userData.targetPosition = targetPosition;
      remote.userData.targetYaw = Number(player.yaw || 0);
      remote.userData.targetPitch = Number(player.pitch || 0);
      setOnlinePlayers(state.remoteShips.size + 1);
    };

    connection.onMessage((message: any) => {
      if (message?.type !== 'entity.update' || message.payload?.entity_type !== 'galaxy') return;
      const player = message.payload.data;
      if (player && typeof player.id === 'string') applyPlayer(player);
    });
    connection.onClose(() => setMultiplayerStatus('RECONNECTING'));
    connection.onError(() => setMultiplayerStatus('OFFLINE'));
    connection.ready.then(async () => {
      if (!alive || !connection.connectionId) return;
      await api.post('/api/subscriptions', { entity_type: 'galaxy', entity_id: 'main', connection_id: connection.connectionId });
      const response = await api.get('/api/players');
      (response.data?.players || []).forEach((player: any) => applyPlayer(player));
      setMultiplayerStatus('LIVE');
    }).catch(() => setMultiplayerStatus('OFFLINE'));

    let heartbeatInFlight = false;
    heartbeat = window.setInterval(() => {
      const state = sceneRef.current;
      if (!alive || !state || !connection.connectionId || heartbeatInFlight) return;
      heartbeatInFlight = true;
      api.post('/api/players', {
        id: pilotIdRef.current,
        name: pilotName,
        x: Number(state.ship.position.x.toFixed(2)),
        y: Number(state.ship.position.y.toFixed(2)),
        z: Number(state.ship.position.z.toFixed(2)),
        yaw: Number(state.yaw.toFixed(3)),
        pitch: Number(state.pitch.toFixed(3)),
        connection_id: connection.connectionId,
      }).catch(() => setMultiplayerStatus('OFFLINE'))
        .finally(() => { heartbeatInFlight = false; });
    }, 120);

    return () => {
      alive = false;
      window.clearInterval(heartbeat);
      if (connection.connectionId) {
        api.post('/api/subscriptions/remove', { entity_type: 'galaxy', entity_id: 'main', connection_id: connection.connectionId }).catch(() => undefined);
        api.delete(`/api/players/${pilotIdRef.current}`).catch(() => undefined);
      }
      connection.disconnect();
    };
  }, [gameStarted, pilotName]);

  const setKey = useCallback((key: string, down: boolean) => {
    const keys = sceneRef.current?.keys;
    if (!keys) return;
    if (down) keys.add(key);
    else keys.delete(key);
  }, []);

  const navigateToTarget = () => {
    const state = sceneRef.current;
    if (!state || state.mode !== 'space') return;
    state.autopilotTarget = target;
    setMessage(`AUTOPILOT ENGAGED · COURSE SET FOR ${currentTarget.name.toUpperCase()}`);
  };

  const descendToPlanet = () => {
    const state = sceneRef.current;
    const planet = planets.find(item => item.id === nearPlanet);
    if (!state || !planet || state.mode !== 'space') return;
    const body = state.planets.get(planet.id);
    if (!body) return;
    const livePosition = body.position.clone();
    const surfaceY = livePosition.y + planet.size;
    state.autopilotTarget = null;
    state.mode = 'landing';
    state.activePlanet = planet.id;
    state.landingProgress = 0;
    state.surfaceGroundY = surfaceY;
    state.keys.clear();
    state.surfaces.forEach(surface => { surface.visible = false; });
    const landingSurface = state.surfaces.get(planet.id)!;
    landingSurface.position.set(livePosition.x, surfaceY, livePosition.z);
    landingSurface.visible = true;
    state.planets.forEach(group => { group.visible = false; });
    const orbitPaths = state.scene.getObjectByName('planetary-orbit-paths');
    if (orbitPaths) orbitPaths.visible = false;
    state.stars.visible = false;
    state.surfaceSky.visible = true;
    state.surfaceSky.position.copy(state.ship.position);
    state.scene.background = new THREE.Color('#92c5e7');
    state.scene.fog = new THREE.Fog('#a9d4e9', 180, 760);
    state.ship.position.set(livePosition.x, surfaceY + 150, livePosition.z + 35);
    state.ship.rotation.set(-0.16, 0, 0, 'YXZ');
    state.yaw = 0; state.pitch = -0.16; state.roll = 0;
    setActivePlanet(planet);
    setFlightMode('landing');
    nearPlanetRef.current = null;
    setNearPlanet(null);
    setMessage(`ATMOSPHERIC ENTRY · DESCENDING TOWARD ${planet.name.toUpperCase()}`);
  };

  const leavePlanet = () => {
    const state = sceneRef.current;
    const planet = planets.find(item => item.id === state?.activePlanet);
    if (!state || !planet) return;
    const body = state.planets.get(planet.id);
    if (!body) return;
    const livePosition = body.position.clone();
    state.mode = 'space';
    state.autopilotTarget = null;
    state.activePlanet = null;
    state.surfaces.forEach(surface => { surface.visible = false; });
    state.planets.forEach(group => { group.visible = true; });
    const orbitPaths = state.scene.getObjectByName('planetary-orbit-paths');
    if (orbitPaths) orbitPaths.visible = true;
    state.stars.visible = true;
    state.surfaceSky.visible = false;
    state.scene.background = state.originalBackground.clone();
    state.scene.fog = state.originalFog;
    state.ship.position.set(
      livePosition.x + planet.size * 4,
      livePosition.y + planet.size + 75,
      livePosition.z + planet.size * 4
    );
    state.ship.rotation.set(Math.PI / 2, 0, 0);
    state.yaw = 0; state.pitch = Math.PI / 2; state.roll = 0;
    state.keys.clear();
    setActivePlanet(null);
    setFlightMode('space');
    setMessage(`ASCENT COMPLETE · ${planet.name.toUpperCase()} ORBIT RESTORED`);
  };

  const scanTarget = () => {
    const state = sceneRef.current;
    const body = state?.planets.get(target);
    if (!state || !body || state.mode !== 'space') return;
    const distance = state.ship.position.distanceTo(body.position);
    if (distance > 45) {
      setMessage(`TARGET OUT OF RANGE · ${Math.round(distance)} UNITS · CLOSE DISTANCE`);
      return;
    }
    setScanning(true);
    setMessage('DEEP SCAN IN PROGRESS · ANALYSING PLANETARY SIGNATURE');
    window.setTimeout(() => {
      setPlanets(old => old.map(p => p.id === target ? { ...p, scanned: true } : p));
      setScanning(false);
      setMessage(`SCAN COMPLETE · ${currentTarget.name.toUpperCase()} ADDED TO YOUR DISCOVERY LOG`);
    }, 1800);
  };

  const engageBoost = (down: boolean) => {
    setBoosting(down);
    setKey('shift', down);
  };

  const resetFlight = () => {
    const state = sceneRef.current;
    if (!state) return;
    if (state.mode !== 'space') {
      leavePlanet();
      return;
    }
    state.ship.position.set(0, 0, 0);
    state.ship.rotation.set(0, 0, 0);
    state.velocity.set(0, 0, 0);
    state.yaw = 0; state.pitch = 0; state.roll = 0;
    setMessage('FLIGHT VECTOR RESET · HOME POSITION RESTORED');
  };

  const hudClass = hudVisible ? '' : 'hud-hidden';

  return (
    <main className={`explorer ${hudClass}`}>
      <div className="space-canvas" ref={mountRef} />
      <div className="vignette" />
      {!gameStarted && <div className="pilot-entry-screen">
        <form className="pilot-entry-card" onSubmit={(event) => {
          event.preventDefault();
          const cleanName = usernameDraft.trim().replace(/\s+/g, ' ');
          if (cleanName.length < 3 || cleanName.length > 18) {
            setUsernameError('Choose a username between 3 and 18 characters.');
            return;
          }
          setPilotName(cleanName);
          localStorage.setItem('galaxy-explorer-username', cleanName);
          setUsernameError('');
          setGameStarted(true);
        }}>
          <div className="pilot-entry-mark"><Rocket size={25} /></div>
          <div className="pilot-entry-eyebrow">MARTINS GALAXY EXPLORER</div>
          <h1>Identify your <span>pilot.</span></h1>
          <p>Choose the username other explorers will see above your jet throughout the Solar System.</p>
          <label htmlFor="pilot-username">PILOT USERNAME</label>
          <input id="pilot-username" value={usernameDraft} onChange={(event) => { setUsernameDraft(event.target.value.slice(0, 18)); setUsernameError(''); }} maxLength={18} minLength={3} autoComplete="nickname" placeholder="Enter your username" />
          <div className="pilot-entry-note">3–18 characters · visible to other pilots</div>
          {usernameError && <div className="pilot-entry-error">{usernameError}</div>}
          <button type="submit">ENTER THE GALAXY <span>↗</span></button>
        </form>
      </div>}
      <button className="hud-toggle" onClick={() => setHudVisible(value => !value)} aria-label={hudVisible ? 'Hide HUD' : 'Show HUD'}>
        {hudVisible ? <><EyeOff size={15} /> HIDE HUD</> : <><Eye size={16} /> SHOW HUD</>}
      </button>
      <div className="glass" style={{ position: 'absolute', zIndex: 8, top: 84, right: 18, padding: '9px 13px', minWidth: 142, pointerEvents: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, font: '10px monospace', letterSpacing: 1, color: multiplayerStatus === 'LIVE' ? '#70edb0' : '#e9bd75' }}><span className="live-dot" /> MULTIPLAYER {multiplayerStatus}</div>
        <div style={{ marginTop: 5, font: '11px monospace', color: '#dcecff' }}>{onlinePlayers} PILOT{onlinePlayers === 1 ? '' : 'S'} · {pilotName}</div>
      </div>

      {hudVisible && <>
        <header className="topbar">
          <div className="brand"><div className="brand-mark"><Rocket size={19} /></div><div><strong>MARTINS <span>GALAXY</span></strong><small>EXPLORATION DIVISION</small></div></div>
          <div className="top-status"><span className="live-dot" /> SYSTEM ONLINE <i /> {flightMode === 'surface' ? 'PLANET SURFACE' : flightMode === 'landing' ? 'ATMOSPHERIC ENTRY' : 'SECTOR 07-G'}</div>
          <button className="icon-button" onClick={() => setShowMap(value => !value)} aria-label="Toggle star chart"><Radar size={19} /></button>
        </header>

        <section className="mission-panel glass">
          <div className="eyebrow"><span className="eyebrow-line" /> CURRENT EXPEDITION</div>
          <h1>{flightMode === 'surface' ? <>New worlds. <em>New ground.</em></> : flightMode === 'landing' ? <>Entering the <em>atmosphere.</em></> : <>Beyond the <em>known.</em></>}</h1>
          <p>{flightMode === 'surface' && activePlanet ? `You are exploring the terrain of ${activePlanet.name}. Fly low over the landscape or launch back to orbit.` : 'Explore the Solar System. Nine worlds await beyond the stars, nebulae and asteroid belts.'}</p>
          <div className="mission-progress"><div><span>DISCOVERIES</span><b>{scannedCount} <small>/ {planets.length}</small></b></div><div className="progress-track"><span style={{ width: `${scannedCount / planets.length * 100}%` }} /></div></div>
        </section>

        <div className="right-stack">
          <div className="readout glass"><div className="readout-label"><Gauge size={14} /> VELOCITY</div><div className="readout-value">{speed.toLocaleString()} <small>KM/H</small></div><div className="speed-track"><span style={{ width: `${Math.min(100, speed / 9)}%` }} /></div></div>
          <div className="readout glass"><div className="readout-label"><Shield size={14} /> HULL SHIELD</div><div className="readout-value">{shield}<small>%</small></div><div className="shield-track"><span style={{ width: `${shield}%` }} /></div></div>
          <div className="readout glass"><div className="readout-label"><Activity size={14} /> SHIP STATUS</div><div className="status-good">NOMINAL</div><small className="readout-foot">All systems operational</small></div>
        </div>

        {flightMode === 'space' && <div className="target-panel glass">
          <div className="panel-heading"><span><Target size={14} /> NAVIGATION TARGET</span><span className="target-count">{String(planets.findIndex(p => p.id === target) + 1).padStart(2, '0')} — {String(planets.length).padStart(2, '0')}</span></div>
          <div className="target-name">{currentTarget.name}</div><div className="target-kind">{currentTarget.kind}</div><p>{currentTarget.description}</p>
          <div className="target-actions">
            <button className="primary-button" onClick={navigateToTarget}><Target size={15} /> NAVIGATE</button>
            <button className="square-button" onClick={scanTarget} disabled={scanning} aria-label="Scan target"><Scan size={15} /></button>
            <button className="square-button" onClick={() => setMessage(`NAVIGATION LOCKED · ${currentTarget.name.toUpperCase()}`)} aria-label="Lock target"><Crosshair size={16} /></button>
          </div>
          {nearPlanet && <button className="land-button" onClick={descendToPlanet}><Mountain size={15} /> DESCEND TO {planets.find(p => p.id === nearPlanet)?.name.toUpperCase()}</button>}
          {currentTarget.scanned && <div className="scanned-label"><Sparkles size={12} /> DISCOVERY LOGGED</div>}
        </div>}

        {flightMode === 'surface' && activePlanet && <div className="target-panel glass surface-panel">
          <div className="panel-heading"><span><Mountain size={14} /> PLANETARY SURFACE</span><span className="target-count">LAND MODE</span></div>
          <div className="target-name">{activePlanet.name}</div><div className="target-kind">TERRAIN EXPLORATION</div>
          <p>Terrain is loaded below the atmosphere. Navigate across ridges, rock fields and distant peaks.</p>
          <button className="launch-button" onClick={leavePlanet}><Rocket size={15} /> LAUNCH BACK TO SPACE</button>
        </div>}

        <div className="planet-strip glass">
          <div className="strip-title"><Globe2 size={14} /> SOLAR SYSTEM · NINE WORLDS</div>
          <div className="planet-list">{planets.map((planet, index) => (
            <button key={planet.id} className={`planet-chip ${target === planet.id ? 'selected' : ''}`} onClick={() => { setTarget(planet.id); setMessage(`NAVIGATION TARGET UPDATED · ${planet.name.toUpperCase()}`); }}>
              <span className="planet-dot" style={{ background: planet.color, boxShadow: `0 0 12px ${planet.color}` }} />
              <span><b>{String(index + 1).padStart(2, '0')} · {planet.name}</b><small>{planet.scanned ? 'SCANNED' : planet.kind.toUpperCase()}</small></span>
              {planet.scanned && <span className="check">✓</span>}
            </button>
          ))}</div>
        </div>

        <div className="bottom-hud">
          <div className="comms glass"><span className="comms-icon"><Satellite size={15} /></span><div><small>MISSION CONTROL</small><p>{message}</p></div></div>
        </div>
      </>}
      <div className="persistent-controls">
          <div className="flight-controls glass">
            <div className="control-hint"><span>FLIGHT CONTROLS</span><small>WASD · ASCEND / DESCEND · SPACE · Q / E</small></div>
            <div className="control-row">
              <div className="dpad">
                <button onPointerDown={() => setKey('arrowup', true)} onPointerUp={() => setKey('arrowup', false)} onPointerLeave={() => setKey('arrowup', false)} aria-label="Pitch up">▲</button>
                <div>
                  <button onPointerDown={() => setKey('arrowleft', true)} onPointerUp={() => setKey('arrowleft', false)} onPointerLeave={() => setKey('arrowleft', false)} aria-label="Turn left">◀</button>
                  <button onPointerDown={() => setKey('arrowdown', true)} onPointerUp={() => setKey('arrowdown', false)} onPointerLeave={() => setKey('arrowdown', false)} aria-label="Pitch down">▼</button>
                  <button onPointerDown={() => setKey('arrowright', true)} onPointerUp={() => setKey('arrowright', false)} onPointerLeave={() => setKey('arrowright', false)} aria-label="Turn right">▶</button>
                </div>
              </div>
              <div className="throttle">
                <button className="throttle-up" onPointerDown={() => setKey('w', true)} onPointerUp={() => setKey('w', false)} onPointerLeave={() => setKey('w', false)}>THRUST <b>▲</b></button>
                <button className={boosting ? 'boost active' : 'boost'} onPointerDown={() => engageBoost(true)} onPointerUp={() => engageBoost(false)} onPointerLeave={() => engageBoost(false)}><Zap size={14} /> BOOST</button>
              </div>
              <div className="altitude-controls" aria-label="Altitude controls">
                <button className="ascend-button" onPointerDown={() => setKey('r', true)} onPointerUp={() => setKey('r', false)} onPointerLeave={() => setKey('r', false)} onPointerCancel={() => setKey('r', false)}><span>▲</span> ASCEND</button>
                <button className="descend-button" onPointerDown={() => setKey('f', true)} onPointerUp={() => setKey('f', false)} onPointerLeave={() => setKey('f', false)} onPointerCancel={() => setKey('f', false)}><span>▼</span> DESCEND</button>
              </div>
              <button className="reset-button" onClick={resetFlight}>{flightMode === 'surface' ? 'RETURN' : 'RESET'}<br />VECTOR</button>
            </div>
          </div>
        </div>

        {hudVisible && showMap && <div className="map-overlay glass">
          <div className="map-title"><span><Radar size={15} /> LIVE NAVIGATION · SOLAR SYSTEM</span><button onClick={() => setShowMap(false)}>×</button></div>
          <div className="map-visual live-map">
            <div className="map-axis map-axis-x" /><div className="map-axis map-axis-z" />
            <div className="map-sun" title="THE SUN" />
            {planets.map(planet => (
              <div key={planet.id} className={`map-body ${target === planet.id ? 'map-body-target' : ''}`} style={{ left: `${Math.max(5, Math.min(95, 50 + planet.position[0] / 4000 * 45))}%`, top: `${Math.max(5, Math.min(95, 50 + (planet.position[2] + 6500) / 4000 * 45))}%`, '--planet-color': planet.color } as React.CSSProperties} title={`${planet.name} · X ${planet.position[0].toFixed(1)} · Y ${planet.position[1].toFixed(1)} · Z ${planet.position[2].toFixed(1)}`}>
                <span />
                <small>{planet.name}</small>
              </div>
            ))}
            <div className="map-ship" style={{ left: `${Math.max(3, Math.min(97, 50 + coordinates[0] / 4000 * 45))}%`, top: `${Math.max(5, Math.min(95, 50 + (coordinates[2] + 6500) / 4000 * 45))}%` }}><span /> <small>YOU</small></div>
          </div>
          <div className="map-coordinates"><span>SHIP POSITION</span><b>X {coordinates[0].toFixed(1)} <i /> Y {coordinates[1].toFixed(1)} <i /> Z {coordinates[2].toFixed(1)}</b></div>
          <p>Live ship position and planetary locations · Coordinates update as you fly. Select any planet in the list to set your target.</p>
        </div>}
        {hudVisible && <div className="crosshair"><span /><i /></div>}
        {hudVisible && <div className="sound-toggle"><button onClick={() => setMessage('AUDIO SYSTEM NOT YET INSTALLED')} title="Sound setting">AUDIO OFF</button></div>}
      {flightMode === 'landing' && <div className="landing-overlay"><div className="landing-label">ATMOSPHERIC ENTRY</div><div className="landing-title">DESCENDING TO SURFACE</div><div className="landing-track"><span /></div><p>Stabilising flight systems · Preparing terrain</p></div>}
    </main>
  );
}

export default App;
