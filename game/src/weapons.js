// weapons.js — the weapon table, the grenade, and the first-person view model.
// Stopping to aim pays: spread grows with movement speed, and every shot kicks.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: { id: 'pistol', name: 'Kestrel', kind: 'pistol', price: 0, mag: 12, reserve: 48, gap: 0.16, reload: 1.4, body: 26, head: 52, spreadStill: 0.003, spreadMove: 0.02, auto: false, barrel: 0.55 },
  smg: { id: 'smg', name: 'Hornet', kind: 'smg', price: 1500, mag: 25, reserve: 100, gap: 0.075, reload: 1.7, body: 22, head: 44, spreadStill: 0.006, spreadMove: 0.034, auto: true, barrel: 0.8 },
  rifle: { id: 'rifle', name: 'Longbow', kind: 'rifle', price: 2700, mag: 30, reserve: 90, gap: 0.096, reload: 1.9, body: 34, head: 100, spreadStill: 0.0022, spreadMove: 0.028, auto: true, barrel: 1.0 },
};

export const GRENADE_PRICE = 300;
export const GRENADE_DAMAGE = 85;
export const GRENADE_RADIUS = 6;

export function createWeaponView(camera) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.5, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.6, metalness: 0.4 });
  const amber = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.4, metalness: 0.3, emissive: PALETTE.accent, emissiveIntensity: 0.35 });

  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.42), metal);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.22), dark);
  stock.position.set(0, -0.01, 0.28);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.55), dark);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.1), amber);
  sight.position.set(0, 0.1, -0.05);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), dark);
  grip.position.set(0, -0.13, 0.12);
  grip.rotation.x = 0.35;
  model.add(receiver, stock, barrel, sight, grip);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  flash.position.set(0.3, -0.34, -0.85);
  const flashLight = new THREE.PointLight(0xffc860, 0, 6);
  flashLight.position.set(0.3, -0.32, -0.7);
  camera.add(model, flash, flashLight);

  const ammo = {};
  const state = {
    id: 'pistol', mag: 12, reserve: 48, grenades: 0,
    reloading: false, reloadT: 0, reloadDur: 0, kick: 0, flashT: 0,
  };

  function applyDef(def) {
    barrel.scale.z = def.barrel / 0.55;
    barrel.position.z = -0.21 - def.barrel / 2 + 0.275;
    sight.visible = def.id === 'rifle';
    model.position.set(0.3, -0.38, -0.6);
    model.rotation.set(-0.05, 0.3, 0);
    model.scale.setScalar(0.5);
  }

  function equip(id) {
    const def = WEAPONS[id];
    if (!def) return false;
    if (!ammo[id]) ammo[id] = { mag: def.mag, reserve: def.reserve };
    state.id = id;
    state.mag = ammo[id].mag;
    state.reserve = ammo[id].reserve;
    state.reloading = false;
    state.reloadT = 0;
    applyDef(def);
    return true;
  }

  function ready() {
    return !state.reloading && state.mag > 0;
  }

  function takeRound() {
    if (state.mag <= 0) return false;
    state.mag -= 1;
    ammo[state.id].mag = state.mag;
    return true;
  }

  function pullTrigger() {
    if (!ready()) return false;
    if (!takeRound()) return false;
    state.kick = Math.min(1, state.kick + 0.12);
    state.flashT = 0.06;
    flash.material.opacity = 0.7;
    flash.rotation.z = Math.random() * 10;
    flashLight.intensity = 14;
    return true;
  }

  function reload() {
    const def = WEAPONS[state.id];
    if (state.reloading || state.mag >= def.mag || state.reserve <= 0) return false;
    state.reloading = true;
    state.reloadT = 0;
    state.reloadDur = def.reload;
    return true;
  }

  function spread(speed) {
    const def = WEAPONS[state.id];
    // Stopping to aim pays: spread is smallest standing still.
    return def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove;
  }

  // A fresh purchase (or a fresh round's issue) tops the weapon right up.
  function refill(id) {
    const def = WEAPONS[id || state.id];
    if (!def) return;
    ammo[def.id] = { mag: def.mag, reserve: def.reserve };
    if (def.id === state.id) {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.reloading = false;
    }
  }

  function step(dt) {
    if (state.reloading) {
      state.reloadT += dt;
      if (state.reloadT >= state.reloadDur) {
        const def = WEAPONS[state.id];
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
        ammo[state.id].mag = state.mag;
        ammo[state.id].reserve = state.reserve;
        state.reloading = false;
      }
    }
    state.kick *= Math.exp(-8 * dt);
    if (state.flashT > 0) {
      state.flashT -= dt;
      if (state.flashT <= 0) {
        flash.material.opacity = 0;
        flashLight.intensity = 0;
      }
    }
    const reloadTilt = state.reloading ? -0.55 * Math.sin(Math.PI * Math.min(1, state.reloadT / state.reloadDur)) : 0;
    model.position.set(0.3, -0.38 + state.kick * 0.03, -0.6 + state.kick * 0.05);
    model.rotation.x = -0.05 + state.kick * 2.2 + reloadTilt;
    model.rotation.y = 0.3;
  }

  applyDef(WEAPONS.pistol);
  return { state, step, equip, ready, pullTrigger, takeRound, reload, spread, refill };
}
