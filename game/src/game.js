// game.js — Emberline: Foundry Yard. Owns the renderer, the round state machine
// (menu → buy → live → roundEnd → buy/matchEnd), the player, the bomb, and
// the bots' context. Shot modes (?shot=start|play|bomb|end&seed=N) drive the
// game to a fixed scene with a seeded RNG so screenshots are reproducible.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createAudio } from './audio.js';
import { createMover, WALK_SPEED } from './physics.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { createWeaponView, WEAPONS, GRENADE_PRICE, GRENADE_DAMAGE, GRENADE_RADIUS } from './weapons.js';
import { createInput } from './input.js';
import { createCombat } from './combat.js';
import { createBots } from './bots.js';
import { createEconomy } from './economy.js';
import { createHud } from './hud.js';
import { createRng } from './rng.js';

const STEP = 1 / 60;
const BUY_TIME = 25;
const ROUND_TIME = 110;
const BOMB_TIME = 40;
const PLANT_TIME = 3;
const PICKUP_RANGE = 2.6;
const WIN_ROUNDS = 5;
const END_DELAY = 6;

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#0b1026');
  grad.addColorStop(0.55, '#2a1e33');
  grad.addColorStop(0.72, '#b0622a');
  grad.addColorStop(1, '#1a1611');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 512);
  return new THREE.CanvasTexture(c);
}

