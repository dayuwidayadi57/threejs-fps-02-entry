// world.js — Foundry Yard, the 44 x 30 m dusk foundry. Every box and cylinder
// is BOTH a collider (Box3) and a shootable (raycast target). No spawn or
// waypoint sits within a collider edge plus the 0.34 m body radius: a body
// that starts overlapped can never move again (see physics.js).
import * as THREE from 'three';
import { PALETTE, shade } from './palette.js';

export const SITES = {
  A: { center: { x: -16, z: -9 }, radius: 4.2, color: PALETTE.accent },
  B: { center: { x: 16, z: -9 }, radius: 4.2, color: PALETTE.teal },
};

export const SPAWNS = {
  vanguard: [{ x: -6, z: 12.5 }, { x: 0, z: 13 }, { x: 6, z: 12.5 }],
  ember: [{ x: -14, z: -11.5 }, { x: -6, z: -12 }, { x: 2, z: -11 }, { x: 10, z: -12 }, { x: 16, z: -11.5 }],
};

// The waypoint graph bots walk. Every link is a clear sightline; there is no
// eSpawn node (it sat inside the furnace plinth), and there is deliberately
// NO vMid <-> vSpawn link: the splitter stands across that line, so bots
// route around it through vWest or vEast instead of stalling against it.
export const WAYPOINTS = {
  vSpawn: { x: 0, z: 12, links: ['vWest', 'vEast'] },
  vMid: { x: 0, z: 7, links: ['midSouth', 'vWest', 'vEast'] },
  vWest: { x: -14, z: 8, links: ['vSpawn', 'midWest'] },
  vEast: { x: 14, z: 8, links: ['vSpawn', 'midEast'] },
  midSouth: { x: 0, z: 2, links: ['vMid', 'mid', 'midWest', 'midEast'] },
  midWest: { x: -8, z: 1, links: ['midSouth', 'mid', 'aApproach', 'vWest'] },
  midEast: { x: 8, z: 1, links: ['midSouth', 'mid', 'bApproach', 'vEast'] },
  mid: { x: 0, z: -3, links: ['midSouth', 'midWest', 'midEast', 'midNorth'] },
  midNorth: { x: 0, z: -8, links: ['mid', 'aNorth', 'bNorth'] },
  aApproach: { x: -14, z: -2, links: ['midWest', 'siteA'] },
  bApproach: { x: 14, z: -2, links: ['midEast', 'siteB'] },
  aNorth: { x: -10, z: -9, links: ['midNorth', 'siteA'] },
  bNorth: { x: 10, z: -9, links: ['midNorth', 'siteB'] },
  siteA: { x: -16, z: -9, links: ['aApproach', 'aNorth'] },
  siteB: { x: 16, z: -9, links: ['bApproach', 'bNorth'] },
};

