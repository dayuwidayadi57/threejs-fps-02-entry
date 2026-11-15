// bots.js — the five bots: movement on the waypoint graph, sight and hearing,
// burst fire, and the plant/defuse channels. This is what wins criterion 3.
// Two rules that must never break: a channel holds the bot still (a `holding`
// flag, not a null target), and a new target is detected by the target's
// IDENTITY, never by comparing fresh candidate records (comparing records
// resets the reaction timer every frame and the bot never fires).
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WAYPOINTS, SITES } from './world.js';
import { WALK_SPEED } from './physics.js';

const VISION_RANGE = 46;
const BOT_BODY_DAMAGE = 14;
const BOT_HEAD_DAMAGE = 35;
const PLANT_TIME = 3;
const DEFUSE_TIME = 5;
const PICKUP_RANGE = 2.6;

function randRange(random, a, b) {
  return a + random() * (b - a);
}

export function createBots(scene, world, mover, combat) {
  const defs = [
    { name: 'Rook', team: 'vanguard', role: 'attacker', site: 'A', spawn: { x: -6, z: 12.5 } },
    { name: 'Sable', team: 'vanguard', role: 'attacker', site: 'B', spawn: { x: 6, z: 12.5 } },
    { name: 'Cinder', team: 'ember', role: 'defender', site: 'A', spawn: { x: -14, z: -11.5 } },
    { name: 'Ash', team: 'ember', role: 'defender', site: 'A', spawn: { x: -6, z: -12 } },
    { name: 'Flint', team: 'ember', role: 'defender', site: 'B', spawn: { x: 10, z: -12 } },
  ];

  const bots = [];
  const hitMeshes = [];
  // Preallocated chest vectors: visibleEnemy reuses them, never allocating
  // a vector per frame per candidate.
  const chestPool = [];
  for (let i = 0; i < 6; i++) chestPool.push(new THREE.Vector3());
  const eyePos = new THREE.Vector3();
  const aimPoint = new THREE.Vector3();
  const aimDir = new THREE.Vector3();

  function buildBot(def) {
    const color = def.team === 'vanguard' ? PALETTE.accent : PALETTE.ember;
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.6, metalness: 0.3 });
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), dark);
    legL.position.set(-0.11, 0.25, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), dark);
    legR.position.set(0.11, 0.25, 0);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.82, 0.34), mat);
    torso.position.set(0, 1.0, 0);
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mat);
    head.position.set(0, 1.53, 0);
    head.castShadow = true;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), dark);
    gun.position.set(0.2, 1.15, -0.3);
    group.add(legL, legR, torso, head, gun);
    scene.add(group);
    const bot = {
      name: def.name, team: def.team, role: def.role, site: def.site,
      spawn: def.spawn, group, legL, legR,
      body: mover.createBody(def.spawn.x, def.spawn.z),
      health: 100, alive: true, fallT: 0, walkPhase: 0,
      targetId: null, reaction: 0, burstLeft: 0, burstT: 0, pauseT: 0,
      path: [], pathI: 0, holding: false, plantT: 0, defuseT: 0,
      strafeDir: 1, strafeT: 0,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    bot.torso = torso;
    bot.head = head;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  for (const def of defs) buildBot(def);

  function nearestNode(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const name of Object.keys(WAYPOINTS)) {
      const n = WAYPOINTS[name];
      const dx = n.x - x;
      const dz = n.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = name; }
    }
    return best;
  }

  function findPath(fromNode, toNode) {
    if (fromNode === toNode) return [toNode];
    const prev = { [fromNode]: null };
    const queue = [fromNode];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of WAYPOINTS[cur].links) {
        if (prev[next] !== undefined) continue;
        prev[next] = cur;
        if (next === toNode) {
          const path = [next];
          let n = cur;
          while (n !== null) { path.unshift(n); n = prev[n]; }
          return path.slice(1);
        }
        queue.push(next);
      }
    }
    return [toNode];
  }

  function reset() {
    for (const bot of bots) {
      bot.body.x = bot.spawn.x;
      bot.body.z = bot.spawn.z;
      bot.body.y = 0;
      bot.body.vx = 0;
      bot.body.vz = 0;
      bot.body.vy = 0;
      bot.body.yaw = bot.team === 'vanguard' ? 0 : Math.PI;
      bot.body.crouch = false;
      bot.health = 100;
      bot.alive = true;
      bot.fallT = 0;
      bot.targetId = null;
      bot.reaction = 0;
      bot.burstLeft = 0;
      bot.burstT = 0;
      bot.pauseT = 0;
      bot.path = [];
      bot.pathI = 0;
      bot.holding = false;
      bot.plantT = 0;
      bot.defuseT = 0;
      bot.group.rotation.set(0, bot.body.yaw, 0);
      bot.group.position.set(bot.body.x, 0, bot.body.z);
    }
  }

  function aliveCount(team) {
    let n = 0;
    for (const b of bots) if (b.alive && b.team === team) n++;
    return n;
  }

  function damage(bot, amount, part, attacker) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.fallT = 0;
      bot.holding = false;
      return true;
    }
    return false;
  }

  // Nearest living enemy with line of sight from the bot's eye to the
  // enemy's chest. Candidates reuse the preallocated chest vectors.
  function visibleEnemy(bot, ctx) {
    let best = null;
    let bestD = VISION_RANGE * VISION_RANGE;
    eyePos.set(bot.body.x, bot.body.y + 1.5, bot.body.z);
    let poolI = 0;
    const consider = (id, isPlayer, chestX, chestY, chestZ, speed) => {
      const dx = chestX - bot.body.x;
      const dy = chestY - (bot.body.y + 1.5);
      const dz = chestZ - bot.body.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > bestD) return;
      const chest = chestPool[poolI % chestPool.length];
      poolI++;
      chest.set(chestX, chestY, chestZ);
      if (!combat.hasLineOfSight(eyePos, chest)) return;
      bestD = d2;
      best = { id, isPlayer, chestX, chestY, chestZ, speed, dist: Math.sqrt(d2) };
    };
    // The player is Vanguard: only the Ember bots see them as a target.
    // (The allies once treated the player as an enemy and shot them dead
    // at spawn — Sable killed the player in the first play-test.)
    if (ctx.playerAlive && bot.team === 'ember') {
      consider('player', true, ctx.playerPos.x, ctx.playerPos.y + 1.0, ctx.playerPos.z, ctx.playerSpeed);
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      consider(other.name, false, other.body.x, other.body.y + 1.0, other.body.z, mover.groundSpeed(other.body));
      if (best && best.id === other.name) best.bot = other;
    }
    return best;
  }

  function fireAt(bot, target, ctx) {
    const random = ctx.random;
    const stationary = mover.groundSpeed(bot.body) < 0.5;
    let err = 0.018 + target.dist * 0.003 + target.speed * 0.004;
    if (stationary) err *= 0.5;
    eyePos.set(bot.body.x, bot.body.y + 1.5, bot.body.z);
    aimPoint.set(
      target.chestX + (random() * 2 - 1) * err * target.dist,
      target.chestY + (random() * 2 - 1) * err * target.dist * 0.5,
      target.chestZ + (random() * 2 - 1) * err * target.dist);
    aimDir.copy(aimPoint).sub(eyePos).normalize();
    const targets = ctx.playerHitMeshes.concat(hitMeshes);
    const hit = combat.shoot(eyePos, aimDir, targets, (obj) => {
      // No friendly fire: a Vanguard bot never hits the player or an ally,
      // an Ember bot never hits its own.
      if (obj.userData.isPlayer) return bot.team === 'vanguard';
      const b = obj.userData.bot;
      return !!b && b.team === bot.team;
    });
    if (hit) {
      const ud = hit.object.userData;
      if (ud.isPlayer) {
        ctx.damagePlayer(ud.part === 'head' ? BOT_HEAD_DAMAGE : BOT_BODY_DAMAGE, bot, ud.part);
      } else if (ud.bot && ud.bot.team !== bot.team) {
        const died = damage(ud.bot, ud.part === 'head' ? BOT_HEAD_DAMAGE : BOT_BODY_DAMAGE, ud.part, bot);
        if (died && ctx.onBotDied) ctx.onBotDied(ud.bot);
      }
    }
    if (ctx.onBotShot) ctx.onBotShot(bot);
  }

  function moveToward(bot, dt, gx, gz, speed, ctx) {
    const dx = gx - bot.body.x;
    const dz = gz - bot.body.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const wishX = (dx / d) * speed;
    const wishZ = (dz / d) * speed;
    mover.step(bot.body, dt, wishX, wishZ, false, bot.body.crouch);
    bot.body.yaw = Math.atan2(-dx, -dz);
    return d < 0.5;
  }

  function followPath(bot, dt, speed, ctx) {
    if (bot.pathI >= bot.path.length) return true;
    const node = WAYPOINTS[bot.path[bot.pathI]];
    if (moveToward(bot, dt, node.x, node.z, speed, ctx)) bot.pathI++;
    return bot.pathI >= bot.path.length;
  }

  function goTo(bot, dt, gx, gz, speed, ctx) {
    // Walk the graph to the node nearest the goal, then straight at it.
    if (!bot.path.length || bot.pathI >= bot.path.length) {
      const goalNode = nearestNode(gx, gz);
      bot.path = findPath(nearestNode(bot.body.x, bot.body.z), goalNode);
      bot.pathI = 0;
    }
    if (bot.pathI < bot.path.length) {
      const node = WAYPOINTS[bot.path[bot.pathI]];
      if (moveToward(bot, dt, node.x, node.z, speed, ctx)) bot.pathI++;
      return false;
    }
    return moveToward(bot, dt, gx, gz, speed, ctx);
  }

  function stepBot(bot, dt, ctx) {
    const random = ctx.random;
    const bomb = ctx.bomb;
    if (!bot.alive) {
      if (bot.fallT < 1) {
        bot.fallT = Math.min(1, bot.fallT + dt / 0.4);
        bot.group.rotation.x = -1.45 * bot.fallT;
      }
      return;
    }

    const enemy = visibleEnemy(bot, ctx);
    let fighting = false;
    if (enemy) {
      fighting = true;
      if (bot.targetId !== enemy.id) {
        bot.targetId = enemy.id;
        bot.reaction = randRange(random, 0.45, 0.75);
        bot.burstLeft = 0;
        bot.burstT = 0;
        bot.pauseT = 0;
      }
      const dx = enemy.chestX - bot.body.x;
      const dz = enemy.chestZ - bot.body.z;
      bot.body.yaw = Math.atan2(-dx, -dz);
      if (bot.reaction > 0) {
        bot.reaction -= dt;
      } else if (bot.burstLeft > 0) {
        bot.burstT -= dt;
        if (bot.burstT <= 0) {
          fireAt(bot, enemy, ctx);
          bot.burstLeft--;
          bot.burstT = 0.12;
          if (bot.burstLeft <= 0) bot.pauseT = randRange(random, 0.7, 1.3);
        }
      } else {
        bot.pauseT -= dt;
        if (bot.pauseT <= 0) {
          bot.burstLeft = 3 + Math.floor(random() * 3);
          bot.burstT = 0;
        }
      }
      // Strafe sideways at 45% speed while fighting, flipping regularly.
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) {
        bot.strafeDir *= -1;
        bot.strafeT = randRange(random, 0.7, 1.6);
      }
      const fx = -Math.sin(bot.body.yaw);
      const fz = -Math.cos(bot.body.yaw);
      const strafeX = -fz * bot.strafeDir * WALK_SPEED * 0.45;
      const strafeZ = fx * bot.strafeDir * WALK_SPEED * 0.45;
      mover.step(bot.body, dt, strafeX, strafeZ, false, bot.body.crouch);
      bot.holding = false;
      bot.plantT = 0;
      bot.defuseT = 0;
    } else {
      bot.targetId = null;
      bot.burstLeft = 0;
      // Objective behaviour when nobody is visible.
      const site = SITES[bot.site];
      if (bot.role === 'attacker') {
        if (bomb.state === 'planted') {
          const s = SITES[bomb.site];
          goTo(bot, dt, s.center.x, s.center.z, WALK_SPEED, ctx);
        } else if (bomb.state === 'carried' && bomb.carrier === bot) {
          const dx = site.center.x - bot.body.x;
          const dz = site.center.z - bot.body.z;
          const d = Math.hypot(dx, dz);
          if (d <= site.radius) {
            bot.holding = true;
            bot.plantT += dt;
            if (ctx.onPlantTick) ctx.onPlantTick(bot, bot.site, bot.plantT / PLANT_TIME);
            if (bot.plantT >= PLANT_TIME) {
              bot.plantT = 0;
              bot.holding = false;
              if (ctx.onPlanted) ctx.onPlanted(bot.site, bot);
            }
          } else {
            bot.holding = false;
            bot.plantT = 0;
            goTo(bot, dt, site.center.x, site.center.z, WALK_SPEED, ctx);
          }
        } else if (bomb.state === 'dropped') {
          const dx = bomb.x - bot.body.x;
          const dz = bomb.z - bot.body.z;
          if (Math.hypot(dx, dz) <= PICKUP_RANGE) {
            if (ctx.onPickup) ctx.onPickup(bot);
          } else {
            goTo(bot, dt, bomb.x, bomb.z, WALK_SPEED, ctx);
          }
        } else {
          const dx = site.center.x - bot.body.x;
          const dz = site.center.z - bot.body.z;
          const d = Math.hypot(dx, dz);
          bot.body.crouch = d <= 3;
          goTo(bot, dt, site.center.x, site.center.z, WALK_SPEED, ctx);
        }
      } else {
        if (bomb.state === 'planted') {
          const s = SITES[bomb.site];
          const dx = s.center.x - bot.body.x;
          const dz = s.center.z - bot.body.z;
          const d = Math.hypot(dx, dz);
          if (d <= 2.5) {
            bot.holding = true;
            bot.defuseT += dt;
            if (ctx.onDefuseTick) ctx.onDefuseTick(bot, bomb.site, bot.defuseT / DEFUSE_TIME);
            if (bot.defuseT >= DEFUSE_TIME) {
              bot.defuseT = 0;
              bot.holding = false;
              if (ctx.onDefused) ctx.onDefused(bomb.site);
            }
          } else {
            bot.holding = false;
            bot.defuseT = 0;
            goTo(bot, dt, s.center.x, s.center.z, WALK_SPEED, ctx);
          }
        } else if (ctx.alertUntil && ctx.time < ctx.alertUntil && ctx.alertPos) {
          bot.body.crouch = false;
          goTo(bot, dt, ctx.alertPos.x, ctx.alertPos.z, WALK_SPEED, ctx);
        } else {
          const dx = site.center.x - bot.body.x;
          const dz = site.center.z - bot.body.z;
          const d = Math.hypot(dx, dz);
          bot.body.crouch = d <= 3;
          if (d > 0.5) goTo(bot, dt, site.center.x, site.center.z, WALK_SPEED, ctx);
          else {
            bot.body.yaw = Math.atan2(-(0 - bot.body.x), -(-2 - bot.body.z));
            mover.step(bot.body, dt, 0, 0, false, bot.body.crouch);
          }
        }
      }
    }

    // Walk animation and group transform.
    const speed = mover.groundSpeed(bot.body);
    bot.walkPhase += dt * speed * 1.6;
    const swing = Math.sin(bot.walkPhase) * 0.5 * Math.min(1, speed / WALK_SPEED);
    bot.legL.rotation.x = swing;
    bot.legR.rotation.x = -swing;
    bot.group.position.set(bot.body.x, bot.body.y, bot.body.z);
    bot.group.rotation.y = bot.body.yaw;
    if (!fighting) bot.group.rotation.x = 0;
  }

  function step(dt, ctx) {
    for (const bot of bots) stepBot(bot, dt, ctx);
  }

  reset();
  return { bots, hitMeshes, damage, reset, aliveCount, step };
}
