// hud.js — the HUD: score, clock, money, crosshair, health, ammo, killfeed,
// bomb status, hitmarker, buy menu, banners and the end panel. All elements
// are built here; index.html styles them. The HUD never touches game state.
export function createHud(doc) {
  const root = doc.createElement('div');
  root.id = 'hud';
  doc.body.appendChild(root);

  function el(tag, cls, parent) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    (parent || root).appendChild(n);
    return n;
  }

  // Top bar.
  const topBar = el('div', 'hud-top');
  const scoreEl = el('div', 'hud-score', topBar);
  const phaseEl = el('div', 'hud-phase', topBar);
  const timerEl = el('div', 'hud-timer', phaseEl);
  const moneyEl = el('div', 'hud-money', topBar);

  // Bomb status under the clock.
  const bombEl = el('div', 'hud-bomb');

  // Crosshair: four lines and a spread ring.
  const cross = el('div', 'crosshair');
  const ring = el('div', 'cross-ring', cross);
  for (const cls of ['ch-t', 'ch-b', 'ch-l', 'ch-r']) el('div', cls, cross);

  // Health bottom-left, ammo bottom-right.
  const healthWrap = el('div', 'hud-health');
  const healthBar = el('div', 'health-bar', healthWrap);
  const healthFill = el('div', 'health-fill', healthBar);
  const healthNum = el('div', 'health-num', healthWrap);
  const ammoEl = el('div', 'hud-ammo');
  const ammoMag = el('span', 'ammo-mag', ammoEl);
  const ammoRes = el('span', 'ammo-res', ammoEl);
  const ammoGren = el('div', 'ammo-gren', ammoEl);

  // Killfeed, hitmarker, banner.
  const feedEl = el('div', 'killfeed');
  const hitEl = el('div', 'hitmarker');
  hitEl.textContent = '✕';
  const bannerEl = el('div', 'banner');

  // Start overlay.
  const startEl = el('div', 'overlay start-overlay');
  const startTitle = el('h1', 'start-title', startEl);
  startTitle.textContent = 'EMBERLINE';
  const startSub = el('div', 'start-sub', startEl);
  startSub.textContent = 'FOUNDRY YARD — VANGUARD vs EMBER · FIRST TO 5 ROUNDS';
  const startControls = el('div', 'start-controls', startEl);
  startControls.textContent = 'WASD move · SHIFT sprint · SPACE jump · C crouch · CLICK shoot · R reload · G grenade · 1/2/3 weapons · B buy · ESC menu';
  const startBtn = el('button', 'big-btn', startEl);
  startBtn.textContent = 'CLICK TO PLAY';

  // Objective card (shown during the buy phase).
  const objEl = el('div', 'overlay objective-card');
  const objTitle = el('h2', '', objEl);
  objTitle.textContent = 'OBJECTIVE';
  const objText = el('div', 'obj-text', objEl);
  objText.textContent = 'Plant the charge at SITE A or SITE B — or wipe the Ember team. First to 5 rounds takes the yard.';

  // Buy menu.
  const buyEl = el('div', 'overlay buy-menu');
  const buyTitle = el('h2', '', buyEl);
  buyTitle.textContent = 'BUY PHASE';
  const buyMoney = el('div', 'buy-money', buyEl);
  const buyGrid = el('div', 'buy-grid', buyEl);
  const buyFoot = el('div', 'buy-foot', buyEl);
  const deployBtn = el('button', 'big-btn deploy-btn', buyFoot);
  deployBtn.textContent = 'DEPLOY';

  // End panel.
  const endEl = el('div', 'overlay end-panel');
  const endTitle = el('h2', 'end-title', endEl);
  const endScore = el('div', 'end-score', endEl);
  const endStats = el('div', 'end-stats', endEl);
  const endBtn = el('button', 'big-btn', endEl);
  endBtn.textContent = 'NEXT ROUND';

  let hitTimer = 0;
  let bannerTimer = 0;

  function fmtTime(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return String(Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0');
  }

  function setScore(v, e) {
    scoreEl.textContent = 'VANGUARD ' + v + ' — ' + e + ' EMBER';
  }

  function setTimer(sec, phase) {
    timerEl.textContent = fmtTime(sec);
    phaseEl.dataset.phase = phase;
  }

  function setMoney(v) {
    moneyEl.textContent = '$' + v;
    buyMoney.textContent = 'FUNDS: $' + v;
  }

  function setHealth(hp) {
    const h = Math.max(0, Math.round(hp));
    healthNum.textContent = h + ' HP';
    healthFill.style.width = h + '%';
    healthFill.classList.toggle('low', h <= 30);
  }

  function setAmmo(mag, reserve, reloading, grenades) {
    ammoMag.textContent = reloading ? '——' : String(mag);
    ammoRes.textContent = '/ ' + reserve;
    ammoGren.textContent = grenades > 0 ? '◉ ' + grenades + ' grenade' + (grenades > 1 ? 's' : '') : '';
  }

  function setBomb(state, secondsLeft) {
    if (state === 'planted') {
      bombEl.textContent = '◉ CHARGE PLANTED — ' + Math.max(0, secondsLeft).toFixed(1) + 's';
      bombEl.className = 'hud-bomb planted';
    } else if (state === 'planting') {
      // secondsLeft carries the plant progress (0..1) here.
      bombEl.textContent = '◉ PLANTING… ' + Math.round(Math.max(0, Math.min(1, secondsLeft)) * 100) + '%';
      bombEl.className = 'hud-bomb carried';
    } else if (state === 'carried') {
      bombEl.textContent = '◉ CARRYING THE CHARGE';
      bombEl.className = 'hud-bomb carried';
    } else if (state === 'dropped') {
      bombEl.textContent = '◉ CHARGE DROPPED';
      bombEl.className = 'hud-bomb dropped';
    } else {
      bombEl.textContent = '';
      bombEl.className = 'hud-bomb';
    }
  }

  function setCrosshairSpread(px) {
    ring.style.width = px + 'px';
    ring.style.height = px + 'px';
  }

  function showHitmarker(kill, headshot) {
    hitEl.className = 'hitmarker show' + (kill ? ' kill' : '') + (headshot ? ' head' : '');
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => { hitEl.className = 'hitmarker'; }, 120);
  }

  function killfeed(text, team) {
    const line = doc.createElement('div');
    line.className = 'feed-line ' + (team || '');
    line.textContent = text;
    feedEl.appendChild(line);
    while (feedEl.children.length > 5) feedEl.removeChild(feedEl.firstChild);
    setTimeout(() => { if (line.parentNode) line.parentNode.removeChild(line); }, 5000);
  }

  function showBanner(text) {
    bannerEl.textContent = text;
    bannerEl.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), 2500);
  }

  function showBuy(canAfford, owned, weapons, grenades, onBuy, onDeploy) {
    while (buyGrid.firstChild) buyGrid.removeChild(buyGrid.firstChild);
    for (const id of Object.keys(weapons)) {
      const w = weapons[id];
      const card = doc.createElement('button');
      card.className = 'buy-card';
      const isOwned = owned.has(id);
      const afford = canAfford(w.price);
      card.disabled = isOwned || !afford;
      const name = doc.createElement('div');
      name.className = 'buy-name';
      name.textContent = w.name + (isOwned ? ' — OWNED' : '');
      const desc = doc.createElement('div');
      desc.className = 'buy-desc';
      desc.textContent = w.mag + ' rounds · ' + w.body + ' dmg · ' + (w.auto ? 'auto' : 'semi-auto');
      const price = doc.createElement('div');
      price.className = 'buy-price';
      price.textContent = isOwned ? 'OWNED' : '$' + w.price;
      card.appendChild(name);
      card.appendChild(desc);
      card.appendChild(price);
      card.addEventListener('click', () => onBuy(id));
      buyGrid.appendChild(card);
    }
    const gcard = doc.createElement('button');
    gcard.className = 'buy-card';
    gcard.disabled = !canAfford(300);
    const gname = doc.createElement('div');
    gname.className = 'buy-name';
    gname.textContent = 'Frag Grenade' + (grenades > 0 ? ' — ' + grenades + ' held' : '');
    const gdesc = doc.createElement('div');
    gdesc.className = 'buy-desc';
    gdesc.textContent = '85 dmg in 6 m · 1.4 s fuse · press G to throw';
    const gprice = doc.createElement('div');
    gprice.className = 'buy-price';
    gprice.textContent = '$300';
    gcard.appendChild(gname);
    gcard.appendChild(gdesc);
    gcard.appendChild(gprice);
    gcard.addEventListener('click', () => onBuy('grenade'));
    buyGrid.appendChild(gcard);
    buyEl.classList.add('show');
    deployBtn.onclick = onDeploy;
  }

  function hideBuy() {
    buyEl.classList.remove('show');
  }

  function showObjectiveCard() {
    objEl.classList.add('show');
  }

  function hideObjectiveCard() {
    objEl.classList.remove('show');
  }

  function showEndPanel(result, score, kills, income, onNext, matchOver) {
    endTitle.textContent = result;
    endScore.textContent = 'VANGUARD ' + score.v + ' — ' + score.e + ' EMBER';
    endStats.textContent = 'Kills ' + kills + ' · Money made $' + income;
    endBtn.textContent = matchOver ? 'PLAY AGAIN' : 'NEXT ROUND';
    endBtn.onclick = onNext;
    endEl.classList.add('show');
  }

  function hideEndPanel() {
    endEl.classList.remove('show');
  }

  function showStart(onStart) {
    startEl.classList.add('show');
    startBtn.onclick = onStart;
  }

  function hideStart() {
    startEl.classList.remove('show');
  }

  return {
    setScore, setTimer, setMoney, setHealth, setAmmo, setBomb, setCrosshairSpread,
    showHitmarker, killfeed, showBuy, hideBuy, showBanner,
    showObjectiveCard, hideObjectiveCard, showEndPanel, hideEndPanel,
    showStart, hideStart, root,
  };
}
