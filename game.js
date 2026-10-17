/* ============================================================================
   Graphite Blocks — a retro hand-drawn paper Tetris
   Pure front-end, no dependencies. See TASK.md for the design spec.
   ========================================================================== */
(function () {
  'use strict';

  /* ==========================================================================
     1. Small utilities
     ========================================================================== */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16)
    };
  }
  function rgba(hex, a) {
    const c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }
  // amt > 0 lightens toward white, amt < 0 darkens toward black
  function shade(hex, amt) {
    const c = hexToRgb(hex);
    const t = amt < 0 ? 0 : 255;
    const p = Math.abs(amt);
    const m = (v) => Math.round(v + (t - v) * p);
    return 'rgb(' + m(c.r) + ',' + m(c.g) + ',' + m(c.b) + ')';
  }
  function withAlpha(rgbStr, a) {
    const m = rgbStr.match(/\d+/g);
    if (!m) return rgbStr;
    return 'rgba(' + m[0] + ',' + m[1] + ',' + m[2] + ',' + a + ')';
  }

  /* ==========================================================================
     2. Piece data & SRS rotation
     ========================================================================== */

  const COLS = 10;
  const ROWS_TOTAL = 22;   // 20 visible + 2 hidden spawn rows
  const HIDDEN = 2;
  const VIS = ROWS_TOTAL - HIDDEN;

  const COLORS = {
    I: '#7fb0ab', O: '#dcc87e', T: '#a48fb0',
    S: '#93b07c', Z: '#c97a6e', J: '#7f98b8', L: '#d49a68'
  };
  const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  const BASE = {
    I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    O: [[1,1],[1,1]],
    T: [[0,1,0],[1,1,1],[0,0,0]],
    S: [[0,1,1],[1,1,0],[0,0,0]],
    Z: [[1,1,0],[0,1,1],[0,0,0]],
    J: [[1,0,0],[1,1,1],[0,0,0]],
    L: [[0,0,1],[1,1,1],[0,0,0]]
  };

  function rotateCW(m) {
    const n = m.length;
    const out = [];
    for (let y = 0; y < n; y++) {
      out.push([]);
      for (let x = 0; x < n; x++) out[y][x] = m[n - 1 - x][y];
    }
    return out;
  }

  // Precompute 4 rotation states for each piece.
  const MATRICES = {};
  TYPES.forEach(function (t) {
    const states = [BASE[t]];
    for (let r = 1; r < 4; r++) states.push(rotateCW(states[r - 1]));
    MATRICES[t] = states;
  });

  // SRS wall-kick tables in SCREEN coordinates (y increases downward).
  const KICKS_JLSTZ = {
    '0>1': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    '1>0': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
    '1>2': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
    '2>1': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    '2>3': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
    '3>2': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    '3>0': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    '0>3': [[0,0],[1,0],[1,-1],[0,2],[1,2]]
  };
  const KICKS_I = {
    '0>1': [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
    '1>0': [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
    '1>2': [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
    '2>1': [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
    '2>3': [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
    '3>2': [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
    '3>0': [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
    '0>3': [[0,0],[-1,0],[2,0],[-1,-2],[2,1]]
  };
  // Simple 180° kicks.
  const KICKS_180 = [[0,0],[0,-1],[0,1],[1,0],[-1,0],[2,0],[-2,0]];

  /* ==========================================================================
     3. Game state
     ========================================================================== */

  const G = {
    board: null,
    active: null,
    bank: null,        // hold
    canHold: true,
    queue: [],
    bag: [],
    state: 'start',    // start | playing | clearing | paused | over
    score: 0,
    displayScore: 0,
    best: 0,
    level: 1,
    lines: 0,
    combo: -1,
    b2b: false,
    lastWasRotation: false,
    lastKickIndex: 0,
    das: { dir: 0, timer: 0, arr: 0 },
    softDrop: { active: false, timer: 0 },
    lockTimer: 0,
    lockResets: 0,
    gravityAcc: 0,
    clearStart: 0,
    clearRows: [],
    clearDuration: 280,
    overReveal: 0,
    time: 0
  };

  const SETTINGS = {
    sound: true,
    music: true,
    grain: 'FULL'
  };

  /* ==========================================================================
     4. DOM references
     ========================================================================== */

  const el = {
    sheet: document.getElementById('sheet'),
    boardCanvas: document.getElementById('board-canvas'),
    holdCanvas: document.getElementById('hold-canvas'),
    nextCanvas: document.getElementById('next-canvas'),
    holdBox: document.getElementById('hold-box'),
    nextBox: document.getElementById('next-box'),
    score: document.getElementById('score-value'),
    best: document.getElementById('best-value'),
    level: document.getElementById('level-value'),
    lines: document.getElementById('lines-value'),
    grainLabel: document.getElementById('grain-label'),
    popupLayer: document.getElementById('popup-layer'),
    cardStart: document.getElementById('card-start'),
    cardPause: document.getElementById('card-pause'),
    cardOver: document.getElementById('card-over'),
    overScore: document.getElementById('over-score'),
    overBest: document.getElementById('over-best'),
    newBest: document.getElementById('new-best'),
    playAgain: document.getElementById('play-again'),
    grainLayer: document.getElementById('grain-layer'),
    grainNoise: document.getElementById('grain-noise'),
    grainScratch: document.getElementById('grain-scratch')
  };

  const boardCtx = el.boardCanvas.getContext('2d');
  const holdCtx = el.holdCanvas.getContext('2d');
  const nextCtx = el.nextCanvas.getContext('2d');

  let CELL = 26;       // logical cell size in px
  let DPR = 1;

  // Mirrors the portrait / narrow-screen media query in style.css.
  function isMobileLayout() {
    return window.matchMedia('(max-width: 699px), (orientation: portrait)').matches;
  }

  /* ==========================================================================
     5. Seeded pencil-block tile generation
     ========================================================================== */

  const tileCache = {};   // type -> { canvas, size }
  let tileSize = 0;

  function seedFromString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function buildTile(type, size) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    const base = COLORS[type];
    const rnd = mulberry32(seedFromString(type) + 7);

    // base fill = the color itself
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);

    // colored-pencil look: visible diagonal hatch in a darker and a lighter tint
    const dark = shade(base, -0.34);
    const light = shade(base, 0.30);
    const lw = Math.max(0.8, size * 0.05);
    g.lineCap = 'round';

    const strokes = Math.max(16, Math.floor(size * 2.0));
    for (let i = 0; i < strokes; i++) {
      const useDark = rnd() < 0.55;
      g.strokeStyle = withAlpha(useDark ? dark : light, 0.35);
      g.lineWidth = lw * (0.6 + rnd() * 0.9);
      const x = rnd() * size;
      const y = rnd() * size;
      const len = size * (0.30 + rnd() * 0.55);
      const ang = Math.PI * 0.25 + (rnd() - 0.5) * 0.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      g.stroke();
    }

    // a few cross strokes so the hatching reads as layered pencil color
    const cross = Math.max(4, Math.floor(strokes * 0.22));
    for (let i = 0; i < cross; i++) {
      const useDark = rnd() < 0.5;
      g.strokeStyle = withAlpha(useDark ? dark : light, 0.30);
      g.lineWidth = lw * (0.5 + rnd() * 0.7);
      const x = rnd() * size;
      const y = rnd() * size;
      const len = size * (0.25 + rnd() * 0.45);
      const ang = -Math.PI * 0.25 + (rnd() - 0.5) * 0.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      g.stroke();
    }

    // subtle speckles for crayon texture
    for (let i = 0; i < Math.floor(size * 0.6); i++) {
      g.fillStyle = withAlpha(rnd() < 0.5 ? dark : light, 0.18);
      const r = Math.max(0.5, size * 0.02);
      g.fillRect(rnd() * size, rnd() * size, r, r);
    }

    // outline ~1.5px (desktop) / cell*0.06 (mobile, min 1px) of the color darkened 40%
    const outlineLogical = isMobileLayout() ? Math.max(1, CELL * 0.06) : 1.5;
    g.strokeStyle = shade(base, -0.4);
    g.lineWidth = Math.max(1, outlineLogical * DPR);
    g.lineJoin = 'round';
    const m = g.lineWidth / 2;
    g.strokeRect(m, m, size - g.lineWidth, size - g.lineWidth);

    return c;
  }

  function getTile(type) {
    return tileCache[type];
  }

  function rebuildTiles() {
    const size = Math.max(10, Math.round((CELL - 2) * DPR));
    tileSize = size;
    TYPES.forEach(function (t) { tileCache[t] = buildTile(t, size); });
  }

  /* ==========================================================================
     6. Board helpers
     ========================================================================== */

  function emptyBoard() {
    const b = [];
    for (let y = 0; y < ROWS_TOTAL; y++) {
      b.push(new Array(COLS).fill(null));
    }
    return b;
  }

  function matrixOf(type, rot) { return MATRICES[type][((rot % 4) + 4) % 4]; }

  function collides(type, rot, px, py) {
    const m = matrixOf(type, rot);
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        const bx = px + x;
        const by = py + y;
        if (bx < 0 || bx >= COLS || by >= ROWS_TOTAL) return true;
        if (by >= 0 && G.board[by][bx]) return true;
      }
    }
    return false;
  }

  function spawnYFor(type) {
    // place the piece so its top filled row lands on the first visible row
    const m = MATRICES[type][0];
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (m[y][x]) return HIDDEN - y;
      }
    }
    return HIDDEN;
  }

  function spawnXFor(type) {
    const m = MATRICES[type][0];
    let minX = 999, maxX = -1;
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (m[y][x]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      }
    }
    const width = maxX - minX + 1;
    return Math.floor((COLS - width) / 2) - minX;
  }

  /* ==========================================================================
     7. Bag & piece spawning
     ========================================================================== */

  function refillBag() {
    const bag = TYPES.slice();
    const rnd = mulberry32((Math.random() * 1e9) >>> 0);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
    }
    G.bag = bag;
  }

  function nextFromBag() {
    if (G.bag.length === 0) refillBag();
    return G.bag.pop();
  }

  function fillQueue() {
    while (G.queue.length < 5) G.queue.push(nextFromBag());
  }

  function makePiece(type) {
    return {
      type: type,
      rot: 0,
      x: spawnXFor(type),
      y: spawnYFor(type),
      visX: 0,
      visY: 0,
      justDropped: false
    };
  }

  function spawnNext() {
    fillQueue();
    const type = G.queue.shift();
    fillQueue();
    const p = makePiece(type);
    p.visX = p.x;
    p.visY = p.y;
    G.active = p;
    G.lockTimer = 0;
    G.lockResets = 0;
    G.gravityAcc = 0;
    G.lastWasRotation = false;
    if (collides(p.type, p.rot, p.x, p.y)) {
      gameOver();
    }
  }

  /* ==========================================================================
     8. Movement, rotation, locking
     ========================================================================== */

  function tryMove(dx, dy, byPlayer) {
    const p = G.active;
    if (!p) return false;
    if (!collides(p.type, p.rot, p.x + dx, p.y + dy)) {
      p.x += dx;
      p.y += dy;
      if (byPlayer) resetLock();
      return true;
    }
    return false;
  }

  function resetLock() {
    if (G.lockTimer > 0 && G.lockResets < 15) {
      G.lockTimer = 0;
      G.lockResets++;
    }
  }

  function tryRotate(dir) {
    // dir: 1 = CW, -1 = CCW, 2 = 180
    const p = G.active;
    if (!p) return;
    const from = p.rot;
    let to;
    let table;
    if (dir === 2) {
      to = (from + 2) % 4;
      table = KICKS_180;
    } else {
      to = ((from + dir) % 4 + 4) % 4;
      table = p.type === 'I' ? KICKS_I : KICKS_JLSTZ;
    }
    let kicks;
    if (dir === 2) {
      kicks = KICKS_180;
    } else {
      kicks = table[from + '>' + to] || [[0, 0]];
    }
    // O never needs to rotate, but it is harmless.
    for (let i = 0; i < kicks.length; i++) {
      const k = kicks[i];
      if (!collides(p.type, to, p.x + k[0], p.y + k[1])) {
        p.rot = to;
        p.x += k[0];
        p.y += k[1];
        G.lastWasRotation = true;
        G.lastKickIndex = i;
        resetLock();
        sfx.rotate();
        return;
      }
    }
  }

  function ghostY() {
    const p = G.active;
    if (!p) return 0;
    let gy = p.y;
    while (!collides(p.type, p.rot, p.x, gy + 1)) gy++;
    return gy;
  }

  function hardDrop() {
    const p = G.active;
    if (!p) return;
    const startY = p.y;
    const gy = ghostY();
    const dist = gy - p.y;
    if (dist > 0) {
      p.y = gy;
      G.score += dist * 2;
    }
    // pencil-speed trail
    addDropTrail(p, startY, gy);
    shake(6, 150);
    sfx.hardDrop();
    lockPiece(true);
  }

  function lockPiece(wasHard) {
    const p = G.active;
    if (!p) return;
    const m = matrixOf(p.type, p.rot);
    let minY = ROWS_TOTAL;
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        const by = p.y + y;
        const bx = p.x + x;
        if (by >= 0 && by < ROWS_TOTAL && bx >= 0 && bx < COLS) {
          G.board[by][bx] = p.type;
          if (by < minY) minY = by;
        }
      }
    }
    if (!wasHard) {
      shake(2.5, 110);
      sfx.lock();
    }
    squash(p.type, p.rot, p.x, p.y);
    addLandingDust(p, minY);

    const tspin = detectTSpin();
    const full = findFullRows();
    G.active = null;

    if (full.length > 0) {
      G.pendingTSpin = tspin;
      G.clearRows = full;
      G.clearStart = G.time;
      G.state = 'clearing';
      sfx.lineClear(full.length);
    } else {
      if (tspin) {
        G.score += 400 * G.level;
        popup('T-SPIN', 'popup-ts');
      }
      G.combo = -1;
      G.b2b = false;
      G.canHold = true;
      spawnNext();
    }
  }

  function findFullRows() {
    const rows = [];
    for (let y = 0; y < ROWS_TOTAL; y++) {
      let full = true;
      for (let x = 0; x < COLS; x++) {
        if (!G.board[y][x]) { full = false; break; }
      }
      if (full) rows.push(y);
    }
    return rows;
  }

  function finalizeClear() {
    const rows = G.clearRows;
    const n = rows.length;
    const tspin = G.pendingTSpin;
    const level = G.level;

    // remove the cleared rows, then add empty rows on top
    const rowSet = {};
    rows.forEach(function (r) { rowSet[r] = true; });
    const kept = [];
    for (let y = 0; y < G.board.length; y++) {
      if (!rowSet[y]) kept.push(G.board[y]);
    }
    for (let i = 0; i < n; i++) kept.unshift(new Array(COLS).fill(null));
    G.board = kept;

    // scoring
    let base = 0;
    let label = '';
    if (tspin) {
      if (n === 0) { base = 400; label = 'T-SPIN'; }
      else if (n === 1) { base = 800; label = 'T-SPIN SINGLE'; }
      else if (n === 2) { base = 1200; label = 'T-SPIN DOUBLE'; }
      else { base = 1600; label = 'T-SPIN TRIPLE'; }
    } else {
      if (n === 1) { base = 100; label = 'SINGLE'; }
      else if (n === 2) { base = 300; label = 'DOUBLE'; }
      else if (n === 3) { base = 500; label = 'TRIPLE'; }
      else if (n === 4) { base = 800; label = 'TETRIS!'; }
    }

    const isDifficult = (n === 4) || (tspin && n > 0);
    let gained = base * level;
    if (isDifficult && G.b2b) {
      gained = Math.floor(gained * 1.5);
      popup('BACK-TO-BACK', 'popup-b2b');
    }
    G.b2b = isDifficult;

    G.combo++;
    if (G.combo > 0) {
      gained += 50 * G.combo * level;
      popup('COMBO x' + (G.combo + 1), 'popup-combo');
    }

    G.score += gained;
    if (label) popup(label, 'popup-main');

    // lines and level
    G.lines += n;
    const newLevel = Math.floor(G.lines / 10) + 1;
    if (newLevel > G.level) {
      G.level = newLevel;
      levelUpPulse();
      sfx.levelUp();
    }

    // eraser crumbs
    rows.forEach(function (r) { addEraserCrumbs(r); });

    G.canHold = true;
    G.clearRows = [];
    G.pendingTSpin = false;
    G.state = 'playing';
    spawnNext();
  }

  // 3-corner T-spin detection
  function detectTSpin() {
    const p = G.active;
    if (!p || p.type !== 'T' || !G.lastWasRotation) return false;
    const cx = p.x + 1;   // centre of the 3x3 box
    const cy = p.y + 1;
    const corners = [
      [cx - 1, cy - 1], // 0 top-left
      [cx + 1, cy - 1], // 1 top-right
      [cx - 1, cy + 1], // 2 bottom-left
      [cx + 1, cy + 1]  // 3 bottom-right
    ];
    const filled = corners.map(function (c) {
      const x = c[0], y = c[1];
      if (x < 0 || x >= COLS || y >= ROWS_TOTAL) return true;
      if (y < 0) return false;
      return !!G.board[y][x];
    });
    const total = filled.filter(Boolean).length;
    if (total < 3) return false;
    // front corners depend on rotation
    let front, back;
    if (p.rot === 0) { front = [0, 1]; back = [2, 3]; }
    else if (p.rot === 1) { front = [1, 3]; back = [0, 2]; }
    else if (p.rot === 2) { front = [2, 3]; back = [0, 1]; }
    else { front = [0, 2]; back = [1, 3]; }
    const frontFilled = filled[front[0]] && filled[front[1]];
    // full kick (5th offset) upgrades a mini to a full T-spin
    if (frontFilled || G.lastKickIndex === 4) return true;
    // otherwise it's a mini — treat as minor but still count (return 'mini')
    return true; // we award standard bonus for simplicity
  }

  /* ==========================================================================
     9. Hold
     ========================================================================== */

  function holdPiece() {
    const p = G.active;
    if (!p || !G.canHold) return;
    if (G.bank == null) {
      G.bank = p.type;
      G.active = null;
      sfx.hold();
      spawnNext();
    } else {
      const t = G.bank;
      G.bank = p.type;
      const np = makePiece(t);
      np.visX = np.x; np.visY = np.y;
      G.active = np;
      G.lockTimer = 0; G.lockResets = 0; G.gravityAcc = 0;
      if (collides(np.type, np.rot, np.x, np.y)) gameOver();
      sfx.hold();
    }
    G.canHold = false;
    drawHold();
  }

  /* ==========================================================================
     10. Visual effects
     ========================================================================== */

  const particles = [];
  const dropTrails = [];
  const lockPulses = [];

  function addLandingDust(p, minY) {
    const m = matrixOf(p.type, p.rot);
    for (let x = 0; x < m.length; x++) {
      // bottom-most filled cell in this column
      let bottom = -1;
      for (let y = 0; y < m.length; y++) if (m[y][x]) bottom = y;
      if (bottom < 0) continue;
      const bx = (p.x + x + 0.5) * CELL;
      const by = (p.y + bottom + 1 - HIDDEN) * CELL;
      for (let i = 0; i < 3; i++) {
        particles.push({
          x: bx, y: by,
          vx: (Math.random() - 0.5) * 0.6,
          vy: -Math.random() * 0.5,
          life: 380, maxLife: 380,
          size: 1 + Math.random() * 1.6,
          kind: 'dust'
        });
      }
    }
  }

  function addEraserCrumbs(row) {
    const y = (row - HIDDEN + 0.5) * CELL;
    for (let i = 0; i < 10; i++) {
      particles.push({
        x: Math.random() * COLS * CELL,
        y: y,
        vx: (Math.random() - 0.5) * 0.25,
        vy: -Math.random() * 0.35,
        life: 520, maxLife: 520,
        size: 1 + Math.random() * 2,
        kind: 'crumb'
      });
    }
  }

  function addDropTrail(p, fromY, toY) {
    const m = matrixOf(p.type, p.rot);
    const cells = [];
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (m[y][x]) cells.push([p.x + x, y]);
      }
    }
    dropTrails.push({
      cells: cells,
      x: p.x,
      fromY: fromY,
      toY: toY,
      start: G.time,
      dur: 260
    });
  }

  function squash(type, rot, x, y) {
    // a short bright pulse over the freshly locked cells
    const m = matrixOf(type, rot);
    for (let yy = 0; yy < m.length; yy++) {
      for (let xx = 0; xx < m[yy].length; xx++) {
        if (m[yy][xx]) {
          lockPulses.push({ gx: x + xx, gy: y + yy - HIDDEN, t: G.time });
        }
      }
    }
    while (lockPulses.length > 40) lockPulses.shift();
  }

  function popup(text, cls) {
    const d = document.createElement('div');
    d.className = 'popup ' + (cls || '');
    d.textContent = text;
    d.style.left = (45 + Math.random() * 10) + '%';
    d.style.top = (38 + Math.random() * 8) + '%';
    el.popupLayer.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1150);
  }

  function levelUpPulse() {
    el.level.classList.remove('scribble');
    void el.level.offsetWidth;
    el.level.classList.add('scribble');
  }

  let shakeMag = 0;
  let shakeUntil = 0;
  function shake(mag, dur) {
    shakeMag = Math.max(shakeMag, mag);
    shakeUntil = Math.max(shakeUntil, performance.now() + dur);
  }

  /* ==========================================================================
     11. Rendering — board
     ========================================================================== */

  let borderPath = null;

  function buildBorderPath() {
    const rng = mulberry32(1337);
    const w = COLS * CELL;
    const h = VIS * CELL;
    const step = Math.max(5, CELL * 0.55);
    const pts = [];
    function edge(x1, y1, x2, y2) {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const n = Math.max(1, Math.round(len / step));
      const nx = -(y2 - y1) / len;
      const ny = (x2 - x1) / len;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const j = (rng() * 2 - 1) * 1.4;
        pts.push([lerp(x1, x2, t) + nx * j, lerp(y1, y2, t) + ny * j]);
      }
    }
    edge(0, 0, w, 0);
    edge(w, 0, w, h);
    edge(w, h, 0, h);
    edge(0, h, 0, 0);
    borderPath = { pts: pts, w: w, h: h };
  }

  function drawBoard() {
    const w = COLS * CELL;
    const h = VIS * CELL;
    boardCtx.save();
    boardCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    boardCtx.clearRect(0, 0, w, h);

    // field paper
    boardCtx.fillStyle = '#ddd6c0';
    boardCtx.fillRect(0, 0, w, h);

    // pencil grid
    boardCtx.strokeStyle = 'rgba(70,62,48,0.35)';
    boardCtx.lineWidth = 1;
    boardCtx.beginPath();
    for (let x = 1; x < COLS; x++) {
      boardCtx.moveTo(x * CELL + 0.5, 0);
      boardCtx.lineTo(x * CELL + 0.5, h);
    }
    for (let y = 1; y < VIS; y++) {
      boardCtx.moveTo(0, y * CELL + 0.5);
      boardCtx.lineTo(w, y * CELL + 0.5);
    }
    boardCtx.stroke();

    // settled blocks
    for (let y = HIDDEN; y < ROWS_TOTAL; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = G.board[y][x];
        if (!t) continue;
        drawBlockAt(t, x, y - HIDDEN, 1);
      }
    }

    // line-clear eraser animation
    if (G.state === 'clearing') {
      drawClearEffect();
    }

    // drop trails
    drawDropTrails();

    // ghost + active piece
    if (G.active) {
      const p = G.active;
      const gy = ghostY();
      boardCtx.save();
      boardCtx.strokeStyle = 'rgba(110,120,95,.7)';
      boardCtx.lineWidth = 1.4;
      boardCtx.setLineDash([3, 3]);
      const m = matrixOf(p.type, p.rot);
      for (let yy = 0; yy < m.length; yy++) {
        for (let xx = 0; xx < m[yy].length; xx++) {
          if (!m[yy][xx]) continue;
          const cx = (p.visX + xx) * CELL;
          const cy = (gy + yy - HIDDEN) * CELL;
          if (gy + yy - HIDDEN < 0) continue;
          boardCtx.strokeRect(cx + 1.5, cy + 1.5, CELL - 3, CELL - 3);
        }
      }
      boardCtx.setLineDash([]);
      boardCtx.restore();

      // active piece with interpolated visual position
      for (let yy = 0; yy < m.length; yy++) {
        for (let xx = 0; xx < m[yy].length; xx++) {
          if (!m[yy][xx]) continue;
          const fx = p.visX + xx;
          const fy = p.visY + yy - HIDDEN;
          if (fy < -1.5) continue;
          drawBlockAt(p.type, fx, fy, 1, true);
        }
      }
    }

    // particles
    drawParticles();
    drawLockPulses();

    // game over: grey blocks out row by row from bottom to top
    if (G.state === 'over' && G.overStart) {
      const prog = clamp((G.time - G.overStart) / 900, 0, 1);
      const revealed = Math.floor(prog * VIS + 0.0001);
      for (let i = 0; i < revealed; i++) {
        const y = (VIS - 1 - i) * CELL;
        boardCtx.fillStyle = 'rgba(120,114,96,0.72)';
        boardCtx.fillRect(0, y, w, CELL);
      }
    }

    // wobbly hand-drawn border (topmost)
    if (borderPath) {
      boardCtx.strokeStyle = '#423b2b';
      boardCtx.lineWidth = 2.5;
      boardCtx.lineJoin = 'round';
      boardCtx.beginPath();
      const pts = borderPath.pts;
      for (let i = 0; i <= pts.length; i++) {
        const pt = pts[i % pts.length];
        if (i === 0) boardCtx.moveTo(pt[0], pt[1]);
        else boardCtx.lineTo(pt[0], pt[1]);
      }
      boardCtx.closePath();
      boardCtx.stroke();
    }

    boardCtx.restore();
  }

  function drawBlockAt(type, gx, gy, alpha, fractional) {
    const tile = getTile(type);
    if (!tile) return;
    const x = fractional ? gx * CELL : gx * CELL;
    const y = gy * CELL;
    boardCtx.globalAlpha = alpha == null ? 1 : alpha;
    boardCtx.drawImage(tile, x + 1, y + 1, CELL - 2, CELL - 2);
    boardCtx.globalAlpha = 1;
  }

  function drawClearEffect() {
    const t = (G.time - G.clearStart) / G.clearDuration;
    const p = clamp(t, 0, 1);
    const w = COLS * CELL;
    G.clearRows.forEach(function (row) {
      const y = (row - HIDDEN) * CELL;
      if (y + CELL < 0 || y > VIS * CELL) return;
      if (p < 0.3) {
        // paper flash
        boardCtx.fillStyle = 'rgba(244,240,222,' + (0.75 * (1 - p / 0.3)) + ')';
        boardCtx.fillRect(0, y, w, CELL);
      } else {
        // eraser smudge sweeping left to right
        const e = (p - 0.3) / 0.7;
        const ew = w * e;
        boardCtx.fillStyle = '#ddd6c0';
        boardCtx.fillRect(0, y, ew, CELL);
        // residue tint at smudge edge
        boardCtx.fillStyle = 'rgba(232,226,205,0.9)';
        boardCtx.fillRect(Math.max(0, ew - CELL * 0.7), y, Math.min(CELL * 0.7, ew), CELL);
        // redraw grid over erased part
        boardCtx.strokeStyle = 'rgba(70,62,48,0.35)';
        boardCtx.lineWidth = 1;
        boardCtx.beginPath();
        for (let x = 1; x < COLS; x++) {
          boardCtx.moveTo(x * CELL + 0.5, y);
          boardCtx.lineTo(x * CELL + 0.5, y + CELL);
        }
        boardCtx.stroke();
      }
    });
  }

  function drawDropTrails() {
    const now = G.time;
    for (let i = dropTrails.length - 1; i >= 0; i--) {
      const tr = dropTrails[i];
      const t = (now - tr.start) / tr.dur;
      if (t >= 1) { dropTrails.splice(i, 1); continue; }
      const a = (1 - t) * 0.35;
      boardCtx.fillStyle = 'rgba(90,82,66,' + a + ')';
      tr.cells.forEach(function (c) {
        const cx = (tr.x + c[0]) * CELL;
        for (let y = tr.fromY; y <= tr.toY; y++) {
          const cy = (y + c[1] - HIDDEN) * CELL;
          if (cy < -CELL) continue;
          boardCtx.fillRect(cx + CELL * 0.35, cy, CELL * 0.3, CELL);
        }
      });
    }
  }

  function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.life -= 16;
      if (pt.life <= 0) { particles.splice(i, 1); continue; }
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vy += 0.02;
      const a = clamp(pt.life / pt.maxLife, 0, 1) * 0.7;
      boardCtx.fillStyle = pt.kind === 'crumb'
        ? 'rgba(120,110,88,' + a + ')'
        : 'rgba(100,94,80,' + a + ')';
      boardCtx.save();
      boardCtx.translate(pt.x, pt.y);
      boardCtx.rotate(pt.x * 0.3);
      boardCtx.fillRect(-pt.size, -pt.size * 0.4, pt.size * 2, pt.size * 0.8);
      boardCtx.restore();
    }
  }

  /* ==========================================================================
     12. Rendering — hold / next previews
     ========================================================================== */

  function drawLockPulses() {
    for (let i = lockPulses.length - 1; i >= 0; i--) {
      const p = lockPulses[i];
      const age = (G.time - p.t) / 160;
      if (age >= 1) { lockPulses.splice(i, 1); continue; }
      if (p.gy < 0 || p.gy >= VIS) continue;
      boardCtx.fillStyle = 'rgba(255,252,238,' + (1 - age) * 0.5 + ')';
      boardCtx.fillRect(p.gx * CELL + 1, p.gy * CELL + 1, CELL - 2, CELL - 2);
    }
  }

  // Cell size that makes a piece fill (most of) an available box.
  function miniCellFor(type, rot, availW, availH, pad) {
    const m = matrixOf(type, rot || 0);
    let minX = 99, maxX = -1, minY = 99, maxY = -1;
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (m[y][x]) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }
    const bw = Math.max(1, maxX - minX + 1);
    const bh = Math.max(1, maxY - minY + 1);
    const p = pad || 0.8;
    return Math.max(2, Math.min((availW * p) / bw, (availH * p) / bh));
  }

  function drawMiniPiece(ctx, type, cx, cy, cell, rot) {
    const m = matrixOf(type, rot || 0);
    // bounds
    let minX = 99, maxX = -1, minY = 99, maxY = -1;
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (m[y][x]) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }
    const w = (maxX - minX + 1) * cell;
    const h = (maxY - minY + 1) * cell;
    const ox = cx - w / 2 - minX * cell;
    const oy = cy - h / 2 - minY * cell;
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        const tile = tileCache[type];
        if (tile) {
          ctx.drawImage(tile, ox + x * cell + 1, oy + y * cell + 1, cell - 2, cell - 2);
        }
      }
    }
  }

  function boxDims(canvas, boxEl) {
    const box = boxEl || canvas.parentElement;
    let w = box ? box.clientWidth : 0;
    let h = box ? box.clientHeight : 0;
    if (!w) w = canvas.clientWidth || canvas.width;
    if (!h) h = canvas.clientHeight || canvas.height;
    return { w: w, h: h };
  }

  // Size the backing store from the CSS box (not the canvas attr) x devicePixelRatio.
  function fitCanvas(canvas, ctx, boxEl) {
    const box = boxDims(canvas, boxEl);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const bw = Math.max(1, Math.round(box.w * dpr));
    const bh = Math.max(1, Math.round(box.h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, bw, bh);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: box.w, h: box.h };
  }

  function drawHold() {
    const size = fitCanvas(el.holdCanvas, holdCtx, el.holdBox);
    holdCtx.clearRect(0, 0, size.w, size.h);
    if (G.bank) {
      const cell = isMobileLayout()
        ? miniCellFor(G.bank, 0, size.w, size.h, 0.72)
        : Math.min(CELL * 0.8, miniCellFor(G.bank, 0, size.w, size.h, 0.9));
      drawMiniPiece(holdCtx, G.bank, size.w / 2, size.h / 2, cell, 0);
    }
  }

  function drawNext() {
    const size = fitCanvas(el.nextCanvas, nextCtx, el.nextBox);
    nextCtx.clearRect(0, 0, size.w, size.h);
    if (!G.queue || !G.queue.length) return;
    // On the narrow mobile top bar the box is tiny: show just the next piece.
    if (isMobileLayout()) {
      const t = G.queue[0];
      if (!t) return;
      const cell = miniCellFor(t, 0, size.w, size.h, 0.78);
      drawMiniPiece(nextCtx, t, size.w / 2, size.h / 2, cell, 0);
      return;
    }
    if (G.state === 'start') return;
    const count = 3;
    const slotH = size.h / count;
    for (let i = 0; i < count; i++) {
      const t = G.queue[i];
      if (!t) continue;
      const big = i === 0;
      const cell = big
        ? Math.min(miniCellFor(t, 0, size.w, slotH, 0.9), CELL * 0.8)
        : Math.min(miniCellFor(t, 0, size.w, slotH, 0.9), CELL * 0.6);
      drawMiniPiece(nextCtx, t, size.w / 2, slotH * i + slotH / 2, cell, 0);
    }
  }

  /* ==========================================================================
     13. Resize / layout
     ========================================================================== */

  function layout() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);

    // Determine available space inside #playfield for the board.
    const pf = document.getElementById('playfield');
    const availW = pf.clientWidth;
    const availH = pf.clientHeight;
    let cell = Math.min(availW / COLS, availH / VIS);
    cell = clamp(Math.floor(cell), 14, 34);
    CELL = cell;

    const w = COLS * CELL;
    const h = VIS * CELL;
    el.boardCanvas.style.width = w + 'px';
    el.boardCanvas.style.height = h + 'px';
    el.boardCanvas.width = Math.round(w * DPR);
    el.boardCanvas.height = Math.round(h * DPR);

    boardCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    rebuildTiles();
    buildBorderPath();
    drawHold();
    drawNext();
  }

  /* ==========================================================================
     14. HUD updates
     ========================================================================== */

  function updateHUD() {
    el.score.textContent = Math.round(G.displayScore);
    el.best.textContent = 'BEST ' + G.best;
    el.level.textContent = String(G.level).padStart(2, '0');
    el.lines.textContent = String(G.lines);
  }

  /* ==========================================================================
     15. Settings & persistence
     ========================================================================== */

  const LS_BEST = 'graphiteBlocksBest';
  const LS_SET = 'graphiteBlocksSettings';

  function loadSettings() {
    try {
      const best = localStorage.getItem(LS_BEST);
      if (best != null) G.best = parseInt(best, 10) || 0;
      const s = localStorage.getItem(LS_SET);
      if (s) {
        const o = JSON.parse(s);
        if (typeof o.sound === 'boolean') SETTINGS.sound = o.sound;
        if (typeof o.music === 'boolean') SETTINGS.music = o.music;
        if (o.grain) SETTINGS.grain = o.grain;
      }
    } catch (e) { /* ignore */ }
    applySettings();
  }

  function saveSettings() {
    try { localStorage.setItem(LS_SET, JSON.stringify(SETTINGS)); } catch (e) {}
  }
  function saveBest() {
    try { localStorage.setItem(LS_BEST, String(G.best)); } catch (e) {}
  }

  function applySettings() {
    document.querySelectorAll('.check').forEach(function (b) {
      const key = b.getAttribute('data-setting');
      let on;
      if (key === 'grain') on = SETTINGS.grain !== 'OFF';
      else on = SETTINGS[key];
      b.classList.toggle('off', !on);
    });
    el.grainLabel.textContent = SETTINGS.grain;
    el.grainLayer.className = 'grain-' + SETTINGS.grain.toLowerCase()
      + (SETTINGS.grain === 'LIGHT' ? ' grain-light' : '');
    if (SETTINGS.grain === 'OFF') el.grainLayer.classList.add('grain-off');
  }

  function toggleSetting(key) {
    if (key === 'grain') {
      SETTINGS.grain = SETTINGS.grain === 'FULL' ? 'LIGHT'
        : SETTINGS.grain === 'LIGHT' ? 'OFF' : 'FULL';
    } else {
      SETTINGS[key] = !SETTINGS[key];
    }
    if (key === 'music') {
      if (SETTINGS.music) { startMusic(); } else { stopMusic(); }
    }
    applySettings();
    saveSettings();
  }

  /* ==========================================================================
     16. Audio (WebAudio, fully generated)
     ========================================================================== */

  let AC = null;
  let masterGain = null;

  function ensureAudio() {
    if (AC) {
      if (AC.state === 'suspended') AC.resume();
      return;
    }
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = AC.createGain();
      masterGain.gain.value = 0.5;
      masterGain.connect(AC.destination);
      if (SETTINGS.music) startMusic();
    } catch (e) { AC = null; }
  }

  function now() { return AC ? AC.currentTime : 0; }

  function tone(opts) {
    if (!AC || !SETTINGS.sound) return;
    const t0 = opts.time != null ? opts.time : now() + (opts.delay || 0);
    const dur = opts.dur || 0.12;
    const osc = AC.createOscillator();
    const gain = AC.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq || 440, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + dur);
    const vol = (opts.vol == null ? 0.2 : opts.vol);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    if (opts.filter) {
      const f = AC.createBiquadFilter();
      f.type = opts.filter;
      f.frequency.value = opts.cutoff || 1200;
      node.connect(f);
      f.connect(gain);
    } else {
      node.connect(gain);
    }
    gain.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    return osc;
  }

  function noiseBurst(opts) {
    if (!AC || !SETTINGS.sound) return;
    const t0 = opts.time != null ? opts.time : now() + (opts.delay || 0);
    const dur = opts.dur || 0.05;
    const len = Math.max(1, Math.floor(AC.sampleRate * dur));
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = AC.createBufferSource();
    src.buffer = buf;
    const f = AC.createBiquadFilter();
    f.type = opts.filter || 'bandpass';
    f.frequency.value = opts.cutoff || 1800;
    f.Q.value = opts.q || 1;
    const gain = AC.createGain();
    gain.gain.value = opts.vol == null ? 0.12 : opts.vol;
    src.connect(f); f.connect(gain); gain.connect(masterGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const sfx = {
    move: function () { noiseBurst({ cutoff: 2400, dur: 0.03, vol: 0.05 }); },
    rotate: function () { tone({ type: 'square', freq: 660, dur: 0.05, vol: 0.06 }); },
    softTick: function () { noiseBurst({ cutoff: 3200, dur: 0.02, vol: 0.025 }); },
    hardDrop: function () {
      tone({ type: 'sine', freq: 150, to: 55, dur: 0.22, vol: 0.28 });
      noiseBurst({ filter: 'lowpass', cutoff: 600, dur: 0.16, vol: 0.16 });
    },
    lock: function () { noiseBurst({ cutoff: 1400, dur: 0.04, vol: 0.08 }); },
    hold: function () { tone({ type: 'triangle', freq: 300, to: 720, dur: 0.16, vol: 0.1 }); },
    lineClear: function (n) {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      const cnt = clamp(n, 1, 4);
      for (let i = 0; i < cnt + 1; i++) {
        tone({ type: 'triangle', freq: notes[i % notes.length], dur: 0.22,
          vol: 0.14, time: now() + 0.07 + i * 0.06 });
      }
      noiseBurst({ filter: 'highpass', cutoff: 2000, dur: 0.18, vol: 0.06, delay: 0.02 });
    },
    levelUp: function () {
      const seq = [523.25, 659.25, 783.99, 1046.5];
      seq.forEach(function (f, i) {
        tone({ type: 'square', freq: f, dur: 0.16, vol: 0.1, time: now() + i * 0.08 });
      });
    },
    gameOver: function () {
      const seq = [392, 349.23, 311.13, 261.63];
      seq.forEach(function (f, i) {
        tone({ type: 'triangle', freq: f, dur: 0.42, vol: 0.16, time: now() + i * 0.22 });
      });
    }
  };

  /* ---- music: Korobeiniki (Tetris theme A), music-box style ---- */
  const NOTE = {
    A2: 110.00, B2: 123.47, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61,
    G3: 196.00, A3: 220.00, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00
  };
  // [note, beats]
  const MELODY = [
    ['E5',1],['B4',0.5],['C5',0.5],['D5',1],['C5',0.5],['B4',0.5],
    ['A4',1],['A4',0.5],['C5',0.5],['E5',1],['D5',0.5],['C5',0.5],
    ['B4',1.5],['C5',0.5],['D5',1],['E5',1],
    ['C5',1],['A4',1],['A4',2],
    ['D5',1.5],['F5',0.5],['A5',1],['G5',0.5],['F5',0.5],
    ['E5',1.5],['C5',0.5],['E5',1],['D5',0.5],['C5',0.5],
    ['B4',1],['B4',0.5],['C5',0.5],['D5',1],['E5',1],
    ['C5',1],['A4',1],['A4',2]
  ];
  const BASS = [
    ['A2',4],['E2',4],['A2',4],['E2',4],
    ['D3',4],['A2',4],['E3',4],['A2',4]
  ];

  const music = {
    playing: false,
    timer: null,
    nextTime: 0,
    mi: 0,
    bi: 0,
    bassTime: 0
  };
  NOTE.E2 = 82.41;

  function scheduleMelody() {
    if (!AC || !music.playing) return;
    const bpm = 132 + (G.level - 1) * 4;
    const beat = 60 / bpm;
    const lookahead = 0.14;
    while (music.nextTime < AC.currentTime + lookahead) {
      const item = MELODY[music.mi];
      const dur = item[1] * beat;
      sfxMelodyNote(item[0], music.nextTime, dur);
      music.nextTime += dur;
      music.mi = (music.mi + 1) % MELODY.length;
    }
    while (music.bassTime < AC.currentTime + lookahead) {
      const b = BASS[music.bi];
      const dur = b[1] * beat;
      sfxBassNote(b[0], music.bassTime, dur);
      music.bassTime += dur;
      music.bi = (music.bi + 1) % BASS.length;
    }
  }

  function sfxMelodyNote(name, t0, dur) {
    const f = NOTE[name];
    if (!f) return;
    const osc = AC.createOscillator();
    const osc2 = AC.createOscillator();
    const gain = AC.createGain();
    osc.type = 'triangle';
    osc2.type = 'sine';
    osc.frequency.value = f;
    osc2.frequency.value = f * 2.005;
    const g2 = AC.createGain();
    g2.gain.value = 0.25;
    osc.connect(gain);
    osc2.connect(g2); g2.connect(gain);
    const vol = 0.07;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.min(dur * 0.9, 0.5));
    gain.connect(masterGain);
    osc.start(t0); osc2.start(t0);
    osc.stop(t0 + dur + 0.05); osc2.stop(t0 + dur + 0.05);
  }

  function sfxBassNote(name, t0, dur) {
    const f = NOTE[name];
    if (!f) return;
    const osc = AC.createOscillator();
    const gain = AC.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.06, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.96);
    osc.connect(gain); gain.connect(masterGain);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  function startMusic() {
    if (!AC || music.playing) return;
    music.playing = true;
    music.nextTime = AC.currentTime + 0.1;
    music.bassTime = AC.currentTime + 0.1;
    music.mi = 0;
    music.bi = 0;
    music.timer = setInterval(scheduleMelody, 25);
  }
  function stopMusic() {
    music.playing = false;
    if (music.timer) { clearInterval(music.timer); music.timer = null; }
  }

  /* ==========================================================================
     17. Grain
     ========================================================================== */

  const grain = {
    frames: [],
    idx: 0,
    last: 0,
    interval: 50,
    lastScratch: 0,
    flicker: 1
  };

  function buildGrain() {
    const N = 8, S = 256;
    for (let k = 0; k < N; k++) {
      const c = document.createElement('canvas');
      c.width = c.height = S;
      const g = c.getContext('2d');
      const img = g.createImageData(S, S);
      const d = img.data;
      const rnd = mulberry32(1000 + k * 97);
      for (let i = 0; i < d.length; i += 4) {
        const v = rnd();
        if (v < 0.5) {
          // dark speck
          d[i] = 20 + rnd() * 40;
          d[i + 1] = 18 + rnd() * 36;
          d[i + 2] = 12 + rnd() * 30;
          d[i + 3] = Math.floor(rnd() * 120);
        } else {
          // light speck
          d[i] = 220 + rnd() * 35;
          d[i + 1] = 215 + rnd() * 35;
          d[i + 2] = 195 + rnd() * 40;
          d[i + 3] = Math.floor(rnd() * 90);
        }
      }
      g.putImageData(img, 0, 0);
      grain.frames.push(c.toDataURL('image/png'));
    }
  }

  function updateGrain(dt) {
    if (SETTINGS.grain === 'OFF') return;
    if (G.time - grain.last >= grain.interval) {
      grain.last = G.time;
      grain.idx = (grain.idx + 1) % grain.frames.length;
      el.grainNoise.style.backgroundImage = 'url(' + grain.frames[grain.idx] + ')';
      const rx = Math.floor(Math.random() * 190);
      const ry = Math.floor(Math.random() * 190);
      el.grainNoise.style.backgroundPosition = rx + 'px ' + ry + 'px';
    }
    // subtle global brightness flicker
    grain.flicker = 0.965 + Math.random() * 0.035;
    el.grainNoise.style.opacity =
      (SETTINGS.grain === 'LIGHT' ? 0.10 : 0.22) * grain.flicker;
    // occasional dust scratch
    if (G.time - grain.lastScratch > 1800 && Math.random() < 0.02) {
      grain.lastScratch = G.time;
      el.grainScratch.style.left = (Math.random() * 100) + '%';
      el.grainScratch.classList.remove('show');
      void el.grainScratch.offsetWidth;
      el.grainScratch.classList.add('show');
    }
  }

  /* ==========================================================================
     18. Input — keyboard
     ========================================================================== */

  const keys = {};

  function keyDown(e) {
    const k = e.key;
    const code = e.code;

    // always prevent scrolling for game keys
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'Spacebar'].indexOf(k) >= 0) {
      e.preventDefault();
    }

    if (k === 'Enter' || code === 'Enter' || code === 'NumpadEnter') {
      ensureAudio();
      if (G.state === 'start') { startGame(); return; }
    }

    ensureAudio();

    if (k === 'p' || k === 'P' || k === 'Escape') { togglePause(); return; }
    if (k === 'r' || k === 'R') { restartGame(); return; }
    if (k === 'm' || k === 'M') { toggleSetting('music'); return; }
    if (k === 'n' || k === 'N') { toggleSetting('sound'); return; }

    if (G.state !== 'playing') return;
    if (keys[code]) return; // ignore OS auto-repeat
    keys[code] = true;

    if (k === 'ArrowLeft') { moveDAS(-1); }
    else if (k === 'ArrowRight') { moveDAS(1); }
    else if (k === 'ArrowDown') { G.softDrop.active = true; G.softDrop.timer = 0; softDropStep(); }
    else if (k === ' ' || k === 'Spacebar') { hardDrop(); }
    else if (k === 'ArrowUp' || k === 'x' || k === 'X') { tryRotate(1); }
    else if (k === 'z' || k === 'Z' || (k === 'Control' && !e.repeat)) { tryRotate(-1); }
    else if (k === 'a' || k === 'A') { tryRotate(2); }
    else if (k === 'c' || k === 'C' || k === 'Shift') { holdPiece(); }
  }

  function keyUp(e) {
    const k = e.key;
    const code = e.code;
    keys[code] = false;
    if (k === 'ArrowLeft' && G.das.dir === -1) G.das.dir = 0;
    if (k === 'ArrowRight' && G.das.dir === 1) G.das.dir = 0;
    if (k === 'ArrowDown') G.softDrop.active = false;
  }

  function moveDAS(dir) {
    if (tryMove(dir, 0, true)) sfx.move();
    G.das.dir = dir;
    G.das.timer = 0;
    G.das.arr = 0;
  }

  function softDropStep() {
    if (tryMove(0, 1, true)) {
      G.score += 1;
      G.lastWasRotation = false;
      sfx.softTick();
    }
    G.gravityAcc = 0;
  }

  /* ==========================================================================
     19. Input — touch controls & gestures
     ========================================================================== */

  function bindTouch() {
    document.querySelectorAll('.tbtn').forEach(function (btn) {
      const act = btn.getAttribute('data-act');
      let repeatTimer = null;
      let repeatDelay = null;

      function doAction() {
        if (G.state === 'start') { startGame(); return; }
        if (act === 'pause') { togglePause(); return; }
        if (G.state !== 'playing') return;
        if (act === 'left') { if (tryMove(-1, 0, true)) sfx.move(); }
        else if (act === 'right') { if (tryMove(1, 0, true)) sfx.move(); }
        else if (act === 'down') { G.softDrop.active = true; G.softDrop.timer = 0; softDropStep(); }
        else if (act === 'hard') { hardDrop(); }
        else if (act === 'cw') { tryRotate(1); }
        else if (act === 'ccw') { tryRotate(-1); }
        else if (act === 'hold') { holdPiece(); }
      }

      function clearRepeat() {
        if (repeatDelay) { clearTimeout(repeatDelay); repeatDelay = null; }
        if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
      }

      btn.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        ensureAudio();
        btn.setPointerCapture && btn.setPointerCapture(e.pointerId);
        doAction();
        if (act === 'left' || act === 'right' || act === 'down') {
          const rate = act === 'down' ? 30 : 40;
          repeatDelay = setTimeout(function () {
            repeatTimer = setInterval(function () {
              if (G.state !== 'playing') return;
              if (act === 'left') { if (tryMove(-1, 0, true)) sfx.move(); }
              else if (act === 'right') { if (tryMove(1, 0, true)) sfx.move(); }
              else if (act === 'down') { softDropStep(); }
            }, rate);
          }, 160);
        }
      });
      btn.addEventListener('pointerup', function (e) {
        e.preventDefault();
        clearRepeat();
        if (act === 'down') G.softDrop.active = false;
      });
      btn.addEventListener('pointercancel', function () { clearRepeat(); if (act === 'down') G.softDrop.active = false; });
      btn.addEventListener('pointerleave', function () { clearRepeat(); });
    });
  }

  function bindGestures() {
    const pf = document.getElementById('playfield');
    let sx = 0, sy = 0, st = 0, tracking = false, moved = false;

    pf.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      if (G.state === 'start') { ensureAudio(); startGame(); return; }
      ensureAudio();
      if (G.state !== 'playing') return;
      sx = e.clientX; sy = e.clientY; st = performance.now();
      tracking = true; moved = false;
    });

    pf.addEventListener('pointermove', function (e) {
      if (!tracking || G.state !== 'playing') return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      const step = Math.max(18, CELL * 0.7);
      if (Math.abs(dx) > step && Math.abs(dx) > Math.abs(dy)) {
        if (tryMove(dx > 0 ? 1 : -1, 0, true)) sfx.move();
        sx = e.clientX; sy = e.clientY;
        moved = true;
      }
    });

    pf.addEventListener('pointerup', function (e) {
      if (!tracking) return;
      tracking = false;
      if (G.state !== 'playing') return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      const dt = performance.now() - st;
      if (!moved && Math.abs(dx) < 14 && Math.abs(dy) < 14 && dt < 260) {
        tryRotate(1); // tap = rotate
      } else if (dy > 60 && Math.abs(dy) > Math.abs(dx) * 1.4) {
        hardDrop(); // fast downward swipe
      }
    });

    pf.addEventListener('pointercancel', function () { tracking = false; });
  }

  /* ==========================================================================
     20. Game flow
     ========================================================================== */

  function startGame() {
    el.cardStart.classList.add('hidden');
    el.cardPause.classList.add('hidden');
    el.cardOver.classList.add('hidden');
    resetGame();
    G.state = 'playing';
    spawnNext();
    updateHUD();
    drawHold();
    drawNext();
    ensureAudio();
  }

  function resetGame() {
    G.board = emptyBoard();
    G.active = null;
    G.bank = null;
    G.canHold = true;
    G.queue = [];
    G.bag = [];
    fillQueue();
    G.score = 0;
    G.displayScore = 0;
    G.level = 1;
    G.lines = 0;
    G.combo = -1;
    G.b2b = false;
    G.lastWasRotation = false;
    G.lockTimer = 0;
    G.lockResets = 0;
    G.gravityAcc = 0;
    G.clearRows = [];
    G.pendingTSpin = false;
    particles.length = 0;
    dropTrails.length = 0;
    lockPulses.length = 0;
    G.state = 'playing';
    G.overReveal = 0;
    G.overStart = 0;
    drawNext();
    drawHold();
  }

  function restartGame() {
    el.cardOver.classList.add('hidden');
    el.cardPause.classList.add('hidden');
    el.cardStart.classList.add('hidden');
    resetGame();
    spawnNext();
    updateHUD();
    if (SETTINGS.music && AC) { stopMusic(); startMusic(); }
  }

  function togglePause() {
    if (G.state === 'playing') {
      G.state = 'paused';
      el.cardPause.classList.remove('hidden');
      stopMusic();
    } else if (G.state === 'paused') {
      G.state = 'playing';
      el.cardPause.classList.add('hidden');
      if (SETTINGS.music && AC) startMusic();
    }
  }

  function gameOver() {
    G.active = null;
    G.state = 'over';
    G.overReveal = 0;
    stopMusic();
    sfx.gameOver();
    const isBest = G.score > G.best;
    if (isBest) { G.best = G.score; saveBest(); }
    el.overScore.textContent = G.score;
    el.overBest.textContent = G.best;
    el.newBest.classList.toggle('hidden', !isBest);
    // show the card after the grey-out reveal
    el.cardOver.classList.add('hidden');
    G.showOverAt = G.time + 900;
    G.overStart = G.time;
    shake(8, 300);
  }

  /* ==========================================================================
     21. Update loop
     ========================================================================== */

  function dropIntervalMs() {
    const lvl = G.level;
    const sp = Math.pow(0.8 - (lvl - 1) * 0.007, lvl - 1);
    return Math.max(16, sp * 1000);
  }

  function updateDAS(dt) {
    if (G.das.dir === 0) return;
    G.das.timer += dt;
    if (G.das.timer >= 160) {
      G.das.arr += dt;
      while (G.das.arr >= 40) {
        G.das.arr -= 40;
        if (tryMove(G.das.dir, 0, true)) sfx.move();
      }
    }
  }

  function updateSoftDrop(dt) {
    if (!G.softDrop.active) return;
    G.softDrop.timer += dt;
    while (G.softDrop.timer >= 30) {
      G.softDrop.timer -= 30;
      softDropStep();
    }
  }

  function updateGravity(dt) {
    const p = G.active;
    if (!p) return;
    const grounded = collides(p.type, p.rot, p.x, p.y + 1);
    if (grounded) {
      G.gravityAcc = 0;
      G.lockTimer += dt;
      if (G.lockTimer >= 500) lockPiece(false);
      return;
    }
    G.lockTimer = 0;
    G.gravityAcc += dt;
    const iv = dropIntervalMs();
    while (G.gravityAcc >= iv) {
      G.gravityAcc -= iv;
      if (!collides(p.type, p.rot, p.x, p.y + 1)) {
        p.y += 1;
        G.lastWasRotation = false;
      } else break;
    }
  }

  function updatePieceVisual(dt) {
    const p = G.active;
    if (!p) return;
    const k = 1 - Math.exp(-dt / 42);
    p.visX = lerp(p.visX, p.x, k);
    p.visY = lerp(p.visY, p.y, k);
    if (Math.abs(p.visX - p.x) < 0.01) p.visX = p.x;
    if (Math.abs(p.visY - p.y) < 0.01) p.visY = p.y;
  }

  function updateShake(nowMs) {
    if (nowMs < shakeUntil) {
      const m = shakeMag * ((shakeUntil - nowMs) / 150);
      const ox = (Math.random() * 2 - 1) * m;
      const oy = (Math.random() * 2 - 1) * m;
      el.sheet.style.transform = 'translate(' + ox.toFixed(1) + 'px,' + oy.toFixed(1) + 'px)';
    } else {
      if (shakeMag > 0) {
        el.sheet.style.transform = '';
        shakeMag = 0;
      }
    }
  }

  let lastFrame = 0;

  function loop(ts) {
    if (!lastFrame) lastFrame = ts;
    let dt = ts - lastFrame;
    lastFrame = ts;
    if (dt > 100) dt = 100;
    G.time += dt;

    if (G.state === 'playing') {
      updateDAS(dt);
      updateSoftDrop(dt);
      updateGravity(dt);
      updatePieceVisual(dt);
    } else if (G.state === 'clearing') {
      if (G.time - G.clearStart >= G.clearDuration) finalizeClear();
    } else if (G.state === 'over') {
      if (G.showOverAt && G.time >= G.showOverAt) {
        el.cardOver.classList.remove('hidden');
        G.showOverAt = 0;
      }
    }

    // score count-up
    if (G.displayScore < G.score) {
      G.displayScore = Math.min(G.score, G.displayScore + Math.max(2, (G.score - G.displayScore) * 0.28));
    } else if (G.displayScore > G.score) {
      G.displayScore = G.score;
    }

    updateShake(ts);
    updateGrain(dt);
    drawBoard();
    drawNext();
    updateHUD();

    requestAnimationFrame(loop);
  }

  /* ==========================================================================
     22. Visibility / boot
     ========================================================================== */

  function bindUI() {
    document.querySelectorAll('.check').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        ensureAudio();
        toggleSetting(b.getAttribute('data-setting'));
      });
    });
    el.playAgain.addEventListener('click', function (e) {
      e.preventDefault();
      ensureAudio();
      restartGame();
    });
    el.cardStart.addEventListener('click', function () {
      ensureAudio();
      startGame();
    });
    el.cardStart.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  }

  let resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 80);
  });
  window.addEventListener('orientationchange', function () {
    setTimeout(layout, 200);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && G.state === 'playing') {
      togglePause();
    }
  });

  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);

  // Debug API for automated tests.
  window.__tetris = {
    state: function () {
      const visBoard = G.board ? G.board.slice(HIDDEN).map(function (r) { return r.slice(); }) : [];
      return {
        score: G.score,
        level: G.level,
        lines: G.lines,
        over: G.state === 'over',
        paused: G.state === 'paused',
        started: G.state !== 'start',
        board: visBoard,
        active: G.active ? G.active.type : null,
        hold: G.bank,
        next: G.queue.slice(0, 3),
        combo: G.combo,
        b2b: G.b2b
      };
    },
    start: startGame,
    restart: restartGame,
    pause: togglePause,
    settings: SETTINGS,
    debugSetRows: function (n) {
      if (!G.board) G.board = emptyBoard();
      const rows = Math.max(0, Math.min(VIS, Math.floor(n) || 0));
      for (let i = 0; i < rows; i++) {
        const y = ROWS_TOTAL - 1 - i;
        for (let x = 1; x < COLS; x++) G.board[y][x] = 'J';
      }
      const p = makePiece('I');
      p.visX = p.x;
      p.visY = p.y;
      G.active = p;
      G.lockTimer = 0;
      G.lockResets = 0;
      G.gravityAcc = 0;
      G.lastWasRotation = false;
      return rows;
    }
  };

  function boot() {
    loadSettings();
    if (typeof document.fonts !== 'undefined' && document.fonts.ready) {
      document.fonts.ready.then(function () { layout(); });
    }
    G.board = emptyBoard();
    G.queue = [];
    fillQueue();
    buildGrain();
    layout();
    bindUI();
    bindTouch();
    bindGestures();
    updateHUD();
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
