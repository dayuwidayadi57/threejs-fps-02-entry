// rng.js — a seeded RNG (mulberry32) so shot modes are reproducible: the
// same seed drives the same bot decisions, spread and aim error, and the
// same game after the same number of fixed steps.
export function createRng(seed) {
  let s = (seed >>> 0) || 1;

  function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  }

  function random() {
    return next() / 4294967296;
  }

  // An integer in [min, max).
  function int(min, max) {
    return min + Math.floor(random() * (max - min));
  }

  function pick(arr) {
    return arr[Math.floor(random() * arr.length)];
  }

  return { random, int, pick, next };
}
