import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createBlackHoleAnimation } from './black-hole/martins-black-hole-animation';
import { createCinematicNebula } from './cinematic/nebula-engine';
import { createDistantGalaxies } from './cinematic/distant-galaxies';

import { api, ws } from './appdeploy-client';
import { VoiceChat, type VoiceMode, type VoicePeer } from './voice-chat';
import { GameAudio } from './audio/game-audio';
import {
  Activity, ChevronDown, Crosshair, Eye, EyeOff, Gauge, Globe2, Mic, MicOff, Mountain, Radar,
  Rocket, Satellite, Scan, Shield, Sparkles, Target, Users, Zap,
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
  loadSurfaceTerrain: (planetId: string) => void;
};

const terrainHeightSamplers = new Map<string, (x: number, z: number) => number>();

function terrainHeight(x: number, z: number, seed: number) {
  const broad = Math.sin(x * 0.018 + seed * 0.003) * 8 + Math.cos(z * 0.015 + seed * 0.002) * 7;
  const ridges = Math.sin((x + z) * 0.042 + seed * 0.005) * 3.5 + Math.cos((x - z) * 0.031 - seed * 0.004) * 3;
  const peaks = Math.pow(Math.max(0, Math.sin(x * 0.009 + Math.cos(z * 0.012 + seed * 0.002) * 2)), 3) * 30;
  const curvature = -((x * x + z * z) / (760 * 760)) * 34;
  return broad + ridges + peaks + curvature;
}

// Deterministic impact basin with a raised crater rim.
function impactCraterHeight(x: number, z: number, cx: number, cz: number, radius: number, depth: number) {
  const distance = Math.hypot(x - cx, z - cz);
  const bowl = -depth * Math.exp(-(distance * distance) / (radius * radius * 0.34));
  const rimDistance = (distance - radius * 0.88) / (radius * 0.14);
  const rim = depth * 0.24 * Math.exp(-(rimDistance * rimDistance));
  return bowl + rim;
}

