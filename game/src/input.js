// input.js — keyboard, mouse look and pointer lock. Edge presses are consumed
// once (wasPressed), so a held key never re-triggers a one-shot action.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const state = { locked: false, firing: false, lookX: 0, lookY: 0, menuOpen: false };

  function requestLock() {
    try {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
    } catch (e) { /* pointer lock is a best effort */ }
  }

  function releaseLock() {
    try {
      if (document.pointerLockElement) document.exitPointerLock();
    } catch (e) { /* ignore */ }
  }

  function takeLook() {
    const out = { x: state.lookX, y: state.lookY };
    state.lookX = 0;
    state.lookY = 0;
    return out;
  }

  function wasPressed(code) {
    if (pressed.has(code)) {
      pressed.delete(code);
      return true;
    }
    return false;
  }

  function drainPressed() {
    pressed.clear();
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0 && state.locked) state.firing = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    state.lookX += e.movementX || 0;
    state.lookY += e.movementY || 0;
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });
  window.addEventListener('blur', () => {
    // A lost window must never leave a key or the trigger stuck down.
    keys.clear();
    pressed.clear();
    state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) state.firing = false;
    if (onLockChange) onLockChange(state.locked);
  });

  return { keys, pressed, state, requestLock, releaseLock, takeLook, wasPressed, drainPressed };
}
