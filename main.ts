// main.ts — the entry program + the dev harness. Node 24, stdlib only.
//   node main.ts                        # submission: copies game/ + screenshots/
//                                       # to $MAKEFUN_OUTPUT_DIR (or /output)
//                                       # and writes dossier.json — what the
//                                       # grader runs (no browser, no network)
//   node main.ts --shot all            # dev: all four shots + determinism diff
//   node main.ts --shot play           # dev: one shot
//   node main.ts --playtest            # dev: interactive play-test, no shots
//   node main.ts --shot all --playtest # dev: everything
// Chrome (dev harness only): set CHROME_PATH, or put Chrome for Testing at
// ~/workspace/makefun/.chrome-for-testing/chrome-linux64/chrome
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(ROOT, 'shots');
const SERVER_PORT = 8901;
const CDP_PORT = 9222;

const SHOT_STEPS = { start: 30, play: 480, bomb: 120, end: 120 };
const SHOTS = ['start', 'play', 'bomb', 'end'];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { shot: null, playtest: false, seed: 1 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--shot') out.shot = args[++i];
    else if (args[i] === '--playtest') out.playtest = true;
    else if (args[i] === '--seed') out.seed = Number(args[++i]) || 1;
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const home = process.env.HOME || '';
  return join(home, 'workspace', 'makefun', '.chrome-for-testing', 'chrome-linux64', 'chrome');
}

async function waitForServer(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.id !== undefined && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      } else if (data.method) {
        this.events.push(data);
      }
    };
  }

  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('CDP websocket failed to open'));
    });
  }

  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 60000);
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    if (res.exceptionDetails) {
      throw new Error('page exception: ' + JSON.stringify(res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    }
    return res.result.value;
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }

  errors() {
    const out = [];
    for (const e of this.events) {
      if (e.method === 'Runtime.exceptionThrown') {
        out.push('exception: ' + (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text));
      } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
        out.push('log: ' + e.params.entry.text + ' ' + (e.params.entry.url || ''));
      } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
        out.push('console.error: ' + JSON.stringify(e.params.args.map((a) => a.value ?? a.description)));
      } else if (e.method === 'Network.loadingFailed') {
        out.push('network failed: ' + (e.params.errorText || ''));
      } else if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) {
        out.push('http ' + e.params.response.status + ': ' + e.params.response.url);
      }
    }
    return out;
  }
}

async function launchChrome(url) {
  const chrome = spawn(chromePath(), [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1280,720',
    '--hide-scrollbars',
    '--mute-audio',
    '--enable-unsafe-swiftshader',
    '--user-data-dir=' + join(ROOT, '.chrome-profile'),
    'about:blank',
  ], { stdio: 'ignore' });
  const deadline = Date.now() + 30000;
  let wsUrl = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) {
        const j = await res.json();
        wsUrl = j.webSocketDebuggerUrl;
        break;
      }
    } catch { /* not up yet */ }
    await sleep(250);
  }
  if (!wsUrl) {
    chrome.kill('SIGKILL');
    throw new Error('Chrome DevTools did not come up on port ' + CDP_PORT);
  }
  const cdp = new Cdp(wsUrl);
  await cdp.open();
  // Find the page target (about:blank) and attach to it; the browser-level
  // connection is only needed to list targets, so close it right away.
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  cdp.close();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target found');
  const pageCdp = new Cdp(page.webSocketDebuggerUrl);
  await pageCdp.open();
  await pageCdp.send('Page.enable');
  await pageCdp.send('Runtime.enable');
  await pageCdp.send('Log.enable');
  await pageCdp.send('Network.enable');
  await pageCdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await pageCdp.send('Page.navigate', { url });
  return { chrome, cdp: pageCdp };
}

async function waitForGame(cdp, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate('!!window.__game')) return true;
    } catch { /* page still loading */ }
    await sleep(250);
  }
  return false;
}

async function waitForSteps(cdp, target, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Fail fast on a page exception: a throw in start() means the loop never
    // runs and the step count never moves — waiting the full timeout hides it.
    const errs = cdp.errors();
    if (errs.length) throw new Error('page errors while waiting for steps: ' + errs.join(' | '));
    const s = await cdp.evaluate('window.__game ? window.__game.getState().stepCount : 0');
    if (s >= target) return s;
    await sleep(200);
  }
  throw new Error('game did not reach ' + target + ' steps in time');
}

async function snapshot(cdp) {
  return cdp.evaluate(`(() => {
    const g = window.__game;
    const d = g._debug;
    return JSON.stringify({
      state: g.getState(),
      bots: d.bots.bots.map((b) => [b.body.x.toFixed(3), b.body.z.toFixed(3), b.health, b.alive, b.body.yaw.toFixed(3)]),
      player: [d.player.body.x.toFixed(3), d.player.body.z.toFixed(3), d.player.hp, d.player.alive],
      money: d.economy.state.money,
      weapon: [d.weapon.state.id, d.weapon.state.mag, d.weapon.state.reserve],
    });
  })()`);
}