// Each explorable world has its own terrain profile.
// Earth's original height function is deliberately preserved.
function surfaceTerrainHeight(planetId: string, x: number, z: number, seed: number) {
  const importedSampler = terrainHeightSamplers.get(planetId);
  if (importedSampler) return importedSampler(x, z);
  if (planetId === 'verdant') return terrainHeight(x, z, seed);

  const edge = -((x * x + z * z) / (760 * 760)) * 18;
  const variation = seed * 0.001;

  switch (planetId) {
    case 'aurelia': {
      const craters =
        impactCraterHeight(x, z, -145, -105, 82, 25) +
        impactCraterHeight(x, z, 115, -170, 62, 19) +
        impactCraterHeight(x, z, 155, 125, 94, 29) +
        impactCraterHeight(x, z, -190, 175, 48, 16) +
        impactCraterHeight(x, z, 5, 45, 38, 12);
      const highlands = Math.pow(Math.max(0, Math.sin(x * 0.012 + Math.cos(z * 0.009) * 1.7)), 2) * 17;
      return Math.sin(x * 0.014 + variation) * 3 + Math.cos(z * 0.017) * 3.5 + craters + highlands + edge;
    }

    case 'ignis': {
      const volcanicRidges = Math.pow(Math.max(0, Math.sin((x + z) * 0.018 + variation)), 2) * 28;
      const lavaBasins = -Math.pow(Math.max(0, Math.cos(x * 0.012 - z * 0.009)), 5) * 13;
      const foldedCrust = Math.abs(Math.sin(x * 0.026 + Math.sin(z * 0.018) * 2)) * 9;
      return Math.sin(x * 0.011) * 10 + Math.cos(z * 0.014) * 8 + volcanicRidges + lavaBasins + foldedCrust + edge;
    }

    case 'nyx': {
      const canyonCenter = 95 * Math.sin(x * 0.008 + variation);
      const canyon = -37 * Math.exp(-Math.pow((z - canyonCenter) / 27, 2));
      const dunes = Math.sin(x * 0.021 + z * 0.006) * 8 + Math.sin(z * 0.032) * 5;
      const mesas = Math.pow(Math.max(0, Math.sin(x * 0.012 + Math.cos(z * 0.01) * 1.8)), 3) * 29;
      return canyon + dunes + mesas + edge;
    }

    case 'cinder': {
      const cloudBands = Math.sin(z * 0.027 + Math.sin(x * 0.008) * 2.4) * 15;
      const stormDistance = Math.hypot(x - 95, z + 65);
      const storm = -24 * Math.exp(-(stormDistance * stormDistance) / 12500);
      const cloudTowers = Math.pow(Math.max(0, Math.sin(x * 0.019 + z * 0.013)), 3) * 17;
      return cloudBands + storm + cloudTowers + edge;
    }

    case 'thalassa': {
      const fractures = Math.abs(Math.sin((x + z) * 0.023)) * 13;
      const iceRidges = Math.pow(Math.max(0, Math.cos(x * 0.014 - z * 0.012)), 3) * 23;
      const frozenBasins = -Math.pow(Math.max(0, Math.sin(z * 0.009 + x * 0.006)), 4) * 12;
      return Math.sin(x * 0.012) * 7 + Math.cos(z * 0.016) * 6 + fractures + iceRidges + frozenBasins + edge;
    }

    case 'zephyr': {
      const glacierRidges = Math.abs(Math.sin((x + z * 0.45) * 0.019)) * 19;
      const frozenPlains = Math.sin(x * 0.009) * 5 + Math.cos(z * 0.011) * 6;
      const icePeaks = Math.pow(Math.max(0, Math.sin(x * 0.013 + Math.cos(z * 0.008) * 2)), 4) * 35;
      return glacierRidges + frozenPlains + icePeaks + edge;
    }

    case 'umbra': {
      const trenchCenter = 80 * Math.sin(x * 0.007 + variation);
      const abyss = -43 * Math.exp(-Math.pow((z - trenchCenter) / 31, 2));
      const deepRidges = Math.sin((x - z) * 0.022) * 11;
      const pressureRidges = Math.pow(Math.max(0, Math.cos(x * 0.015 + z * 0.009)), 3) * 27;
      return abyss + deepRidges + pressureRidges + edge;
    }

    case 'pluto': {
      const basinDistance = Math.hypot(x + 35, z - 25);
      const frozenBasin = -27 * Math.exp(-(basinDistance * basinDistance) / 36000);
      const iceMountains = Math.pow(Math.max(0, Math.sin(x * 0.013 + Math.cos(z * 0.012) * 2)), 3) * 31;
      const frozenWaves = Math.sin(x * 0.018) * 4 + Math.cos(z * 0.019) * 5;
      return frozenBasin + iceMountains + frozenWaves + edge;
    }

    default:
      return terrainHeight(x, z, seed);
  }
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
        vertices.push(x, surfaceTerrainHeight('verdant', x, z, seed) + 0.48, z);
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
    const ground = surfaceTerrainHeight('verdant', x, z, seed);
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
    car.position.set(start.x, surfaceTerrainHeight('verdant', start.x, start.y, seed) + 0.5, start.y);
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
    person.position.set(start.x, surfaceTerrainHeight('verdant', start.x, start.y, seed) + 0.5, start.y);
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
  const terrainPalettes: Record<string, { base: string; high: string; rock: string; mountain: string; roughness: number; metalness: number }> = {
    aurelia: { base: '#514b45', high: '#c9b99d', rock: '#71685c', mountain: '#a1947f', roughness: 1, metalness: 0 },
    ignis: { base: '#54241d', high: '#d77a43', rock: '#38201b', mountain: '#873b28', roughness: 0.96, metalness: 0.02 },
    verdant: { base: '#000000', high: '#ffffff', rock: '#000000', mountain: '#000000', roughness: 1, metalness: 0 },
    nyx: { base: '#603b2c', high: '#d08b59', rock: '#75452f', mountain: '#a95d3b', roughness: 1, metalness: 0 },
    cinder: { base: '#76503c', high: '#e5ae78', rock: '#9b6547', mountain: '#bd8055', roughness: 0.94, metalness: 0.03 },
    thalassa: { base: '#263e55', high: '#b5edf0', rock: '#547f91', mountain: '#8ac8d4', roughness: 0.48, metalness: 0.12 },
    zephyr: { base: '#536b83', high: '#eff8ff', rock: '#8da8bd', mountain: '#c7e4f2', roughness: 0.38, metalness: 0.1 },
    umbra: { base: '#142b48', high: '#5599c1', rock: '#315b7b', mountain: '#477fa5', roughness: 0.62, metalness: 0.12 },
    pluto: { base: '#625765', high: '#e9dce0', rock: '#968795', mountain: '#c7b9c6', roughness: 0.72, metalness: 0.04 }
  };
  const palette = terrainPalettes[planet.id] ?? terrainPalettes.verdant;
  const base = planet.id === 'verdant'
    ? new THREE.Color(planet.color).multiplyScalar(0.58)
    : new THREE.Color(palette.base);
  const high = planet.id === 'verdant'
    ? new THREE.Color(planet.color).lerp(new THREE.Color('#ffffff'), 0.42)
    : new THREE.Color(palette.high);
  const terrainSeed = planet.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const height = surfaceTerrainHeight(planet.id, x, z, terrainSeed);
    positions.setY(i, height);
    const tint = THREE.MathUtils.clamp((height + 22) / 65, 0, 1);
    const detail = (Math.sin(x * 0.061 + z * 0.047 + terrainSeed) + 1) * 0.5;
    const blend = planet.id === 'verdant'
      ? tint * 0.82
      : THREE.MathUtils.clamp(tint * 0.68 + detail * 0.22, 0, 1);
    const color = base.clone().lerp(high, blend);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const terrain = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
  );
  terrain.name = 'procedural-terrain-fallback';
  terrain.receiveShadow = true;
  group.add(terrain);

  const rockMat = new THREE.MeshStandardMaterial({
    color: planet.id === 'verdant' ? high : palette.rock,
    roughness: palette.roughness,
    metalness: palette.metalness
  });
  for (let i = 0; i < 100; i++) {
    const x = Math.sin(i * 91.7) * 320;
    const z = Math.cos(i * 47.3) * 320;
    const radius = 1.2 + (i % 6) * 0.9;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), rockMat);
    const rockY = surfaceTerrainHeight(planet.id, x, z, terrainSeed) + radius * 0.55;
    rock.position.set(x, rockY, z);
    rock.rotation.set(i * 0.31, i * 0.73, i * 0.19);
    group.add(rock);
    obstacles.push({ x, z, radius: radius + 2.5, topY: rockY + radius });
  }

  const mountainMat = new THREE.MeshStandardMaterial({
    color: planet.id === 'verdant' ? high : palette.mountain,
    roughness: palette.roughness,
    metalness: palette.metalness
  });
  for (let i = 0; i < 18; i++) {
    const x = Math.sin(i * 17.2) * 270;
    const z = -130 - Math.cos(i * 12.4) * 260;
    const height = 28 + (i % 5) * 15;
    const mountain = new THREE.Mesh(
      new THREE.ConeGeometry(18 + (i % 4) * 8, height, 7),
      mountainMat
    );
    const mountainBase = surfaceTerrainHeight(planet.id, x, z, terrainSeed);
    mountain.position.set(x, mountainBase + height / 2, z);
    mountain.rotation.y = i * 0.7;
    group.add(mountain);
    obstacles.push({ x, z, radius: 20 + (i % 4) * 8, topY: mountainBase + height });
  }

  if (planet.id === 'verdant') {
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#65452f', roughness: 1 });
    const leafMaterial = new THREE.MeshStandardMaterial({ color: planet.id === 'verdant' ? '#287d4b' : '#397d68', roughness: 0.9 });
    for (let i = 0; i < 42; i++) {
      const x = Math.sin(i * 28.31 + terrainSeed) * 285;
      const z = Math.cos(i * 19.73 + terrainSeed) * 285;
      const ground = surfaceTerrainHeight(planet.id, x, z, terrainSeed);
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
      const ground = surfaceTerrainHeight(planet.id, x, z, terrainSeed);
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
      const ground = surfaceTerrainHeight(planet.id, x, z, terrainSeed);
      const crystal = new THREE.Mesh(new THREE.ConeGeometry(3 + i % 4, 12 + i % 6 * 3, 6), crystalMaterial);
      crystal.position.set(x, ground + 8, z);
      group.add(crystal);
      obstacles.push({ x, z, radius: 4, topY: ground + 18 });
    }
  }

  if (['thalassa', 'zephyr', 'pluto'].includes(planet.id)) {
    const iceMaterial = new THREE.MeshStandardMaterial({ color: '#d7eaff', roughness: 0.28, metalness: 0.12 });
    for (let i = 0; i < 34; i++) {
      const x = Math.sin(i * 17.1 + terrainSeed) * 275;
      const z = Math.cos(i * 11.9 + terrainSeed) * 275;
      const ground = surfaceTerrainHeight(planet.id, x, z, terrainSeed);
      const shard = new THREE.Mesh(new THREE.ConeGeometry(3 + i % 4, 16 + i % 5 * 4, 5), iceMaterial);
      shard.position.set(x, ground + 9, z);
      group.add(shard);
      obstacles.push({ x, z, radius: 4.5, topY: ground + 20 });
    }
  }

  // Mars gets broad, flat-topped mesas instead of ice formations.
  if (planet.id === 'nyx') {
    const mesaMaterial = new THREE.MeshStandardMaterial({
      color: '#a96340',
      roughness: 1
    });
    for (let i = 0; i < 12; i++) {
      const x = Math.sin(i * 14.7 + terrainSeed) * 265;
      const z = Math.cos(i * 19.1 + terrainSeed) * 265;
      const ground = surfaceTerrainHeight(planet.id, x, z, terrainSeed);
      const height = 12 + (i % 4) * 5;
      const mesa = new THREE.Mesh(
        new THREE.CylinderGeometry(10 + (i % 3) * 3, 19 + (i % 4) * 3, height, 7),
        mesaMaterial
      );
      mesa.position.set(x, ground + height / 2, z);
      mesa.rotation.y = i * 0.47;
      group.add(mesa);
      obstacles.push({
        x, z, radius: 20 + (i % 4) * 3,
        topY: ground + height
      });
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
    const ground = surfaceTerrainHeight(planet.id, x, z, terrainSeed);
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

  const landmarkGround = surfaceTerrainHeight(planet.id, 0, -70, terrainSeed);
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
    creature.position.set(creatureX, surfaceTerrainHeight(planet.id, creatureX, creatureZ, terrainSeed) + 8, creatureZ);
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
  const [explosionNotice, setExplosionNotice] = useState<'solar' | 'black-hole' | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [flightMode, setFlightMode] = useState<'space' | 'landing' | 'surface'>('space');
  const [nearPlanet, setNearPlanet] = useState<string | null>(null);
  const [activePlanet, setActivePlanet] = useState<Planet | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState(1);
  const [onlinePilotList, setOnlinePilotList] = useState<Array<{ id: string; name: string }>>([]);
  const [showOnlinePilots, setShowOnlinePilots] = useState(false);
  const [multiplayerStatus, setMultiplayerStatus] = useState('CONNECTING');
  const [pilotName, setPilotName] = useState(() => localStorage.getItem('galaxy-explorer-username') || '');
  const [usernameDraft, setUsernameDraft] = useState(() => localStorage.getItem('galaxy-explorer-username') || '');
  const [gameStarted, setGameStarted] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const pilotIdRef = useRef(`pilot-${Math.random().toString(36).slice(2, 12)}`);
  const voiceRef = useRef<VoiceChat | null>(null);
  const gameAudioRef = useRef<GameAudio | null>(null);
  const voiceSendRef = useRef<((message: unknown) => boolean) | null>(null);
  const voiceConnectionIdRef = useRef('');
  const [voiceStatus, setVoiceStatus] = useState('VOICE OFF');
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceStarting, setVoiceStarting] = useState(false);
  const [multiplayerReady, setMultiplayerReady] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('nearby');
  const [voicePeers, setVoicePeers] = useState<VoicePeer[]>([]);
  const [speakingPeerIds, setSpeakingPeerIds] = useState<string[]>([]);
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

    const cinematicNebula = createCinematicNebula(scene);
    const distantGalaxies = createDistantGalaxies(scene);

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
    const saturnRingSystems: Array<{
      pivot: THREE.Group;
      geometry: THREE.BufferGeometry;
      angles: Float32Array;
      radii: Float32Array;
      speeds: Float32Array;
      heights: Float32Array;
    }> = [];
    const surfaces = new Map<string, THREE.Group>();
    const surfaceObstacles = new Map<string, SurfaceObstacle[]>();
    const gltfLoader = new GLTFLoader();
    const terrainLoading = new Set<string>();
    const terrainLoaded = new Set<string>();
    let sceneAlive = true;
    let voxelWaterMesh: THREE.Mesh | null = null;
    let voxelWaterBaseY = 0;

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

    // Distant black-hole landmark beyond the planetary system.
    const blackHoleGroup = new THREE.Group();
    blackHoleGroup.name = 'martins-black-hole';
    // Elevated landmark visible from the starting flight corridor.
    blackHoleGroup.position.set(-950, 0, -2750);
    blackHoleGroup.scale.setScalar(125);
    scene.add(blackHoleGroup);

    let blackHoleAnimation: ReturnType<typeof createBlackHoleAnimation> | null = null;

    gltfLoader.load(
      '/assets/martins_black_hole.glb',
      (gltf) => {
        if (!sceneAlive) {
          gltf.scene.traverse(object => {
            if (
              object instanceof THREE.Mesh ||
              object instanceof THREE.Points ||
              object instanceof THREE.Line
            ) {
              object.geometry.dispose();
              const materials = Array.isArray(object.material)
                ? object.material
                : [object.material];
              materials.forEach(material => material.dispose());
            }
          });
          return;
        }

        blackHoleGroup.add(gltf.scene);
        blackHoleAnimation = createBlackHoleAnimation(gltf.scene);
      },
      undefined,
      (error) => console.error('Unable to load black-hole model:', error)
    );

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
        const ringPivot = new THREE.Group();
        ringPivot.name = 'saturn-ring-pivot';

        const innerRadius = planet.size * 1.35;
        const outerRadius = planet.size * 2.45;

        const rings = new THREE.Mesh(
          new THREE.RingGeometry(innerRadius, outerRadius, 160),
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
        ringPivot.add(rings);

        const particleCount = 120;
        const particleGeometry = new THREE.BufferGeometry();
        const particlePositions = new Float32Array(particleCount * 3);
        const particleColors = new Float32Array(particleCount * 3);
        const angles = new Float32Array(particleCount);
        const radii = new Float32Array(particleCount);
        const speeds = new Float32Array(particleCount);
        const heights = new Float32Array(particleCount);

        const iceColor = new THREE.Color(0xb9d9ed);
        const goldColor = new THREE.Color(0xe8c58c);

        for (let i = 0; i < particleCount; i++) {
          angles[i] = Math.random() * Math.PI * 2;
          radii[i] = innerRadius + Math.random() * (outerRadius - innerRadius);
          speeds[i] = 0.035 + Math.random() * 0.075;
          heights[i] = (Math.random() - 0.5) * 1.1;

          particlePositions[i * 3] = Math.cos(angles[i]) * radii[i];
          particlePositions[i * 3 + 1] = Math.sin(angles[i]) * radii[i];
          particlePositions[i * 3 + 2] = heights[i];

          const colour = iceColor.clone().lerp(goldColor, Math.random() * 0.42);
          particleColors[i * 3] = colour.r;
          particleColors[i * 3 + 1] = colour.g;
          particleColors[i * 3 + 2] = colour.b;
        }

        particleGeometry.setAttribute(
          'position',
          new THREE.BufferAttribute(particlePositions, 3)
        );
        particleGeometry.setAttribute(
          'color',
          new THREE.BufferAttribute(particleColors, 3)
        );

        const ringParticles = new THREE.Points(
          particleGeometry,
          new THREE.PointsMaterial({
            size: 1.25,
            vertexColors: true,
            transparent: true,
            opacity: 0.78,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
          })
        );
        ringParticles.name = 'saturn-orbiting-ice-particles';
        ringParticles.rotation.x = -Math.PI / 2.35;
        ringPivot.add(ringParticles);

        group.add(ringPivot);

        saturnRingSystems.push({
          pivot: ringPivot,
          geometry: particleGeometry,
          angles,
          radii,
          speeds,
          heights,
        });
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

    // Keep the game's existing ship coordinate system and flight physics.
    // The new GLB faces +Z, while the game flies forward along -Z.
    const shipModelRoot = new THREE.Group();
    shipModelRoot.rotation.y = Math.PI;
    shipModelRoot.scale.setScalar(0.68);
    ship.add(shipModelRoot);

    gltfLoader.load(
      '/assets/martins_galaxy_futuristic_jet.glb',
      (gltf) => {
        if (!sceneAlive) {
          gltf.scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.geometry.dispose();
              const materials = Array.isArray(object.material)
                ? object.material
                : [object.material];
              materials.forEach((material) => material.dispose());
            }
          });
          return;
        }

        shipModelRoot.add(gltf.scene);
      },
      undefined,
      (error) => {
        console.error('Unable to load futuristic jet model:', error);
      }
    );

    // Preserve the original runtime-controlled booster flames.
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x3bdcff });

    [-1, 1].forEach((side) => {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.23, 2.4, 16),
        glowMat
      );
      flame.rotation.x = Math.PI / 2;
      flame.position.set(side * 0.50, -0.055, 4.33);
      flame.name = 'engine-flame';
      ship.add(flame);
    });

    scene.add(ship);


    const state: FlightScene = {
      ship, camera, renderer, scene, planets: planetGroups, surfaces,
      keys: new Set<string>(), velocity: new THREE.Vector3(),
      yaw: 0, pitch: 0, roll: 0, stars, mode: 'space',
      activePlanet: null, landingProgress: 0, surfaceGroundY: 0,
      originalBackground, originalFog, surfaceSky, autopilotTarget: null, surfaceObstacles,
      asteroids, remoteShips: new Map<string, THREE.Group>(), loadSurfaceTerrain: () => {},
    };
    state.loadSurfaceTerrain = (planetId: string) => {
      if (!sceneAlive || terrainLoading.has(planetId) || terrainLoaded.has(planetId)) return;

      const assetNames: Record<string, string> = {
        aurelia: 'mercury',
        ignis: 'venus',
        verdant: 'earth',
        nyx: 'mars',
        cinder: 'jupiter',
        thalassa: 'saturn',
        zephyr: 'uranus',
        umbra: 'neptune',
        pluto: 'pluto',
      };

      const assetName = assetNames[planetId];
      if (!assetName) return;

      terrainLoading.add(planetId);

      gltfLoader.load(
        `/assets/planet-landscapes/${assetName}_landscape.glb`,
        (gltf) => {
          terrainLoading.delete(planetId);

          if (!sceneAlive) return;

          let terrainMesh: THREE.Mesh | null = null;
          gltf.scene.traverse((object) => {
            if (!terrainMesh && object instanceof THREE.Mesh) {
              terrainMesh = object;
            }
          });

          if (!terrainMesh) {
            console.warn(`No terrain mesh found for ${planetId}`);
            return;
          }

          const position = terrainMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
          const side = Math.round(Math.sqrt(position.count));

          if (side * side !== position.count || side < 2) {
            console.warn(`Unexpected terrain grid for ${planetId}`);
            return;
          }

          let minX = Infinity;
          let maxX = -Infinity;
          let minZ = Infinity;
          let maxZ = -Infinity;

          for (let i = 0; i < position.count; i++) {
            minX = Math.min(minX, position.getX(i));
            maxX = Math.max(maxX, position.getX(i));
            minZ = Math.min(minZ, position.getZ(i));
            maxZ = Math.max(maxZ, position.getZ(i));
          }

          const heights = new Float32Array(side * side);

          for (let i = 0; i < position.count; i++) {
            const x = position.getX(i);
            const y = position.getY(i);
            const z = position.getZ(i);

            const column = Math.round((x - minX) / (maxX - minX) * (side - 1));
            const row = Math.round((z - minZ) / (maxZ - minZ) * (side - 1));

            heights[row * side + column] = y;
          }

          const sampleTerrain = (x: number, z: number): number => {
            const gx = THREE.MathUtils.clamp(
              (x - minX) / (maxX - minX) * (side - 1), 0, side - 1
            );
            const gz = THREE.MathUtils.clamp(
              (z - minZ) / (maxZ - minZ) * (side - 1), 0, side - 1
            );

            const x0 = Math.floor(gx);
            const z0 = Math.floor(gz);
            const x1 = Math.min(x0 + 1, side - 1);
            const z1 = Math.min(z0 + 1, side - 1);
            const tx = gx - x0;
            const tz = gz - z0;

            const h00 = heights[z0 * side + x0];
            const h10 = heights[z0 * side + x1];
            const h01 = heights[z1 * side + x0];
            const h11 = heights[z1 * side + x1];

            const top = THREE.MathUtils.lerp(h00, h10, tx);
            const bottom = THREE.MathUtils.lerp(h01, h11, tx);

            return THREE.MathUtils.lerp(top, bottom, tz);
          };

          terrainHeightSamplers.set(planetId, sampleTerrain);
          terrainLoaded.add(planetId);

          const existing = state.surfaces.get(planetId);
          const planetData = planets.find((item) => item.id === planetId);

          if (!existing || !planetData) return;

          // Rebuild all surface features using the imported model's heights.
          const oldPosition = existing.position.clone();
          const rebuilt = makeSurface(planetData, oldPosition.y);

          rebuilt.group.position.copy(oldPosition);
          rebuilt.group.visible = existing.visible;

          gltf.scene.name = 'planet-landscape-model';
          gltf.scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.castShadow = true;
              object.receiveShadow = true;
            }
          });

          rebuilt.group.add(gltf.scene);

          // Remove the temporary procedural ground, not the surface features.
          const fallback = rebuilt.group.getObjectByName('procedural-terrain-fallback');

          if (fallback instanceof THREE.Mesh) {
            fallback.parent?.remove(fallback);
            fallback.geometry.dispose();

            const materials = Array.isArray(fallback.material)
              ? fallback.material
              : [fallback.material];

            materials.forEach((material) => material.dispose());
          }

          // Install the replacement before disposing the previous surface.
          state.scene.add(rebuilt.group);
          state.scene.remove(existing);

          state.surfaces.set(planetId, rebuilt.group);
          state.surfaceObstacles.set(planetId, rebuilt.obstacles);

          existing.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.geometry.dispose();

              const materials = Array.isArray(object.material)
                ? object.material
                : [object.material];

              materials.forEach((material) => material.dispose());
            }
          });

          // Prevent the ship from remaining underground if loading finishes
          // after the landing animation has already completed.
          if (state.activePlanet === planetId && state.mode === 'surface') {
            const localX = state.ship.position.x - rebuilt.group.position.x;
            const localZ = state.ship.position.z - rebuilt.group.position.z;
            const groundY = rebuilt.group.position.y + sampleTerrain(localX, localZ);

            state.ship.position.y = Math.max(state.ship.position.y, groundY + 11);
          }

          console.log(`Detailed GLB terrain installed: ${planetId}`);

          // Load the voxel landscape as a separate Earth island.
          // It must not enter the height-grid terrain sampler.
          if (planetId === 'verdant') {
            gltfLoader.load(
              '/assets/earth-voxel-terrain.glb',
              (voxelGltf) => {
                if (!sceneAlive || state.surfaces.get('verdant') !== rebuilt.group) return;

                const islandX = 270;
                const islandZ = 0;
                const islandGround = sampleTerrain(islandX, islandZ);
                const island = voxelGltf.scene;

                island.name = 'earth-voxel-island';
                island.position.set(islandX, islandGround + 0.5, islandZ);

                let waterFound = false;
                island.traverse((object) => {
                  if (object instanceof THREE.Mesh) {
                    object.castShadow = true;
                    object.receiveShadow = true;

                    if (!waterFound && object.name.toLowerCase().includes('water')) {
                      voxelWaterMesh = object;
                      voxelWaterBaseY = object.position.y;
                      waterFound = true;
                    }
                  }
                });

                rebuilt.group.add(island);

                // Keep low-flying ships from passing through the island.
                rebuilt.obstacles.push({
                  x: islandX,
                  z: islandZ,
                  radius: 39,
                  topY: islandGround + 13,
                });
                state.surfaceObstacles.set('verdant', rebuilt.obstacles);

                console.log(
                  `Earth voxel island installed at (${islandX}, ${islandZ}); water animation: ${waterFound ? 'ready' : 'mesh not found'}`
                );
              },
              undefined,
              (error) => console.warn('Could not load Earth voxel island.', error)
            );
          }
        },
        undefined,
        (error) => {
          terrainLoading.delete(planetId);
          console.warn(`Could not load detailed terrain for ${planetId}; keeping fallback terrain.`, error);
        }
      );
    };

    sceneRef.current = state;
    let frame = 0;
    let last = performance.now();
    let currentSpeed = 0;
    let telemetryAt = 0;

    // Lightweight local solar-hazard effects.
    let solarHazardPhase: 'clear' | 'warning' | 'burning' | 'exploded' = 'clear';
    let solarExplosionStartedAt = 0;
    let solarRespawnAt = 0;

    // Black-hole capture is deliberately independent of solar destruction.
    let blackHolePhase: 'clear' | 'pulling' | 'disintegrated' = 'clear';
    let blackHolePullStartedAt = 0;
    let blackHoleRespawnAt = 0;
    const blackHoleVelocity = new THREE.Vector3();

    const blackHoleShardGroup = new THREE.Group();
    blackHoleShardGroup.name = 'black-hole-ship-fragments';
    blackHoleShardGroup.visible = false;

    const blackHoleShardMaterials = [
      new THREE.MeshBasicMaterial({ color: 0x21dfff, emissive: 0x087bff }),
      new THREE.MeshBasicMaterial({ color: 0xb45cff, emissive: 0x6820ff }),
      new THREE.MeshBasicMaterial({ color: 0xffa34a, emissive: 0xff4b12 }),
    ];

    const blackHoleShards: THREE.Mesh[] = [];
    const blackHoleShardGeometry = new THREE.TetrahedronGeometry(0.72, 0);

    for (let i = 0; i < 15; i++) {
      const shard = new THREE.Mesh(
        blackHoleShardGeometry,
        blackHoleShardMaterials[i % blackHoleShardMaterials.length]
      );
      shard.visible = false;
      blackHoleShardGroup.add(shard);
      blackHoleShards.push(shard);
    }

    scene.add(blackHoleShardGroup);

    const blackHoleBlastRingMaterial = new THREE.MeshBasicMaterial({
      color: 0x62eaff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const blackHoleBlastRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.13, 8, 48),
      blackHoleBlastRingMaterial
    );
    blackHoleBlastRing.visible = false;
    blackHoleShardGroup.add(blackHoleBlastRing);

    const blackHoleFlashMaterial = new THREE.MeshBasicMaterial({
      color: 0xe8fbff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const blackHoleFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 16, 12),
      blackHoleFlashMaterial
    );
    blackHoleFlash.visible = false;
    blackHoleShardGroup.add(blackHoleFlash);

    // Three expanding, coloured shockwaves.
    const blackHoleShockRings: THREE.Mesh[] = [];
    const blackHoleShockMaterials: THREE.MeshBasicMaterial[] = [];
    const shockColours = [0x36eaff, 0xa45cff, 0xff9b42];

    for (let i = 0; i < 3; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: shockColours[i],
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.11 + i * 0.025, 8, 64),
        material
      );
      ring.visible = false;
      ring.rotation.x = i * 0.28;
      ring.rotation.y = i * 0.42;
      blackHoleShardGroup.add(ring);
      blackHoleShockRings.push(ring);
      blackHoleShockMaterials.push(material);
    }

    // Glowing fragments thrown outward by the impact.
    const blackHoleDebris: THREE.Mesh[] = [];
    const blackHoleDebrisGeometry = new THREE.IcosahedronGeometry(0.16, 1);
    const blackHoleDebrisMaterials = [
      new THREE.MeshBasicMaterial({
        color: 0x38eaff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      new THREE.MeshBasicMaterial({
        color: 0xc16aff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      new THREE.MeshBasicMaterial({
        color: 0xffa044,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    ];

    for (let i = 0; i < 36; i++) {
      const debris = new THREE.Mesh(
        blackHoleDebrisGeometry,
        blackHoleDebrisMaterials[i % blackHoleDebrisMaterials.length]
      );
      debris.visible = false;
      blackHoleShardGroup.add(debris);
      blackHoleDebris.push(debris);
    }

    const solarFireGroup = new THREE.Group();
    solarFireGroup.name = 'solar-hull-fire';
    solarFireGroup.visible = false;
    ship.add(solarFireGroup);

    const solarFireMeshes: THREE.Mesh[] = [];
    const firePositions: Array<[number, number, number]> = [
      [-1.0, 0.15, 0], [1.0, 0.15, 0],
      [-0.55, 0.65, -0.8], [0.55, 0.65, -0.8],
      [-0.55, -0.45, 0.9], [0.55, -0.45, 0.9],
      [0, 0.8, 0.65], [0, -0.65, -0.55],
    ];

    firePositions.forEach(([x, y, z], index) => {
      const material = new THREE.MeshBasicMaterial({
        color: index % 2 ? 0xffa12b : 0xff4a16,
        transparent: true,
        opacity: 0.86,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.48 + (index % 3) * 0.12, 3.0 + (index % 2) * 1.1, 7),
        material
      );
      flame.position.set(x, y, z);
      flame.rotation.z = (index % 2 ? 1 : -1) * 0.28;
      flame.rotation.x = (index % 3 - 1) * 0.22;
      solarFireGroup.add(flame);
      solarFireMeshes.push(flame);
    });

    const solarExplosionGroup = new THREE.Group();
    solarExplosionGroup.name = 'solar-jet-explosion';
    solarExplosionGroup.visible = false;

    const explosionRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb347,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const explosionRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.16, 8, 40),
      explosionRingMaterial
    );
    solarExplosionGroup.add(explosionRing);

    const explosionFlashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe1a0,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const explosionFlash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      explosionFlashMaterial
    );
    solarExplosionGroup.add(explosionFlash);

    const explosionParticleGeometry = new THREE.SphereGeometry(0.28, 8, 6);
    const explosionParticles: Array<{
      mesh: THREE.Mesh;
      velocity: THREE.Vector3;
      origin: THREE.Vector3;
    }> = [];

    for (let i = 0; i < 24; i++) {
      const angle = i * 2.399963;
      const vertical = ((i % 7) - 3) / 3;
      const direction = new THREE.Vector3(
        Math.cos(angle),
        vertical,
        Math.sin(angle)
      ).normalize();

      const particle = new THREE.Mesh(
        explosionParticleGeometry,
        new THREE.MeshBasicMaterial({
          color: i % 3 === 0 ? 0xffe5a0 : i % 3 === 1 ? 0xff7628 : 0xff3518,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      const origin = direction.clone().multiplyScalar(0.8);
      particle.position.copy(origin);
      solarExplosionGroup.add(particle);
      explosionParticles.push({
        mesh: particle,
        velocity: direction.multiplyScalar(22 + (i % 5) * 6),
        origin,
      });
    }

    scene.add(solarExplosionGroup);
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

      if (voxelWaterMesh) {
        voxelWaterMesh.position.y =
          voxelWaterBaseY + Math.sin(now * 0.0014) * 0.035;
      }

      if (state.mode === 'landing') {
        state.landingProgress = Math.min(1, state.landingProgress + dt / 3.4);
        const t = state.landingProgress;
        const eased = t * t * (3 - 2 * t);
        const landingSurface = state.activePlanet
          ? state.surfaces.get(state.activePlanet)
          : null;
        const landingSeed = state.activePlanet
          ? state.activePlanet.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
          : 0;
        const localLandingX = landingSurface ? ship.position.x - landingSurface.position.x : 0;
        const localLandingZ = landingSurface ? ship.position.z - landingSurface.position.z : 0;
        const terrainOffset = state.activePlanet
          ? surfaceTerrainHeight(state.activePlanet, localLandingX, localLandingZ, landingSeed)
          : 0;
        const targetY = state.surfaceGroundY + terrainOffset + 11;
        const startY = targetY + 139;
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
        const controlsEnabled =
          solarHazardPhase !== 'exploded' && blackHolePhase !== 'disintegrated';
        const forward = controlsEnabled && (state.keys.has('w') || state.keys.has('arrowup') || Boolean(state.autopilotTarget));
        const reverse = controlsEnabled && (state.keys.has('s') || state.keys.has('arrowdown'));
        const left = controlsEnabled && (state.keys.has('a') || state.keys.has('arrowleft'));
        const right = controlsEnabled && (state.keys.has('d') || state.keys.has('arrowright'));
        const up = controlsEnabled && state.keys.has(' ');
        const down = controlsEnabled && state.keys.has('f');
        const climb = controlsEnabled && state.keys.has('r');
        const descend = controlsEnabled && state.keys.has('f');
        const boost = controlsEnabled && state.keys.has('shift');
        gameAudioRef.current?.updateEngine(
          controlsEnabled && state.mode !== 'landing',
          boost,
          currentSpeed
        );
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

        if (
          state.mode === 'space' &&
          blackHolePhase !== 'disintegrated'
        ) {
          const toBlackHole = blackHoleGroup.position.clone().sub(ship.position);
          const blackHoleDistance = toBlackHole.length();

          const gravityRadius = 2600;
          const eventHorizonRadius = 170;

          if (blackHoleDistance < gravityRadius && blackHoleDistance > 0.001) {
            const pullDirection = toBlackHole.normalize();
            const influence = 1 - blackHoleDistance / gravityRadius;

            if (blackHolePhase === 'clear') {
              blackHolePhase = 'pulling';
              setMessage(
                'BLACK HOLE DETECTED · EXTREME GRAVITATIONAL FORCE'
              );
            }

            // Direction-sensitive gravity:
            // Strong when flying towards the black hole,
            // weak when crossing sideways, almost absent when escaping.
            const approachAlignment = direction.dot(pullDirection);
            const approachFactor = Math.max(0, approachAlignment);

            const gravityFactor = approachAlignment > 0
              ? 0.08 + approachFactor * approachFactor * 0.92
              : 0.015;

            const gravityAcceleration =
              (12 + influence * influence * 180) * gravityFactor;

            blackHoleVelocity.addScaledVector(
              pullDirection,
              gravityAcceleration * dt
            );

            // Remove accumulated inward momentum when the pilot
            // turns sideways or away from the black hole.
            if (approachAlignment <= 0) {
              const inwardVelocity = blackHoleVelocity.dot(pullDirection);

              if (inwardVelocity > 0) {
                blackHoleVelocity.addScaledVector(
                  pullDirection,
                  -inwardVelocity * Math.min(1, dt * 4)
                );
              }
            }

            blackHoleVelocity.multiplyScalar(
              Math.max(0, 1 - dt * 0.65)
            );
            blackHoleVelocity.clampLength(0, 190);

            ship.position.addScaledVector(blackHoleVelocity, dt);

            if (
              blackHoleDistance < 850 &&
              now - telemetryAt > 1200
            ) {
              setMessage(
                'CRITICAL GRAVITY · BOOST AND STEER TO ESCAPE'
              );
            }

            // The event horizon triggers an impact explosion.
            if (blackHoleDistance <= eventHorizonRadius) {
              blackHolePhase = 'disintegrated';
              blackHolePullStartedAt = now;
              blackHoleRespawnAt = now + 3500;

              blackHoleShardGroup.position.copy(ship.position);
              blackHoleShardGroup.rotation.copy(ship.rotation);
              blackHoleShardGroup.scale.setScalar(1);
              blackHoleShardGroup.visible = true;

              blackHoleBlastRing.visible = true;
              blackHoleBlastRing.scale.setScalar(1);
              blackHoleBlastRingMaterial.opacity = 1;

              blackHoleFlash.visible = true;
              blackHoleFlash.scale.setScalar(1);
              blackHoleFlashMaterial.opacity = 1;

              blackHoleShockRings.forEach((ring, index) => {
                ring.visible = true;
                ring.scale.setScalar(0.15);
                ring.rotation.z = index * 1.1;
                blackHoleShockMaterials[index].opacity = 1;
              });

              blackHoleDebris.forEach((debris, index) => {
                const angle = index * 2.399963;
                const vertical = ((index % 9) - 4) / 5;
                const direction = new THREE.Vector3(
                  Math.cos(angle),
                  vertical,
                  Math.sin(angle)
                ).normalize();

                debris.position.copy(direction).multiplyScalar(0.8);
                debris.scale.setScalar(0.8 + (index % 4) * 0.25);
                debris.rotation.set(angle, angle * 0.7, angle * 1.3);
                debris.userData.blastVelocity = direction.multiplyScalar(
                  48 + (index % 7) * 13
                );
                debris.visible = true;
              });

              blackHoleShards.forEach((shard, index) => {
                const angle = index * 2.399963;
                const direction = new THREE.Vector3(
                  Math.cos(angle),
                  Math.sin(index * 1.7) * 0.8,
                  Math.sin(angle)
                ).normalize();

                shard.position.copy(direction).multiplyScalar(0.65);
                shard.rotation.set(angle, angle * 0.7, angle * 1.3);
                shard.scale.setScalar(1);
                shard.userData.pullDirection = direction;
                shard.visible = true;
              });

              ship.visible = false;
              currentSpeed = 0;
              blackHoleVelocity.set(0, 0, 0);
              state.keys.clear();
              state.autopilotTarget = null;

              gameAudioRef.current?.playBlackHoleExplosion();
              setExplosionNotice('black-hole');
              setMessage(
                'EVENT HORIZON IMPACT · SPACECRAFT DISINTEGRATED'
              );
            }
          } else if (
            blackHolePhase === 'pulling' &&
            blackHoleDistance > 2900 &&
            blackHoleVelocity.length() < 25
          ) {
            blackHolePhase = 'clear';
            blackHoleVelocity.set(0, 0, 0);
            setMessage('GRAVITY ESCAPED · FLIGHT SYSTEMS RECOVERED');
          }
        }

        if (
          state.mode === 'space' &&
          solarHazardPhase !== 'exploded' &&
          blackHolePhase === 'clear'
        ) {
          const sunDistance = ship.position.distanceTo(sunPosition);

          if (solarHazardPhase === 'clear' && sunDistance <= 900) {
            solarHazardPhase = 'warning';
            setMessage('SOLAR PROXIMITY WARNING · EXTREME RADIATION DETECTED');
          } else if (solarHazardPhase === 'warning' && sunDistance <= 450) {
            solarHazardPhase = 'burning';
            solarFireGroup.visible = true;
            setMessage('CRITICAL SOLAR HEAT · HULL IN FLAMES · PULL AWAY NOW');
          } else if (solarHazardPhase === 'burning' && sunDistance > 560) {
            solarHazardPhase = 'warning';
            solarFireGroup.visible = false;
            setMessage('SOLAR HEAT REDUCING · HULL TEMPERATURE FALLING');
          } else if (solarHazardPhase === 'warning' && sunDistance > 980) {
            solarHazardPhase = 'clear';
            setMessage('SOLAR HAZARD CLEARED · FLIGHT SYSTEMS STABLE');
          }

          if (sunDistance <= 145) {
            solarHazardPhase = 'exploded';
            solarExplosionStartedAt = now;
            solarRespawnAt = now + 3200;
            solarExplosionGroup.position.copy(ship.position);
            solarExplosionGroup.visible = true;
            solarFireGroup.visible = false;
            ship.visible = false;
            currentSpeed = 0;
            state.keys.clear();
            state.autopilotTarget = null;
            gameAudioRef.current?.playSolarExplosion();
            setExplosionNotice('solar');
            setMessage('SOLAR CORE DISINTEGRATION · JET DESTROYED');
          }
        }

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
            const groundY = state.surfaceGroundY + surfaceTerrainHeight(surfacePlanet.id, localX, localZ, seed);
            const obstacle = (state.surfaceObstacles.get(surfacePlanet.id) ?? []).find(item => Math.hypot(localX - item.x, localZ - item.z) < item.radius + 3 && ship.position.y < state.surfaceGroundY + item.topY + 8);
            if (obstacle) {
              ship.position.x = previousPosition.x;
              ship.position.z = previousPosition.z;
              ship.position.y = Math.max(ship.position.y, state.surfaceGroundY + obstacle.topY + 12);
              currentSpeed *= 0.22;
              if (now - telemetryAt > 900) setMessage('TERRAIN IMPACT · OBSTACLE AHEAD · CHANGE COURSE OR GAIN ALTITUDE');
            }
            const safeGroundY = state.surfaceGroundY + surfaceTerrainHeight(surfacePlanet.id, ship.position.x - originX, ship.position.z - originZ, seed) + 8;
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
        cinematicNebula.update(now * 0.001);
        distantGalaxies.update(dt);

        saturnRingSystems.forEach(system => {
          system.pivot.rotation.z += dt * 0.008;

          const positions = system.geometry.attributes.position as THREE.BufferAttribute;
          const array = positions.array as Float32Array;

          for (let i = 0; i < system.angles.length; i++) {
            system.angles[i] += system.speeds[i] * dt;
            array[i * 3] = Math.cos(system.angles[i]) * system.radii[i];
            array[i * 3 + 1] = Math.sin(system.angles[i]) * system.radii[i];
            array[i * 3 + 2] = system.heights[i];
          }

          positions.needsUpdate = true;
        });

        state.asteroids.forEach(item => {
          const rock = item.mesh;
          rock.rotation.x += dt * 0.035;
          rock.rotation.y += dt * 0.022;

          const distance = rock.position.distanceTo(blackHoleGroup.position);

          if (!rock.userData.blackHoleCaptured && distance < 1800) {
            rock.userData.blackHoleCaptured = true;
            rock.userData.originalScale = rock.scale.clone();
          }

          if (rock.userData.blackHoleCaptured && rock.visible) {
            const inward = blackHoleGroup.position.clone().sub(rock.position);
            const currentDistance = inward.length();

            if (currentDistance > 0.001) {
              inward.normalize();

              // A tangential component creates a visible spiralling path.
              const tangent = new THREE.Vector3(-inward.z, 0.22, inward.x).normalize();
              const pullStrength = 90 + Math.max(0, 1800 - currentDistance) * 0.35;

              rock.position.addScaledVector(inward, pullStrength * dt);
              rock.position.addScaledVector(tangent, (24 + pullStrength * 0.12) * dt);

              const remaining = THREE.MathUtils.clamp(
                (currentDistance - 155) / 1645,
                0.025,
                1
              );
              const originalScale = rock.userData.originalScale as THREE.Vector3;
              rock.scale.copy(originalScale).multiplyScalar(remaining);

              if (currentDistance < 155) {
                rock.visible = false;
                rock.scale.setScalar(0);
              }
            }
          }
        });
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
              child.position.y = surfaceTerrainHeight(state.activePlanet!, child.position.x, child.position.z, state.activePlanet!.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) + 8 + Math.sin(now * 0.003) * 1.5;
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

      if (solarHazardPhase === 'burning') {
        solarFireMeshes.forEach((flame, index) => {
          const flicker = 0.82 + Math.sin(now * 0.018 + index * 2.1) * 0.22;
          flame.scale.set(0.8 + flicker * 0.3, flicker, 0.8 + flicker * 0.25);
          (flame.material as THREE.MeshBasicMaterial).opacity = 0.62 + flicker * 0.25;
        });
      }

      if (solarHazardPhase === 'exploded') {
        const elapsed = Math.max(0, (now - solarExplosionStartedAt) / 1000);

        explosionParticles.forEach(({ mesh, velocity, origin }) => {
          mesh.position.copy(origin).addScaledVector(velocity, elapsed);
          const fade = Math.max(0, 1 - elapsed / 2.7);
          mesh.scale.setScalar(fade);
          (mesh.material as THREE.MeshBasicMaterial).opacity = fade;
        });

        explosionRing.scale.setScalar(0.1 + elapsed * 13);
        explosionRingMaterial.opacity = Math.max(0, 1 - elapsed / 1.5);
        explosionFlash.scale.setScalar(0.5 + elapsed * 8);
        explosionFlashMaterial.opacity = Math.max(0, 1 - elapsed / 0.42);

        if (elapsed < 1.6) {
          camera.position.x += Math.sin(now * 0.075) * 0.18;
          camera.position.y += Math.cos(now * 0.091) * 0.14;
        }

        if (now >= solarRespawnAt) {
          solarExplosionGroup.visible = false;
          ship.visible = true;
          ship.position.set(0, 0, 0);
          ship.rotation.set(0, 0, 0);
          state.velocity.set(0, 0, 0);
          state.yaw = 0;
          state.pitch = 0;
          state.roll = 0;
          state.autopilotTarget = null;
          state.keys.clear();
          currentSpeed = 0;
          solarHazardPhase = 'clear';
          nearPlanetRef.current = null;
          setNearPlanet(null);
          camera.position.set(0, 5.3, 14);
          camera.lookAt(0, 0, -16);
          setMessage('EMERGENCY RECONSTRUCTION COMPLETE · HOME POSITION RESTORED');
        }
      }

      if (blackHolePhase === 'disintegrated') {
        const elapsed = Math.max(
          0,
          (now - blackHolePullStartedAt) / 1000
        );

        const blastProgress = THREE.MathUtils.clamp(elapsed / 0.7, 0, 1);
        blackHoleBlastRing.scale.setScalar(1 + blastProgress * 95);
        blackHoleBlastRingMaterial.opacity = 1 - blastProgress;
        // A powerful initial flash followed by a large expanding blast.
        const flashProgress = THREE.MathUtils.clamp(elapsed / 0.42, 0, 1);
        blackHoleBlastRing.scale.setScalar(1 + blastProgress * 120);
        blackHoleBlastRingMaterial.opacity = 1 - blastProgress;
        blackHoleFlash.scale.setScalar(1 + flashProgress * 58);
        blackHoleFlashMaterial.opacity = Math.max(0, 1 - flashProgress);

        // Staggered shockwaves make the explosion visibly spread through space.
        blackHoleShockRings.forEach((ring, index) => {
          const progress = THREE.MathUtils.clamp(
            (elapsed - index * 0.12) / 1.15,
            0,
            1
          );
          ring.scale.setScalar(0.15 + progress * (145 + index * 24));
          ring.rotation.z += dt * (index % 2 ? -1.8 : 2.2);
          ring.rotation.x += dt * 0.35;
          blackHoleShockMaterials[index].opacity = 1 - progress;
        });

        // Debris bursts outward, tumbles, and gradually fades away.
        blackHoleDebris.forEach((debris, index) => {
          const velocity = debris.userData.blastVelocity as THREE.Vector3;
          debris.position.addScaledVector(velocity, dt);
          velocity.multiplyScalar(Math.max(0, 1 - dt * 0.48));
          debris.rotation.x += dt * (5 + index % 5);
          debris.rotation.y += dt * (4 + index % 7);
          const fade = Math.max(0, 1 - elapsed / 2.8);
          debris.scale.setScalar((0.8 + (index % 4) * 0.25) * fade);
        });

        blackHoleShards.forEach((shard, index) => {
          const direction = shard.userData.pullDirection as THREE.Vector3;
          const inward = blackHoleGroup.position
            .clone()
            .sub(blackHoleShardGroup.position)
            .normalize();

          shard.position.addScaledVector(direction, dt * (65 + index % 4 * 9));
          shard.position.addScaledVector(inward, dt * (5 + elapsed * 8));
          shard.rotation.x += dt * (2 + index * 0.08);
          shard.rotation.y += dt * (2.5 + index * 0.06);
          shard.scale.multiplyScalar(Math.max(0, 1 - dt * 0.9));
        });

        if (now >= blackHoleRespawnAt) {
          blackHoleShardGroup.visible = false;
          blackHoleBlastRing.visible = false;
          blackHoleBlastRing.scale.setScalar(1);
          blackHoleBlastRingMaterial.opacity = 1;
          blackHoleFlash.visible = false;
          blackHoleFlash.scale.setScalar(1);
          blackHoleFlashMaterial.opacity = 1;

          blackHoleShockRings.forEach((ring, index) => {
            ring.visible = false;
            ring.scale.setScalar(0.15);
            blackHoleShockMaterials[index].opacity = 1;
          });

          blackHoleDebris.forEach(debris => {
            debris.visible = false;
            debris.scale.setScalar(1);
            debris.userData.blastVelocity = new THREE.Vector3();
          });

          blackHoleShardGroup.scale.setScalar(1);
          blackHoleVelocity.set(0, 0, 0);

          blackHoleShards.forEach(shard => {
            shard.visible = false;
            shard.scale.setScalar(1);
          });

          ship.visible = true;
          ship.scale.setScalar(1);
          ship.position.set(0, 0, 0);
          ship.rotation.set(0, 0, 0);
          state.velocity.set(0, 0, 0);
          state.yaw = 0;
          state.pitch = 0;
          state.roll = 0;
          state.autopilotTarget = null;
          state.keys.clear();
          currentSpeed = 0;
          blackHolePhase = 'clear';
          nearPlanetRef.current = null;
          setNearPlanet(null);
          camera.position.set(0, 5.3, 14);
          camera.lookAt(0, 0, -16);
          setMessage('BLACK HOLE ESCAPE · SHIP RECONSTRUCTED AT HOME');
        }
      }

      blackHoleAnimation?.update(dt, now * 0.001);
      renderer.render(scene, camera);
      if (now - telemetryAt > 350) {
        telemetryAt = now;
        setSpeed(Math.max(0, Math.round(Math.abs(currentSpeed) * (state.mode === 'surface' ? 2.5 : 12))));
        setCoordinates([state.ship.position.x, state.ship.position.y, state.ship.position.z]);
      }
    };
    animate(performance.now());

    return () => {
      sceneAlive = false;
      cinematicNebula.dispose();
      distantGalaxies.dispose();
      blackHoleAnimation?.dispose();
      blackHoleAnimation = null;
      blackHoleBlastRing.geometry.dispose();
      blackHoleBlastRingMaterial.dispose();
      blackHoleFlash.geometry.dispose();
      blackHoleFlashMaterial.dispose();
      voxelWaterMesh = null;
      gameAudioRef.current?.dispose();
      gameAudioRef.current = null;
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
    const connection = ws.connect(pilotIdRef.current, pilotName);
    const voice = new VoiceChat({
      onStatus: setVoiceStatus,
      onPeers: setVoicePeers,
      onSpeaking: setSpeakingPeerIds,
    });
    voiceRef.current = voice;
    voiceSendRef.current = connection.send;
    voiceConnectionIdRef.current = '';
    voice.setMode(voiceMode);
    let heartbeat = 0;
    let alive = true;
    let readySequence = 0;
    setOnlinePilotList([{ id: pilotIdRef.current, name: pilotName || 'Your pilot' }]);
    const applyPlayer = (player: { id: string; name?: string; x: number; y: number; z: number; yaw?: number; pitch?: number; removed?: boolean }) => {
      if (!alive || player.id === pilotIdRef.current) return;

      setOnlinePilotList(current => {
        if (player.removed) return current.filter(entry => entry.id !== player.id);
        const next = current.filter(entry => entry.id !== player.id);
        next.push({ id: player.id, name: String(player.name || 'PILOT').slice(0, 18) });
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });

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
      if (typeof message?.type === 'string' && message.type.startsWith('voice.')) {
        voice.handleMessage(message);
        return;
      }
      if (message?.type !== 'entity.update' || message.payload?.entity_type !== 'galaxy') return;
      const player = message.payload.data;
      if (player && typeof player.id === 'string') applyPlayer(player);
    });
    connection.onClose(() => {
      readySequence += 1;
      setMultiplayerReady(false);
      voiceConnectionIdRef.current = '';
      voice.handleTransportLost();
      setVoiceStatus('VOICE RECONNECTING');
      setMultiplayerStatus('RECONNECTING');
    });

    connection.onError(() => {
      setMultiplayerReady(false);
      voiceConnectionIdRef.current = '';
      voice.handleTransportLost();
      setMultiplayerStatus('RECONNECTING');
    });

    connection.onReady(async (connectionId: string) => {
      const sequence = ++readySequence;
      voiceSendRef.current = connection.send;
      voiceConnectionIdRef.current = connectionId;
      setMultiplayerReady(true);

      try {
        await api.post('/api/subscriptions', {
          entity_type: 'galaxy',
          entity_id: 'main',
          connection_id: connectionId,
        });

        const response = await api.get('/api/players');

        // Ignore responses belonging to an older WebSocket connection.
        if (!alive || sequence !== readySequence || connection.connectionId !== connectionId) return;

        const uniquePlayers = new Map<string, any>();

        (response.data?.players || []).forEach((player: any) => {
          if (player && typeof player.id === 'string') {
            uniquePlayers.set(player.id, player);
          }
        });

        uniquePlayers.forEach(player => applyPlayer(player));

        if (!alive || sequence !== readySequence || connection.connectionId !== connectionId) return;

        voice.reconnect(connection.send, connectionId);
        setMultiplayerStatus('LIVE');
      } catch {
        if (alive && sequence === readySequence && connection.connectionId === connectionId) {
          setMultiplayerReady(false);
          setMultiplayerStatus('OFFLINE');
        }
      }
    });

    let heartbeatInFlight = false;
    heartbeat = window.setInterval(() => {
      const state = sceneRef.current;
      if (!alive || !state || !connection.isConnected || !connection.connectionId || heartbeatInFlight) return;

      const remotePositions: Record<string, [number, number, number]> = {};
      state.remoteShips.forEach((ship, id) => {
        remotePositions[id] = [ship.position.x, ship.position.y, ship.position.z];
      });
      voice.setPositions(
        [state.ship.position.x, state.ship.position.y, state.ship.position.z],
        remotePositions
      );

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
      readySequence += 1;
      setMultiplayerReady(false);
      window.clearInterval(heartbeat);
      voice.stop();
      if (voiceRef.current === voice) voiceRef.current = null;
      voiceSendRef.current = null;
      voiceConnectionIdRef.current = '';
      setVoiceActive(false);
      setVoiceMuted(false);
      if (connection.connectionId) {
        api.post('/api/subscriptions/remove', { entity_type: 'galaxy', entity_id: 'main', connection_id: connection.connectionId }).catch(() => undefined);
        api.delete(`/api/players/${pilotIdRef.current}`, {
          connection_id: connection.connectionId,
        }).catch(() => undefined);
      }
      connection.disconnect();
    };
  }, [gameStarted, pilotName]);

  const toggleVoice = async () => {
    const voice = voiceRef.current;
    const send = voiceSendRef.current;
    const connectionId = voiceConnectionIdRef.current;

    if (!multiplayerReady || !voice || !send || !connectionId) {
      setVoiceStatus('MULTIPLAYER NOT READY');
      return;
    }

    if (voiceActive) {
      voice.stop();
      setVoiceActive(false);
      setVoiceMuted(false);
      return;
    }

    setVoiceStarting(true);
    voice.setMode(voiceMode);
    const started = await voice.start(send, connectionId);
    setVoiceActive(started);
    setVoiceMuted(false);
    setVoiceStarting(false);
  };

  const changeVoiceMode = (mode: VoiceMode) => {
    setVoiceMode(mode);
    voiceRef.current?.setMode(mode);
  };

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
    state.loadSurfaceTerrain(planet.id);
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
      {explosionNotice && (
        <div
          className={`explosion-announcement ${explosionNotice === 'solar' ? 'solar-announcement' : 'black-hole-announcement'}`}
          role="alert"
          onAnimationEnd={() => setExplosionNotice(null)}
        >
          <div className="explosion-announcement-line">
            <span />
            {explosionNotice === 'solar' ? 'FLIGHT SYSTEM FAILURE' : 'GRAVITY EVENT DETECTED'}
            <span />
          </div>
          <div className="explosion-announcement-title">
            {explosionNotice === 'solar'
              ? 'SOLAR CORE DISINTEGRATION'
              : 'EVENT HORIZON CONSUMPTION'}
          </div>
          <div className="explosion-announcement-subtitle">
            {explosionNotice === 'solar'
              ? 'SPACECRAFT DESTROYED'
              : 'SPACECRAFT DISINTEGRATED'}
          </div>
          <div className="explosion-announcement-detail">
            {explosionNotice === 'solar'
              ? 'EXTREME SOLAR HEAT AND RADIATION'
              : 'EXTREME GRAVITATIONAL CAPTURE'}
          </div>
          <div className="explosion-announcement-footer">
            {explosionNotice === 'solar'
              ? 'EMERGENCY RECONSTRUCTION INITIATED'
              : 'EVENT HORIZON BREACH · RECONSTRUCTION INITIATED'}
          </div>
        </div>
      )}
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
          gameAudioRef.current?.dispose();
          gameAudioRef.current = new GameAudio();
          gameAudioRef.current.start();
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
      <div className="online-pilots-widget">
        <button className="online-pilots-toggle"
          onClick={() => setShowOnlinePilots(value => !value)}
          aria-expanded={showOnlinePilots}
          aria-label={showOnlinePilots ? 'Hide online pilots' : 'Show online pilots'}>
          <Users size={16} />
          <span>ONLINE PILOTS</span>
          <strong>{onlinePilotList.length || onlinePlayers}</strong>
          <ChevronDown size={15} className={showOnlinePilots ? 'online-pilots-chevron open' : 'online-pilots-chevron'} />
        </button>

        {showOnlinePilots && <section className="online-pilots-panel glass">
          <div className="online-pilots-heading">
            <div>
              <strong>GALAXY NETWORK</strong>
              <small>
                <span className={multiplayerStatus === 'LIVE' ? 'online-status-dot' : 'online-status-dot offline'} />
                {multiplayerStatus}
              </small>
            </div>
            <span className="online-pilots-total">{onlinePilotList.length || onlinePlayers} ONLINE</span>
          </div>
          <div className="online-pilots-list">
            {(onlinePilotList.length ? onlinePilotList : [
              { id: pilotIdRef.current, name: pilotName || 'Your pilot' }
            ]).map(player => (
              <div className="online-pilot-row" key={player.id}>
                <span className="online-status-dot" />
                <span className="online-pilot-name">{player.name}</span>
                {player.id === pilotIdRef.current && <span className="online-pilot-you">YOU</span>}
              </div>
            ))}
          </div>
          <div className="online-pilots-footer">LIVE MULTIPLAYER ROSTER</div>
        </section>}
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
          <button
            className="planetary-descent-button"
            onClick={descendToPlanet}
            disabled={!nearPlanet || flightMode !== 'space'}
            aria-label={nearPlanet ? `Descend to ${planets.find(p => p.id === nearPlanet)?.name || 'nearby planet'}` : 'Approach a planet to descend'}
          >
            <Mountain size={16} />
            {flightMode !== 'space'
              ? 'PLANETARY DESCENT UNAVAILABLE'
              : nearPlanet
                ? `DESCEND TO ${planets.find(p => p.id === nearPlanet)?.name.toUpperCase() || 'PLANET'}`
                : 'APPROACH A PLANET TO DESCEND'}
          </button>
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
        {hudVisible && <div className="voice-panel">
          <div className="voice-panel-heading">
            <strong>LIVE VOICE LINK</strong>
            <span className={voiceActive ? 'voice-live-dot active' : 'voice-live-dot'} />
          </div>
          <div className="voice-status">{voiceStatus}</div>
          <div className="voice-actions">
            <button
              className={voiceActive ? 'voice-main-button active' : 'voice-main-button'}
              onClick={() => { void toggleVoice(); }}
              disabled={voiceStarting || !gameStarted || !multiplayerReady}
              title="Enable or disable live voice"
            >
              {voiceStarting ? 'CONNECTING…' : voiceActive ? 'VOICE ON' : 'ENABLE MIC'}
            </button>
            {voiceActive && <button
              className="voice-mute-button"
              onClick={() => {
                const nextMuted = !voiceMuted;
                voiceRef.current?.setMuted(nextMuted);
                setVoiceMuted(nextMuted);
              }}
              title={voiceMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {voiceMuted ? <MicOff size={14} /> : <Mic size={14} />}
              {voiceMuted ? 'MUTED' : 'MUTE'}
            </button>}
          </div>
          {voiceActive && <div className="voice-mode-buttons">
            <button className={voiceMode === 'nearby' ? 'selected' : ''} onClick={() => changeVoiceMode('nearby')}>NEARBY</button>
            <button className={voiceMode === 'global' ? 'selected' : ''} onClick={() => changeVoiceMode('global')}>GLOBAL</button>
          </div>}
          {voiceActive && <div className="voice-peer-list">
            {voicePeers.length === 0
              ? <span>WAITING FOR OTHER PILOTS…</span>
              : voicePeers.map(peer => <div className="voice-peer" key={peer.id}>
                  <span className={speakingPeerIds.includes(peer.id) ? 'voice-speaking-dot speaking' : 'voice-speaking-dot'} />
                  <span>{peer.name || 'PILOT'}</span>
                  {speakingPeerIds.includes(peer.id) && <small>SPEAKING</small>}
                </div>)}
          </div>}
        </div>}
      {flightMode === 'landing' && <div className="landing-overlay"><div className="landing-label">ATMOSPHERIC ENTRY</div><div className="landing-title">DESCENDING TO SURFACE</div><div className="landing-track"><span /></div><p>Stabilising flight systems · Preparing terrain</p></div>}
    </main>
  );
}

export default App;
