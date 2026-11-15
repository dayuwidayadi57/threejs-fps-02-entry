// test-world.mjs — headless validation of the Foundry Yard geometry, run with
// `node test-world.mjs`. No browser needed: three.js builds the scene graph
// without rendering. Checks the anti-trap rules from the rebuild spec:
// every waypoint and spawn clears every collider by the 0.34 m body radius
// (and by 0.84 m where a bot can stop within 0.5 m of the node), every
// waypoint link is walkable by a 0.34 m body, and no flat plate is a collider.
import * as THREE from 'three';
import { createWorld, WAYPOINTS, SITES, SPAWNS } from './game/src/world.js';
import { RADIUS, HEIGHT } from './game/src/physics.js';

const scene = new THREE.Scene();
const { colliders } = createWorld(scene);

let failures = 0;
let warnings = 0;

// 2D (XZ) distance from a point to a collider's footprint; negative when the
// point sits inside the footprint. Only colliders whose height overlaps the
// standing body [0, HEIGHT] can block a body at all.
function clearance(x, z) {
  let worst = Infinity;
  let worstBox = null;
  for (const c of colliders) {
    if (c.min.y >= HEIGHT || c.max.y <= 0) continue;
    const dx = Math.max(c.min.x - x, 0, x - c.max.x);
    const dz = Math.max(c.min.z - z, 0, z - c.max.z);
    const d = Math.hypot(dx, dz);
    if (d < worst) { worst = d; worstBox = c; }
  }
  return { d: worst, box: worstBox };
}

function describeBox(c) {
  return `[x ${c.min.x.toFixed(1)}..${c.max.x.toFixed(1)} z ${c.min.z.toFixed(1)}..${c.max.z.toFixed(1)} y ${c.min.y.toFixed(1)}..${c.max.y.toFixed(1)}]`;
}

console.log(`colliders: ${colliders.length}`);

// 1. No flat plate may be a collider.
for (const c of colliders) {
  if (c.max.y - c.min.y < 0.2) {
    console.log(`FAIL plate collider ${describeBox(c)}`);
    failures++;
  }
}

// 2. Waypoints and spawns clear every collider. The 0.84 m arrival-radius
// warning applies to WAYPOINTS only: a bot can stop anywhere within 0.5 m
// of a node, so the collider must clear the node by 0.5 + 0.34. Spawns and
// site centres are exact points — the 0.34 m body radius is the bar there.
const points = [];
for (const [name, n] of Object.entries(WAYPOINTS)) points.push([`waypoint ${name}`, n.x, n.z, true]);
for (const [team, list] of Object.entries(SPAWNS)) {
  list.forEach((s, i) => points.push([`spawn ${team}[${i}]`, s.x, s.z, false]));
}
for (const [siteId, s] of Object.entries(SITES)) points.push([`site ${siteId}`, s.center.x, s.center.z, false]);
for (const [label, x, z, isWaypoint] of points) {
  const { d, box } = clearance(x, z);
  if (d < RADIUS) {
    console.log(`FAIL ${label} (${x}, ${z}) clears its nearest collider by ${d.toFixed(2)} m < ${RADIUS} m ${describeBox(box)}`);
    failures++;
  } else if (isWaypoint && d < 0.5 + RADIUS) {
    console.log(`WARN ${label} (${x}, ${z}) clears its nearest collider by ${d.toFixed(2)} m < 0.84 m (arrival radius) ${describeBox(box)}`);
    warnings++;
  }
}

// 3. Every link is walkable: sample the segment every 0.1 m and require the
// 0.34 m body box to stay clear of every collider.
function segmentBlocked(ax, az, bx, bz) {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(len / 0.1));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const { d } = clearance(x, z);
    if (d < RADIUS) return { x, z, d };
  }
  return null;
}

const seenLinks = new Set();
for (const [from, n] of Object.entries(WAYPOINTS)) {
  for (const to of n.links) {
    const key = [from, to].sort().join('<->');
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    if (!WAYPOINTS[to]) {
      console.log(`FAIL link ${from} -> ${to}: target node does not exist`);
      failures++;
      continue;
    }
    const hit = segmentBlocked(n.x, n.z, WAYPOINTS[to].x, WAYPOINTS[to].z);
    if (hit) {
      console.log(`FAIL link ${from} -> ${to} blocked at (${hit.x.toFixed(2)}, ${hit.z.toFixed(2)}) clearance ${hit.d.toFixed(2)} m`);
      failures++;
    }
  }
}

console.log(`links checked: ${seenLinks.size}`);
console.log(`warnings: ${warnings}  failures: ${failures}`);
process.exit(failures ? 1 : 0);