async function captureShot(cdp, name) {
  for (const quality of [80, 60, 40]) {
    const res = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality });
    const buf = Buffer.from(res.data, 'base64');
    if (buf.length <= 256 * 1024 || quality === 40) {
      const path = join(SHOTS_DIR, name + '.jpg');
      writeFileSync(path, buf);
      console.log(`shot ${name}: ${buf.length} bytes (quality ${quality}) -> ${path}`);
      return buf.length;
    }
  }
}

async function runShot(shot, seed) {
  const url = `http://127.0.0.1:${SERVER_PORT}/?shot=${shot}&seed=${seed}`;
  console.log(`\n=== shot ${shot} (${url}) ===`);
  const { chrome, cdp } = await launchChrome(url);
  try {
    if (!await waitForGame(cdp)) throw new Error('game did not boot');
    const steps = await waitForSteps(cdp, SHOT_STEPS[shot]);
    const state = await cdp.evaluate('window.__game.getState()');
    console.log(`reached ${steps} steps: phase=${state.phase} round=${state.round} score=${state.vanguardWins}-${state.emberWins} bomb=${state.bombState} hp=${state.playerHp}`);
    await captureShot(cdp, shot);
    const snap = await snapshot(cdp);
    writeFileSync(join(SHOTS_DIR, shot + '.json'), snap);
    const errs = cdp.errors();
    if (errs.length) {
      console.log('PAGE ERRORS during ' + shot + ':');
      for (const e of errs) console.log('  ' + e);
    } else {
      console.log('no page errors during ' + shot);
    }
    return { state, snap, errs };
  } finally {
    cdp.close();
    chrome.kill('SIGKILL');
    await sleep(500);
  }
}

async function runDeterminism(seed) {
  console.log('\n=== determinism diff: play, seed ' + seed + ', twice ===');
  const a = await runShot('play', seed);
  const b = await runShot('play', seed);
  // The second run overwrote shots/play.jpg; keep both snapshots for the diff.
  const same = a.snap === b.snap;
  console.log(same
    ? 'DETERMINISM: identical state after 480 steps in both runs'
    : 'DETERMINISM: STATES DIFFER\nrun A: ' + a.snap + '\nrun B: ' + b.snap);
  return same;
}

