// physics.js — the shared mover for the player and the bots: one set of rules,
// axis-separated AABB collision against the world's boxes. A body that starts
// a step already overlapping a collider has that step rejected on the axis,
// which is why no spawn or waypoint may sit inside a collider's probe zone.
export const RADIUS = 0.34;
export const HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.12;
export const EYE = 1.6;
export const CROUCH_EYE = 1.02;
export const WALK_SPEED = 5.2;
export const CROUCH_SPEED = 2.4;
export const ACCEL_GROUND = 42;
export const ACCEL_AIR = 9;
export const FRICTION = 9;
export const GRAVITY = 20;
export const JUMP_SPEED = 6.2;

export function createMover(colliders) {
  const boxes = colliders || [];

  function overlapsBox(x, z, y, height) {
    for (let i = 0; i < boxes.length; i++) {
      const c = boxes[i];
      if (x + RADIUS > c.min.x && x - RADIUS < c.max.x &&
          z + RADIUS > c.min.z && z - RADIUS < c.max.z &&
          y + height > c.min.y && y < c.max.y) return true;
    }
    return false;
  }

  /** True when the body's box overlaps any collider (spawn/waypoint sanity). */
  function overlaps(body) {
    const h = body.crouch ? CROUCH_HEIGHT : HEIGHT;
    return overlapsBox(body.x, body.z, body.y, h);
  }

  // A body that starts a step already overlapping a collider keeps failing
  // every horizontal probe, so it can never move again: spawns and waypoints
  // must stay clear of collider edges by more than the body radius.

  function createBody(x, z) {
    return {
      x, z, y: 0, vx: 0, vz: 0, vy: 0,
      yaw: 0, pitch: 0, crouch: false, onGround: true,
    };
  }

  function groundSpeed(body) {
    return Math.hypot(body.vx, body.vz);
  }

  // wishX/wishZ are the desired horizontal velocity (m/s) in world space.
  // jump is an edge trigger; crouch holds the low stance.
  function step(body, dt, wishX, wishZ, jump, crouch) {
    body.crouch = !!crouch;
    const height = body.crouch ? CROUCH_HEIGHT : HEIGHT;
    const accel = body.onGround ? ACCEL_GROUND : ACCEL_AIR;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0.001) {
      const kx = wishX / wishLen;
      const kz = wishZ / wishLen;
      const speed = Math.min(wishLen, body.crouch ? CROUCH_SPEED : WALK_SPEED);
      const tx = kx * speed;
      const tz = kz * speed;
      const dvx = tx - body.vx;
      const dvz = tz - body.vz;
      const dv = Math.hypot(dvx, dvz);
      const step = accel * dt;
      if (dv <= step) { body.vx = tx; body.vz = tz; }
      else { body.vx += (dvx / dv) * step; body.vz += (dvz / dv) * step; }
    } else if (body.onGround) {
      const sp = Math.hypot(body.vx, body.vz);
      const dec = FRICTION * dt;
      if (sp <= dec) { body.vx = 0; body.vz = 0; }
      else { body.vx -= (body.vx / sp) * dec; body.vz -= (body.vz / sp) * dec; }
    }

    if (jump && body.onGround) {
      body.vy = JUMP_SPEED;
      body.onGround = false;
    }
    body.vy -= GRAVITY * dt;

    // X axis, then Z axis: a step into a collider is rejected on that axis.
    const nx = body.x + body.vx * dt;
    if (!overlapsBox(nx, body.z, body.y, height)) body.x = nx;
    else body.vx = 0;
    const nz = body.z + body.vz * dt;
    if (!overlapsBox(body.x, nz, body.y, height)) body.z = nz;
    else body.vz = 0;

    // Vertical: the ground is y = 0; a ceiling stops upward motion.
    let ny = body.y + body.vy * dt;
    if (ny <= 0) {
      ny = 0;
      body.vy = 0;
      body.onGround = true;
    } else if (body.vy > 0) {
      for (let i = 0; i < boxes.length; i++) {
        const c = boxes[i];
        if (body.x + RADIUS > c.min.x && body.x - RADIUS < c.max.x &&
            body.z + RADIUS > c.min.z && body.z - RADIUS < c.max.z &&
            body.y + height <= c.min.y && ny + height > c.min.y) {
          ny = c.min.y - height;
          body.vy = 0;
          break;
        }
      }
      body.onGround = false;
    } else {
      body.onGround = false;
    }
    body.y = ny;
  }

  return { createBody, step, groundSpeed, overlaps };
}