export function createGame(canvas, opts) {
  const shotMode = opts && opts.shot ? opts.shot : null;
  const rng = createRng(opts && opts.seed !== undefined ? opts.seed : (Math.random() * 1e9) | 0);
  const random = () => rng.random();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0x1a1611, 30, 90);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0x8a7a5a, 0x1a1611, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb060, 2.0);
  sun.position.set(18, 24, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 28;
  sun.shadow.camera.bottom = -28;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const siteLightA = new THREE.PointLight(PALETTE.accent, 12, 12, 2);
  siteLightA.position.set(-16, 3, -9);
  scene.add(siteLightA);
  const siteLightB = new THREE.PointLight(PALETTE.teal, 12, 12, 2);
  siteLightB.position.set(16, 3, -9);
  scene.add(siteLightB);

  const world = createWorld(scene);
  const mover = createMover(world.colliders);
  const combat = createCombat(scene, world.shootables);
  const bots = createBots(scene, world, mover, combat);
  const economy = createEconomy();
  const hud = createHud(document);
  const audio = createAudio();
  const weapon = createWeaponView(camera);

  // The player's own hit meshes: invisible to the eye (zero opacity) but
  // raycastable, so bots can hit the player. Kept out of the world mesh list.
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const playerTorso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.82, 0.34), hitMat);
  const playerHead = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), hitMat);
  playerTorso.userData.isPlayer = true;
  playerTorso.userData.part = 'torso';
  playerHead.userData.isPlayer = true;
  playerHead.userData.part = 'head';
  scene.add(playerTorso, playerHead);
  const playerHitMeshes = [playerTorso, playerHead];

  // The charge, shown on the ground when dropped or planted.
  const chargeGroup = new THREE.Group();
  const chargeBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.2, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.5, metalness: 0.6 }));
  chargeBox.position.y = 0.1;
  const chargeLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff3020, emissiveIntensity: 2 }));
  chargeLight.position.y = 0.24;
  chargeGroup.add(chargeBox, chargeLight);
  chargeGroup.visible = false;
  scene.add(chargeGroup);

  const allTargets = world.shootables.concat(bots.hitMeshes, playerHitMeshes);

  const player = {
    body: mover.createBody(SPAWNS.vanguard[1].x, SPAWNS.vanguard[1].z),
    yaw: 0, pitch: 0, hp: 100, alive: true,
    grenades: 0, owned: new Set(['pistol']),
    plantT: 0, plantingSite: null, fireT: 0, prevFiring: false,
  };

  const bomb = { state: 'none', carrier: null, x: 0, z: 0, site: null, timer: 0 };

  const match = {
    phase: 'menu', v: 0, e: 0, round: 1, loseStreak: 0,
    buyT: BUY_TIME, roundT: ROUND_TIME, endT: 0,
    time: 0, stepCount: 0, roundIncomeStart: 0, matchOver: false,
  };

  const alert = { pos: null, until: 0 };

  const vForward = new THREE.Vector3();
  const vRight = new THREE.Vector3();
  const vUp = new THREE.Vector3();
  const vEye = new THREE.Vector3();
  const vDir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  let rafId = 0;
  let lastNow = 0;
  let acc = 0;
  let disposed = false;
  let lastMoney = -1;
  let lastPhaseLabel = '';

  const input = createInput(canvas, (locked) => {
    if (!locked && match.phase === 'live' && !shotMode) {
      hud.showStart(() => {
        hud.hideStart();
        audio.resume();
        input.requestLock();
      });
    }
  });

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function resetPlayerForRound() {
    player.body.x = SPAWNS.vanguard[1].x;
    player.body.z = SPAWNS.vanguard[1].z;
    player.body.y = 0;
    player.body.vx = 0;
    player.body.vz = 0;
    player.body.vy = 0;
    player.body.yaw = 0;
    player.body.crouch = false;
    player.yaw = 0;
    player.pitch = 0;
    player.hp = 100;
    player.alive = true;
    player.plantT = 0;
    player.plantingSite = null;
    player.fireT = 0;
    player.grenades = 0;
    player.owned = new Set(['pistol']);
    weapon.equip('pistol');
    weapon.refill('pistol');
    bomb.state = 'carried';
    bomb.carrier = 'player';
    bomb.x = 0;
    bomb.z = 0;
    bomb.site = null;
    bomb.timer = 0;
    chargeGroup.visible = false;
  }

  function startMatch() {
    economy.reset();
    match.v = 0;
    match.e = 0;
    match.round = 1;
    match.loseStreak = 0;
    match.matchOver = false;
    bots.reset();
    resetPlayerForRound();
    startBuyPhase();
  }

  function showBuyMenu() {
    hud.showBuy(
      (price) => economy.state.money >= price,
      player.owned, WEAPONS, player.grenades,
      (id) => {
        if (id === 'grenade') {
          if (economy.spend(GRENADE_PRICE)) {
            player.grenades++;
            audio.buy();
            showBuyMenu();
          }
          return;
        }
        const def = WEAPONS[id];
        if (!def || player.owned.has(id)) return;
        if (economy.spend(def.price)) {
          player.owned.add(id);
          weapon.equip(id);
          weapon.refill(id);
          audio.buy();
          showBuyMenu();
        }
      },
      () => startRound());
  }

  function startBuyPhase() {
    match.phase = 'buy';
    match.buyT = BUY_TIME;
    match.roundIncomeStart = economy.state.income;
    bots.reset();
    resetPlayerForRound();
    hud.hideEndPanel();
    hud.hideStart();
    hud.showObjectiveCard();
    showBuyMenu();
    input.releaseLock();
    hud.setScore(match.v, match.e);
    hud.setMoney(economy.state.money);
  }

  function startRound() {
    match.phase = 'live';
    match.roundT = ROUND_TIME;
    hud.hideBuy();
    hud.hideObjectiveCard();
    hud.showBanner('ROUND ' + match.round + ' — PLANT THE CHARGE');
    if (!shotMode) input.requestLock();
    if (shotMode === 'bomb') {
      // The bomb shot: the charge is already planted at A, the player holds
      // a vantage over the site.
      player.body.x = -6;
      player.body.z = 2;
      player.yaw = 0.74;
      plantBomb('A', 'player', true);
      bomb.timer = 25;
    }
    if (shotMode === 'end') {
      endRound('vanguard', 'elimination');
    }
  }

  function plantBomb(site, planter, silent) {
    bomb.state = 'planted';
    bomb.site = site;
    bomb.carrier = null;
    bomb.x = SITES[site].center.x;
    bomb.z = SITES[site].center.z;
    bomb.timer = BOMB_TIME;
    chargeGroup.position.set(bomb.x, 0, bomb.z);
    chargeGroup.visible = true;
    if (planter === 'player') {
      economy.addPlant();
      if (!silent) {
        audio.plant();
        hud.showBanner('CHARGE PLANTED AT SITE ' + site);
        hud.killfeed('You planted the charge at SITE ' + site, 'vanguard');
      }
    } else {
      if (!silent) {
        audio.plant();
        hud.showBanner(planter.name + ' PLANTED THE CHARGE');
        hud.killfeed(planter.name + ' planted the charge at SITE ' + site, 'vanguard');
      }
    }
  }

  function dropBomb(x, z) {
    bomb.state = 'dropped';
    bomb.carrier = null;
    bomb.x = x;
    bomb.z = z;
    bomb.site = null;
    chargeGroup.position.set(x, 0, z);
    chargeGroup.visible = true;
  }

  function endRound(winner, reason) {
    if (match.phase !== 'live') return;
    const won = winner === 'vanguard';
    if (won) {
      match.v++;
      match.loseStreak = 0;
    } else {
      match.e++;
      match.loseStreak++;
    }
    const payout = economy.roundEnd(won, match.round, match.loseStreak);
    match.matchOver = match.v >= WIN_ROUNDS || match.e >= WIN_ROUNDS;
    match.phase = match.matchOver ? 'matchEnd' : 'roundEnd';
    match.endT = END_DELAY;
    combat.clearGrenades();
    input.releaseLock();
    audio.round(won);
    const result = match.matchOver
      ? (won ? 'VICTORY — THE YARD IS OURS' : 'DEFEAT — EMBER HOLDS THE YARD')
      : (won ? 'ROUND WON' : 'ROUND LOST');
    hud.showEndPanel(
      result,
      { v: match.v, e: match.e },
      economy.state.kills,
      economy.state.income - match.roundIncomeStart,
      () => advanceAfterRound(),
      match.matchOver);
    hud.showBanner((won ? 'ROUND WON' : 'ROUND LOST') + ' · +$' + payout);
    hud.setScore(match.v, match.e);
  }

  function advanceAfterRound() {
    hud.hideEndPanel();
    if (match.matchOver) {
      startMatch();
      return;
    }
    match.round++;
    startBuyPhase();
  }

  function damagePlayer(amount, attacker, part) {
    if (!player.alive || match.phase !== 'live') return;
    player.hp -= amount;
    audio.hurt();
    if (player.hp <= 0) {
      player.hp = 0;
      player.alive = false;
      player.plantT = 0;
      input.releaseLock();
      hud.showBanner('YOU DIED');
      hud.killfeed(attacker ? attacker.name + ' ▸ You' : 'You were eliminated', attacker ? attacker.team : '');
      if (bomb.state === 'carried' && bomb.carrier === 'player') {
        dropBomb(player.body.x, player.body.z);
        hud.killfeed('The charge was dropped', '');
      }
    }
  }

  function botCtx() {
    return {
      random,
      time: match.time,
      playerPos: { x: player.body.x, y: player.body.y, z: player.body.z },
      playerAlive: player.alive,
      playerSpeed: mover.groundSpeed(player.body),
      // Bots fire at this list; it carries the world meshes too, so a bot's
      // shot is blocked by walls exactly like the player's.
      playerHitMeshes: world.shootables.concat(playerHitMeshes),
      bomb: { state: bomb.state, carrier: bomb.carrier, x: bomb.x, z: bomb.z, site: bomb.site },
      alertPos: alert.pos,
      alertUntil: alert.until,
      damagePlayer,
      onBotShot: (bot) => {
        const dx = bot.body.x - player.body.x;
        const dz = bot.body.z - player.body.z;
        audio.shot('smg', Math.hypot(dx, dz));
      },
      onBotDied: (bot) => {
        hud.killfeed(bot.name + ' was eliminated', bot.team);
        if (bomb.state === 'carried' && bomb.carrier === bot) {
          dropBomb(bot.body.x, bot.body.z);
          hud.killfeed('The charge was dropped', '');
        }
      },
      onPlantTick: () => {},
      onPlanted: (site, bot) => plantBomb(site, bot, false),
      onPickup: (bot) => {
        bomb.state = 'carried';
        bomb.carrier = bot;
        chargeGroup.visible = false;
        hud.killfeed(bot.name + ' picked up the charge', 'vanguard');
      },
      onDefuseTick: () => {},
      onDefused: (site) => {
        bomb.state = 'none';
        bomb.carrier = null;
        chargeGroup.visible = false;
        audio.defuse();
        hud.showBanner('CHARGE DEFUSED');
        endRound('ember', 'defused');
      },
    };
  }

  function grenadeDamageAt(pos) {
    for (const bot of bots.bots) {
      if (!bot.alive || bot.team !== 'ember') continue;
      const dx = bot.body.x - pos.x;
      const dy = (bot.body.y + 1.0) - pos.y;
      const dz = bot.body.z - pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d >= GRENADE_RADIUS) continue;
      const dmg = Math.round(GRENADE_DAMAGE * (1 - d / GRENADE_RADIUS));
      const died = bots.damage(bot, dmg, 'torso', 'player');
      if (died) {
        economy.addKill();
        hud.showHitmarker(true, false);
        hud.killfeed('You ▸ ' + bot.name, 'vanguard');
        audio.kill();
      }
    }
    if (player.alive) {
      const dx = player.body.x - pos.x;
      const dy = (player.body.y + 1.0) - pos.y;
      const dz = player.body.z - pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < GRENADE_RADIUS) {
        damagePlayer(Math.round(GRENADE_DAMAGE * (1 - d / GRENADE_RADIUS)), null, 'grenade');
      }
    }
  }

  function playerShoot() {
    const def = WEAPONS[weapon.state.id];
    const speed = mover.groundSpeed(player.body);
    const spread = weapon.spread(speed);
    camera.getWorldDirection(vDir);
    vRight.crossVectors(vDir, UP).normalize();
    vUp.crossVectors(vRight, vDir);
    vDir.addScaledVector(vRight, (random() * 2 - 1) * spread);
    vDir.addScaledVector(vUp, (random() * 2 - 1) * spread);
    vDir.normalize();
    const eyeH = player.body.crouch ? 1.15 : 1.62;
    vEye.set(player.body.x, player.body.y + eyeH, player.body.z);
    const hit = combat.shoot(vEye, vDir, allTargets, (obj) => {
      if (obj.userData.isPlayer) return true;
      const b = obj.userData.bot;
      return !!b && b.team === 'vanguard';
    });
    audio.shot(def.id, 0);
    if (!hit) return;
    const ud = hit.object.userData;
    if (ud.bot && ud.bot.team === 'ember') {
      const head = ud.part === 'head';
      const died = bots.damage(ud.bot, head ? def.head : def.body, ud.part, 'player');
      hud.showHitmarker(died, head);
      if (died) {
        economy.addKill();
        hud.killfeed('You ▸ ' + ud.bot.name, 'vanguard');
        audio.kill();
      } else {
        audio.hit();
      }
    }
  }

  function stepPlayer(dt) {
    // Look.
    const look = input.takeLook();
    player.yaw -= look.x * 0.0022;
    player.pitch -= look.y * 0.0022;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));

    if (!player.alive) {
      mover.step(player.body, dt, 0, 0, false, false);
      return;
    }

    const keys = input.keys;
    const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const str = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const crouch = keys.has('KeyC');
    const jump = input.wasPressed('Space');
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    let wx = (-sin * fwd + cos * str) * WALK_SPEED;
    let wz = (-cos * fwd - sin * str) * WALK_SPEED;
    const len = Math.hypot(wx, wz);
    if (len > 0.01) {
      const k = (sprint ? 1.35 : 1) / Math.max(1, len / WALK_SPEED);
      wx *= k;
      wz *= k;
    }
    mover.step(player.body, dt, wx, wz, jump, crouch);

    // Camera follows the body.
    const eyeH = crouch ? 1.15 : 1.62;
    camera.position.set(player.body.x, player.body.y + eyeH, player.body.z);
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;

    // The player's hit meshes ride the body (lowered when crouched).
    const hScale = crouch ? 0.65 : 1;
    playerTorso.position.set(player.body.x, player.body.y + 1.0 * hScale, player.body.z);
    playerHead.position.set(player.body.x, player.body.y + 1.53 * hScale, player.body.z);

    // Weapons.
    if (input.wasPressed('KeyR')) {
      if (weapon.reload()) audio.reload();
    }
    if (input.wasPressed('Digit1') && player.owned.has('pistol')) { weapon.equip('pistol'); audio.click(); }
    if (input.wasPressed('Digit2') && player.owned.has('smg')) { weapon.equip('smg'); audio.click(); }
    if (input.wasPressed('Digit3') && player.owned.has('rifle')) { weapon.equip('rifle'); audio.click(); }
    if (input.wasPressed('KeyG') && player.grenades > 0) {
      player.grenades--;
      camera.getWorldDirection(vForward);
      vDir.copy(vForward).multiplyScalar(14);
      vDir.y += 2;
      vEye.set(player.body.x, player.body.y + eyeH, player.body.z);
      combat.throwGrenade(vEye, vDir);
      audio.click();
    }

    // Firing: auto weapons fire while held, semi-autos once per click.
    const def = WEAPONS[weapon.state.id];
    const firing = input.state.firing;
    const edge = firing && !player.prevFiring;
    player.prevFiring = firing;
    player.fireT += dt;
    if (firing && player.fireT >= def.gap) {
      if (!weapon.ready()) {
        if (weapon.state.mag === 0 && weapon.state.reserve > 0) weapon.reload();
      } else if (def.auto || edge) {
        if (weapon.pullTrigger()) {
          player.fireT = 0;
          playerShoot();
        }
      }
    }
    weapon.step(dt);

    // Planting: hold E, standing still, inside a site, while carrying — and
    // only once the round is live. The timer accumulates across fixed steps;
    // letting go or stepping out resets it.
    let site = null;
    if (match.phase === 'live' && bomb.state === 'carried' && bomb.carrier === 'player') {
      for (const siteId of ['A', 'B']) {
        const s = SITES[siteId];
        const dx = player.body.x - s.center.x;
        const dz = player.body.z - s.center.z;
        if (Math.hypot(dx, dz) <= s.radius && keys.has('KeyE') && mover.groundSpeed(player.body) < 0.5) {
          site = siteId;
          break;
        }
      }
    }
    if (site) {
      player.plantingSite = site;
      player.plantT += dt;
      hud.setBomb('planting', player.plantT / PLANT_TIME);
      if (player.plantT >= PLANT_TIME) {
        plantBomb(site, 'player', false);
        player.plantT = 0;
        player.plantingSite = null;
      }
    } else {
      player.plantT = 0;
      player.plantingSite = null;
    }

    // Pick up a dropped charge.
    if (bomb.state === 'dropped') {
      const dx = player.body.x - bomb.x;
      const dz = player.body.z - bomb.z;
      if (Math.hypot(dx, dz) <= PICKUP_RANGE) {
        bomb.state = 'carried';
        bomb.carrier = 'player';
        chargeGroup.visible = false;
        hud.killfeed('You picked up the charge', 'vanguard');
      }
    }
  }

  function stepFixed(dt) {
    match.time += dt;
    match.stepCount++;

    if (match.phase === 'buy') {
      match.buyT -= dt;
      stepPlayer(dt);
      if (match.buyT <= 0) startRound();
      return;
    }

    if (match.phase === 'live') {
      match.roundT -= dt;
      stepPlayer(dt);
      bots.step(dt, botCtx());
      combat.stepGrenades(dt, (pos) => grenadeDamageAt(pos), (pos) => {
        const dx = pos.x - player.body.x;
        const dz = pos.z - player.body.z;
        audio.explode(Math.hypot(dx, dz));
        alert.pos = { x: pos.x, z: pos.z };
        alert.until = match.time + 2.5;
      });
      if (bomb.state === 'planted') {
        bomb.timer -= dt;
        chargeLight.material.emissiveIntensity = 2 + Math.sin(match.time * 8) * 1.5;
        if (bomb.timer <= 0) {
          chargeGroup.visible = false;
          audio.explode(0);
          hud.showBanner('CHARGE DETONATED');
          endRound('vanguard', 'detonation');
          return;
        }
      }
      if (match.roundT <= 0) {
        endRound('ember', 'time');
        return;
      }
      if (bots.aliveCount('ember') === 0) {
        endRound('vanguard', 'elimination');
        return;
      }
      if (!player.alive && bots.aliveCount('vanguard') === 0) {
        endRound('ember', 'elimination');
        return;
      }
      return;
    }

    if (match.phase === 'roundEnd' || match.phase === 'matchEnd') {
      match.endT -= dt;
      if (match.endT <= 0) advanceAfterRound();
    }
  }

  function frame(now) {
    if (disposed) return;
    rafId = requestAnimationFrame(frame);
    if (!lastNow) lastNow = now;
    let dt = (now - lastNow) / 1000;
    lastNow = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      stepFixed(STEP);
      acc -= STEP;
      n++;
    }
    if (n === 5) acc = 0;

    // Menu camera: a slow orbit over the yard.
    if (match.phase === 'menu') {
      const a = match.time * 0.08;
      camera.position.set(Math.sin(a) * 18, 8, Math.cos(a) * 18);
      camera.lookAt(0, 1, 0);
    }

    combat.stepFx(dt);

    // HUD, every frame.
    if (economy.state.money !== lastMoney) {
      hud.setMoney(economy.state.money);
      lastMoney = economy.state.money;
    }
    hud.setHealth(player.hp);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.state.reloading, player.grenades);
    const phaseLabel = match.phase === 'buy' ? 'BUY' : match.phase === 'live' ? (bomb.state === 'planted' ? 'PLANTED' : 'LIVE') : match.phase === 'menu' ? 'MENU' : 'END';
    if (phaseLabel !== lastPhaseLabel) lastPhaseLabel = phaseLabel;
    const t = match.phase === 'buy' ? match.buyT : match.phase === 'live' ? match.roundT : match.phase === 'menu' ? 0 : match.endT;
    hud.setTimer(t, phaseLabel);
    hud.setScore(match.v, match.e);
    if (match.phase === 'live') {
      if (bomb.state === 'planted') hud.setBomb('planted', bomb.timer);
      else if (bomb.state === 'carried' && bomb.carrier === 'player' && !player.plantingSite) hud.setBomb('carried', 0);
      else if (bomb.state === 'dropped') hud.setBomb('dropped', 0);
      const speed = mover.groundSpeed(player.body);
      hud.setCrosshairSpread(12 + weapon.spread(speed) * 500);
    }

    input.drainPressed();
    renderer.render(scene, camera);
  }

  function start() {
    if (shotMode) {
      hud.hideStart();
      startMatch();
      if (shotMode === 'play' || shotMode === 'bomb' || shotMode === 'end') {
        startRound();
      }
    } else {
      hud.showStart(() => {
        hud.hideStart();
        audio.resume();
        // No pointer lock here: startMatch lands in the buy phase, which
        // releases the lock — requesting it first races the release and the
        // lock can engage after it, trapping the mouse on the canvas while
        // the buy menu needs clicks. The lock is requested by startRound.
        startMatch();
      });
    }
    lastNow = 0;
    rafId = requestAnimationFrame(frame);
  }

  function getState() {
    return {
      phase: match.phase,
      stepCount: match.stepCount,
      round: match.round,
      vanguardWins: match.v,
      emberWins: match.e,
      bombState: bomb.state,
      playerHp: player.hp,
      time: match.time,
    };
  }

  function dispose() {
    disposed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resize);
    renderer.dispose();
  }

  return { start, getState, dispose, _debug: { match, player, bomb, economy, bots, weapon } };
}