async function runPlaytest(seed) {
  const url = `http://127.0.0.1:${SERVER_PORT}/?seed=${seed}`;
  console.log(`\n=== interactive play-test (${url}) ===`);
  const { chrome, cdp } = await launchChrome(url);
  const notes = [];
  try {
    if (!await waitForGame(cdp)) throw new Error('game did not boot');
    const clickAt = async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };
    const key = async (type, code, k, vk) => {
      await cdp.send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: vk });
    };
    const rectOf = async (selector) => cdp.evaluate(`(() => {
      const n = document.querySelector('${selector}');
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 };
    })()`);

    // 1. Start overlay -> click PLAY.
    let state = await cdp.evaluate('window.__game.getState()');
    notes.push('boot phase: ' + state.phase);
    const startBtn = await rectOf('.start-overlay .big-btn');
    if (!startBtn || !startBtn.visible) throw new Error('start button not visible');
    await clickAt(startBtn.x, startBtn.y);
    await sleep(500);
    state = await cdp.evaluate('window.__game.getState()');
    notes.push('after PLAY click: phase=' + state.phase);
    if (state.phase !== 'buy') throw new Error('expected buy phase after PLAY, got ' + state.phase);

    // 2. Buy menu visible; buy the SMG if affordable (it is not at $800 — verify the button is disabled).
    const smgDisabled = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('.buy-card')];
      const smg = cards.find((c) => c.textContent.includes('Hornet'));
      return smg ? smg.disabled : null;
    })()`);
    notes.push('Hornet card disabled at $800 (expected true): ' + smgDisabled);

    // 3. Deploy.
    const deployBtn = await rectOf('.deploy-btn');
    if (!deployBtn || !deployBtn.visible) throw new Error('deploy button not visible');
    await clickAt(deployBtn.x, deployBtn.y);
    await sleep(500);
    state = await cdp.evaluate('window.__game.getState()');
    notes.push('after DEPLOY click: phase=' + state.phase);
    if (state.phase !== 'live') throw new Error('expected live phase after DEPLOY, got ' + state.phase);

    // 4. Walk forward for 1.5 s and confirm the player moved.
    const before = await cdp.evaluate('JSON.stringify([window.__game._debug.player.body.x, window.__game._debug.player.body.z])');
    await key('keyDown', 'KeyW', 'w', 87);
    await sleep(1500);
    await key('keyUp', 'KeyW', 'w', 87);
    const after = await cdp.evaluate('JSON.stringify([window.__game._debug.player.body.x, window.__game._debug.player.body.z])');
    notes.push('walk W 1.5s: ' + before + ' -> ' + after);
    const [bx, bz] = JSON.parse(before);
    const [ax, az] = JSON.parse(after);
    if (Math.hypot(ax - bx, az - bz) < 1) throw new Error('player did not move when holding W');

    // 5. Shoot: pointer lock in headless may or may not engage; report what happened.
    const magBefore = await cdp.evaluate('window.__game._debug.weapon.state.mag');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
    await sleep(300);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
    const magAfter = await cdp.evaluate('window.__game._debug.weapon.state.mag');
    const locked = await cdp.evaluate('!!document.pointerLockElement');
    notes.push(`shoot: pointerLock=${locked} mag ${magBefore} -> ${magAfter}`);

    // 6. Reload key.
    await key('keyDown', 'KeyR', 'r', 82);
    await key('keyUp', 'KeyR', 'r', 82);
    await sleep(200);
    const reloading = await cdp.evaluate('window.__game._debug.weapon.state.reloading');
    notes.push('R reload started (mag was full, so expected false): ' + reloading);

    // 7. Let the bots fight for ~10 s, then screenshot.
    await waitForSteps(cdp, (await cdp.evaluate('window.__game.getState().stepCount')) + 600, 60000);
    state = await cdp.evaluate('window.__game.getState()');
    notes.push(`after ~10s live: phase=${state.phase} score=${state.vanguardWins}-${state.emberWins} hp=${state.playerHp} bomb=${state.bombState}`);
    await captureShot(cdp, 'playtest');
    const errs = cdp.errors();
    notes.push(errs.length ? 'PAGE ERRORS: ' + errs.join(' | ') : 'no page errors');
    console.log(notes.map((n) => '  - ' + n).join('\n'));
    return { notes, errs };
  } finally {
    cdp.close();
    chrome.kill('SIGKILL');
    await sleep(500);
  }
}

// Submission program: what the grader runs as plain `node main.ts` (no
// flags). Copies game/ and screenshots/ beside this file into the output
// directory and writes dossier.json with the vendored make.fun library.
// Pure file I/O — no browser, no server, no network — so it runs in the
// grader's bare container. The caps are the scorer's own limits: a dossier
// text of at most 160 KiB, at most 4 screenshots of at most 256 KiB, game/
// at most 993 files and 48 MiB.
function runSubmission() {
  const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(out, { recursive: true });
  cpSync(join(ROOT, 'game'), join(out, 'game'), { recursive: true });
  mkdirSync(join(out, 'screenshots'), { recursive: true });
  if (existsSync(join(ROOT, 'screenshots'))) {
    cpSync(join(ROOT, 'screenshots'), join(out, 'screenshots'), { recursive: true });
  }
  const dossier = buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  });
  writeFileSync(join(out, 'dossier.json'), dossier);
  console.log('wrote ' + join(out, 'dossier.json') + ' (' + dossier.length + ' bytes)');
}

async function main() {
  const args = parseArgs();
  // No --shot and no --playtest: the submission program. It needs no
  // browser or server, so it runs before either is started.
  if (!args.shot && !args.playtest) {
    try {
      runSubmission();
    } catch (e) {
      console.error('SUBMIT FAILED: ' + (e && e.stack || e));
      process.exit(1);
    }
    process.exit(0);
  }
  mkdirSync(SHOTS_DIR, { recursive: true });
  const chrome = chromePath();
  try {
    const { accessSync, constants } = await import('node:fs');
    accessSync(chrome, constants.X_OK);
  } catch {
    console.error('Chrome not found at ' + chrome);
    console.error('Download Chrome for Testing (linux64) from https://googlechromelabs.github.io/chrome-for-testing/ and unpack it under ~/workspace/makefun/.chrome-for-testing/');
    process.exit(1);
  }

  const server = spawn(process.execPath, ['serve.ts', '--port', String(SERVER_PORT)], { cwd: ROOT, stdio: 'ignore' });
  if (!await waitForServer(SERVER_PORT)) {
    console.error('static server did not come up');
    server.kill('SIGKILL');
    process.exit(1);
  }
  console.log('server up on http://127.0.0.1:' + SERVER_PORT);

  let ok = true;
  try {
    if (args.shot === 'all') {
      for (const shot of SHOTS) {
        const r = await runShot(shot, args.seed);
        if (r.errs.length) ok = false;
      }
      if (!await runDeterminism(args.seed)) ok = false;
    } else if (args.shot && args.shot !== 'none') {
      const r = await runShot(args.shot, args.seed);
      if (r.errs.length) ok = false;
    }
    if (args.playtest) {
      const r = await runPlaytest(args.seed);
      if (r.errs.length) ok = false;
    }
  } catch (e) {
    console.error('HARNESS FAILED: ' + (e && e.stack || e));
    ok = false;
  } finally {
    server.kill('SIGKILL');
  }
  console.log(ok ? '\nHARNESS OK' : '\nHARNESS HAD FAILURES');
  process.exit(ok ? 0 : 1);
}

main();