export function createWorld(scene) {
  const group = new THREE.Group();
  const colliders = [];
  const shootables = [];
  const mats = new Map();

  function mat(color, emissive) {
    const key = color + '|' + (emissive || '');
    if (!mats.has(key)) {
      mats.set(key, new THREE.MeshStandardMaterial({
        color, roughness: 0.85, metalness: 0.15,
        emissive: emissive || 0x000000, emissiveIntensity: emissive ? 0.9 : 0,
      }));
    }
    return mats.get(key);
  }

  function addBox(cx, cy, cz, sx, sy, sz, color, emissive, solid) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(color, emissive));
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // solid = false is a visual only: a 6 cm plate must never stop a body.
    if (solid !== false) {
      colliders.push(new THREE.Box3(
        new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
        new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2)));
    }
    shootables.push(mesh);
    return mesh;
  }

  function addCylinder(cx, cy, cz, rTop, rBottom, h, color, emissive) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, 20), mat(color, emissive));
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const r = Math.max(rTop, rBottom);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(cx - r, cy - h / 2, cz - r),
      new THREE.Vector3(cx + r, cy + h / 2, cz + r)));
    shootables.push(mesh);
    return mesh;
  }

  const floor = PALETTE.surface;
  const wall = shade(PALETTE.surface, 0.75);
  const crate = '#6b5636';
  const crateDark = shade(crate, 0.7);
  const metal = '#4c4a44';
  const furnace = '#3a3230';

  // Floor and outer walls (walls 5 high on the yard boundary).
  addBox(0, -0.2, 0, 44.4, 0.4, 30.4, floor);
  addBox(0, 2.5, -15.2, 44.8, 5, 0.4, wall);
  addBox(0, 2.5, 15.2, 44.8, 5, 0.4, wall);
  addBox(-22.2, 2.5, 0, 0.4, 5, 30.8, wall);
  addBox(22.2, 2.5, 0, 0.4, 5, 30.8, wall);

  // Site plates and glowing marker pillars. The plates are painted ground,
  // not walls: a 6 cm lip must never stop a body from standing on the site.
  addBox(-16, 0.03, -9, 7.5, 0.06, 7.5, PALETTE.accent, PALETTE.accent, false);
  addBox(16, 0.03, -9, 7.5, 0.06, 7.5, PALETTE.teal, PALETTE.teal, false);
  addBox(-19.5, 2.2, -12.5, 0.5, 4.4, 0.5, PALETTE.accent, PALETTE.accent);
  addBox(19.5, 2.2, -12.5, 0.5, 4.4, 0.5, PALETTE.teal, PALETTE.teal);

  // North dressing: chimneys, furnace block and plinth.
  addCylinder(-20.5, 4.5, -13.5, 1.1, 1.4, 9, furnace);
  addCylinder(20.5, 4.5, -13.5, 1.1, 1.4, 9, furnace);
  addBox(0, 1.7, -14.2, 5, 3.4, 1.6, furnace);
  addBox(0, 0.25, -12.6, 5, 0.5, 2.2, metal);

  // Mid: furnace block EAST of the lane (never on the waypoint spine),
  // crates and low crates. The furnace sits at x 4.6, not 4: at x 4 its
  // south-west corner grazed the midEast-mid link by 0.33 m. The mid crates
  // sit at z 3.2, not 2.2: at 2.2 their edge grazed the midSouth-midWest and
  // midSouth-midEast links by 0.33 m, and at 2.8 their corner still grazed
  // by 0.34 m. The low crates sit at z 5.5, not 6.5: at 6.5 they grazed the
  // vMid-vWest and vMid-vEast links by 0.31 m.
  addBox(4.6, 1.7, -3, 2.2, 3.4, 2.2, furnace);
  addBox(-3.4, 0.55, 3.2, 1.6, 1.1, 1.6, crate);
  addBox(3.4, 0.55, 3.2, 1.6, 1.1, 1.6, crateDark);
  addBox(-1.8, 0.35, 5.5, 1.2, 0.7, 1.2, crate);
  addBox(1.8, 0.35, 5.5, 1.2, 0.7, 1.2, crateDark);

  // A lane (west): container, stacked crates, crate, low block. The stacked
  // pair reads as one tall crate from the lane; both boxes collide.
  addBox(-14, 1.3, 2, 6, 2.6, 1.4, metal);
  addBox(-18.5, 0.55, -2, 1.6, 1.1, 1.6, crate);
  addBox(-18.5, 1.65, -2, 1.6, 1.1, 1.6, crateDark);
  addBox(-10.5, 0.55, -5.5, 1.6, 1.1, 1.6, crate);
  addBox(-19, 0.45, -6.5, 2.4, 0.9, 1.2, metal);

  // B lane (east): pillars, crate row, crate, low block.
  addBox(14, 1.6, 3, 1.2, 3.2, 1.2, metal);
  addBox(10.5, 1.6, -4, 1.2, 3.2, 1.2, metal);
  addBox(18.5, 0.55, 1.5, 3.4, 1.1, 1.2, crate);
  addBox(12, 0.55, -6.5, 1.6, 1.1, 1.6, crateDark);
  addBox(19, 0.45, -6.5, 2.4, 0.9, 1.2, metal);

  // South cover and the splitter. The cover blocks sit at z 8.5, not 9.5:
  // at 9.5 their north edge grazed the vSpawn-vWest and vSpawn-vEast links
  // at exactly the 0.34 m body radius — a floating-point coin flip.
  addBox(-5, 0.45, 8.5, 2.4, 0.9, 1.2, crate);
  addBox(5, 0.45, 8.5, 2.4, 0.9, 1.2, crateDark);
  addBox(0, 0.55, 10, 3.4, 1.1, 1.2, metal);

  scene.add(group);
  return { colliders, shootables, group };
}
