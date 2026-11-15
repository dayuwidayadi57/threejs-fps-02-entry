// palette.js — the one place that names colours. Every module reads from here;
// nothing else hard-codes a hex value for the game's look.
export const PALETTE = {
  canvas: '#26221d', // dusk sky, fog and page background
  surface: '#2e2a24', // foundry floor and wall faces
  hairline: '#4a443b', // panel borders and trim
  ink: '#ece7dd', // main text
  muted: '#9c948a', // secondary text
  accent: '#f0a830', // Vanguard amber: player team, site A, money
  ember: '#e5484d', // Ember red: enemy team, danger
  teal: '#2bb3a3', // site B
};

/** Scale a #rrggbb colour's channels by f (f < 1 darkens, f > 1 lightens; clamped). */
export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}
