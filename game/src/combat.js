// combat.js — hitscan shots with pooled tracers and sparks, line of sight,
// and the grenade. Pools are preallocated; the hot path makes no objects.
import * as THREE from 'three';

const TRACERS = 14;
const TRACER_LIFE = 0.09;
const SPARKS = 10;
const SPARK_LIFE = 0.12;

export function createCombat(scene, shootables) {
  const RAY_FAR = 220;
  const ray = new THREE.Raycaster();
  ray.far = RAY_FAR;
  const tmpDir = new THREE.Vector3();
  const tmpTo = new THREE.Vector3();

  const tracers = [];
  for (let i = 0; i < TRACERS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0 }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerI = 0;

  const sparks = [];
  for (let i = 0; i < SPARKS; i++) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe1a0, transparent: true, opacity: 0 }));
    s.visible = false;
    scene.add(s);
    sparks.push({ mesh: s, life: 0 });
  }
  let sparkI = 0;

  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0, depthWrite: false }));
  blast.visible = false;
  scene.add(blast);
  let blastLife = 0;

  const grenades = [];

  function fireTracer(from, to) {
    const t = tracers[tracerI];
    tracerI = (tracerI + 1) % TRACERS;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.life = TRACER_LIFE;
    t.line.visible = true;
    t.line.material.opacity = 0.85;
  }

  // One reusable blast sphere: each explosion replays the same mesh.

  function fireSpark(at) {
    const s = sparks[sparkI];
    sparkI = (sparkI + 1) % SPARKS;
    s.mesh.position.copy(at);
    s.life = SPARK_LIFE;
    s.mesh.visible = true;
    s.mesh.material.opacity = 0.9;
  }

  // First non-friendly hit along the ray, with a tracer and a spark.
  // targets mixes world meshes with bot and player hit meshes; isFriendly
  // skips the shooter's own side. Returns null on a clean miss.
  function shoot(origin, dir, targets, isFriendly) {
    // The raycaster is shared with hasLineOfSight, which narrows its range;
    // a shot always fires at full range, so restore it before casting.
    ray.far = RAY_FAR;
    ray.set(origin, dir);
    const hits = ray.intersectObjects(targets, false);
    let hit = null;
    for (let i = 0; i < hits.length; i++) {
      if (isFriendly && isFriendly(hits[i].object)) continue;
      hit = hits[i];
      break;
    }
    const end = hit ? hit.point : tmpTo.copy(dir).multiplyScalar(80).add(origin);
    fireTracer(origin, end);
    if (hit) {
      fireSpark(hit.point);
      return { point: hit.point, object: hit.object, distance: hit.distance };
    }
    return null;
  }

  // True when nothing solid stands between from and to. extraTargets are
  // hit meshes to treat as blockers too (bots and the player block sight).
  function hasLineOfSight(from, to, extraTargets) {
    tmpDir.copy(to).sub(from);
    const dist = tmpDir.length();
    if (dist < 0.01) return true;
    tmpDir.multiplyScalar(1 / dist);
    ray.set(from, tmpDir);
    ray.far = dist - 0.05;
    const list = extraTargets && extraTargets.length ? shootables.concat(extraTargets) : shootables;
    const clear = ray.intersectObjects(list, false).length === 0;
    // Restore the shared raycaster's full range: the next shot (or LOS
    // check) must not inherit this check's short range.
    ray.far = RAY_FAR;
    return clear;
  }

  function throwGrenade(origin, velocity) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.4, metalness: 0.2, emissive: 0x903c00, emissiveIntensity: 0.6 }));
    mesh.position.copy(origin);
    scene.add(mesh);
    grenades.push({ pos: mesh.position, vel: velocity.clone(), fuse: 1.4, bounced: false, mesh });
  }

  function stepGrenades(dt, damageAt, explodeFx) {
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i];
      g.vel.y -= 18 * dt;
      g.pos.x += g.vel.x * dt;
      g.pos.y += g.vel.y * dt;
      g.pos.z += g.vel.z * dt;
      if (g.pos.y <= 0.12 && g.vel.y < 0) {
        if (!g.bounced) {
          g.bounced = true;
          g.pos.y = 0.12;
          g.vel.y *= -0.45;
          g.vel.x *= 0.7;
          g.vel.z *= 0.7;
        } else {
          g.pos.y = 0.12;
          g.vel.y = 0;
          g.vel.x = 0;
          g.vel.z = 0;
        }
      }
      g.fuse -= dt;
      if (g.fuse <= 0) {
        blast.position.copy(g.pos);
        blast.scale.setScalar(0.5);
        blast.visible = true;
        blast.material.opacity = 0.85;
        blastLife = 0.28;
        if (explodeFx) explodeFx(g.pos);
        if (damageAt) damageAt(g.pos);
        scene.remove(g.mesh);
        grenades.splice(i, 1);
      }
    }
  }

  function clearGrenades() {
    for (const g of grenades) scene.remove(g.mesh);
    grenades.length = 0;
  }

  function stepFx(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.line.visible = false; continue; }
      t.line.material.opacity = 0.85 * (t.life / TRACER_LIFE);
    }
    for (const s of sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      s.mesh.material.opacity = 0.9 * (s.life / SPARK_LIFE);
    }
    if (blastLife > 0) {
      blastLife -= dt;
      const k = Math.max(0, blastLife / 0.28);
      blast.scale.setScalar(0.5 + (1 - k) * 11);
      blast.material.opacity = 0.85 * k;
      if (blastLife <= 0) blast.visible = false;
    }
  }

  return { shoot, hasLineOfSight, throwGrenade, stepGrenades, clearGrenades, stepFx };
}
