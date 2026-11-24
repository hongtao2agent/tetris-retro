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
    S: '#93b07c', Z: '#c97a6e', J: '#7f98b8', L: '#d49a68',
    W: '#8db4cc',   // rainwater left by the flood tool; never a falling piece
    M: '#a08a6c'    // mud left by the frog; never a falling piece
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
    mode: 'classic',   // classic | endless | zen
    state: 'start',    // start | menu | playing | clearing | tool | page-turn | paused | stage-burst | stage-won | complete | over
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
    voice: false,      // spoken praise is opt-in; captions still show
    voiceChosen: false,
    grain: 'FULL'
  };

  const MENU = { selectedMode: 'classic', selectedStage: 0, resumeState: null, suspendedAt: 0 };
  const E = { best: 0, recordAtStart: 0 };
  // 静页 (zen): no failure, no speed-up. A full page turns over instead of ending the run.
  const Z = { pages: 1, locks: 0, turnAt: 0 };
  // Rainy-day tools. Each starts at TOOL_START, holds at most TOOL_CAP, and clearing
  // four lines at once by hand brings one more, picked at random.
  // Scripted runs (the tests) switch off the random weather and dew and trigger them by hand.
  const SCRIPTED = !!window.__tetrisScripted;
  // Weather: `rain` scales the drawn rain, `sound` the rain loop, `score` hand-cleared lines, `speed` the fall interval.
  const WEATHER = {
    drizzle: { rain: 1, sound: 1, score: 1, speed: 1 },
    downpour: { title: '雨势变大 · 得分 ×1.5', note: '雨大了。落得更快，得分 ×1.5', ms: 30000, rain: 1.8, sound: 1.5, score: 1.5, speed: .8 },
    storm: { title: '雷暴', note: '雷暴来了。闪电会替你削去最高的一格', ms: 30000, rain: 1.35, sound: 1.25, score: 1, speed: 1 },
    clear: { title: '放晴 · 得分 ×2', note: '放晴了。趁现在，得分 ×2', ms: 25000, rain: 0, sound: .3, score: 2, speed: 1 }
  };
  const W = { kind: 'drizzle', clock: 0, until: 0, nextAt: 0, strikeAt: 0, last: null, glow: 0, shown: -1, rainbow: 0 };
  const DEW_CHANCE = 1 / 6, DEW_LOCKS = 4;
  // The frog: rides a piece like a dewdrop but never leaves by itself. Free it by clearing
  // its row and it hops across the pile FROG_HOPS times, stomping a cell flat or leaving mud.
  const FROG_CHANCE = 1 / 12, FROG_HOPS = 3, FROG_MUD_MAX = 2, FROG_HOP_MS = 420, FROG_BONUS = 200;
  let frogRandom = Math.random;   // replaceable, so the tests can script the hops      // a dewdrop dries after this many more pieces
  // The garden beside the board grows with the campaign run's total score: one level per
  // threshold, which are the ten stage targets added up (so clearing stages 1-10 in turn reaches 10).
  const GARDEN_STEPS = [0, 5000, 15000, 30000, 50000, 80000, 120000, 170000, 230000, 310000, 410000];
  const GARDEN_NAMES = ['一颗种子', '冒芽了', '长出叶子和草丛', '开了第一朵花', '添了一盆，藤蔓开始往上爬', '藤上开出小花',
    '花丛密了起来', '藤爬过半，长出蘑菇', '花开得更盛了', '藤爬到了顶', '花环绕过了框顶'];
  const garden = { shown: 0, level: 0, quiet: true, lean: 0, open: 1, geom: null, frogUntil: 0 };
  const TOOL_KINDS = ['bolt', 'wind', 'flood'];
  const TOOL_START = 1, TOOL_CAP = 3, TOOL_MS = 680;
  const T = { bolt: 0, wind: 0, flood: 0, until: 0, byTool: false, windDir: -1, bolt_fx: null, gust: 0, fx: null };
  const $ = id => document.getElementById(id);
  const STAGES = [
    { target: 5000, gravity: 1000, name: '轻轻落笔' },
    { target: 10000, gravity: 850, name: '渐入佳境' },
    { target: 15000, gravity: 720, name: '找到节奏' },
    { target: 20000, gravity: 610, name: '连消时刻' },
    { target: 30000, gravity: 520, name: '笔下生风' },
    { target: 40000, gravity: 440, name: '心手相应' },
    { target: 50000, gravity: 370, name: '灵感加速' },
    { target: 60000, gravity: 310, name: '一路开花' },
    { target: 80000, gravity: 260, name: '最后冲刺' },
    { target: 100000, gravity: 220, name: '圆满收官' }
  ];
  const C = { index: 0, total: 0, totalLines: 0, passed: 0, cleared: [], reminded: false, resultAt: 0 };
  const formatScore = value => Math.round(value).toLocaleString('en-US');
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  const gardenCanvas = document.getElementById('garden-layer');
  const gardenCtx = gardenCanvas.getContext('2d');

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

  // A piece still in the air is only a pencil sketch: a faint wash of its colour,
  // a few guide strokes and a graphite outline gone over twice by hand.
  const sketchCache = {};

  function buildSketchTile(type, size) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    const base = COLORS[type];
    const rnd = mulberry32(seedFromString(type) + 31);
    g.fillStyle = rgba(base, 0.16);
    g.fillRect(0, 0, size, size);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = rgba(base, 0.4);
    g.lineWidth = Math.max(0.8, size * 0.04);
    for (let i = 0; i < 5; i++) {
      const x = rnd() * size, y = rnd() * size, len = size * (0.3 + rnd() * 0.4);
      const ang = Math.PI * 0.25 + (rnd() - 0.5) * 0.4;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      g.stroke();
    }
    const lw = Math.max(1, 1.4 * DPR);
    for (let pass = 0; pass < 2; pass++) {
      const inset = lw / 2 + pass * lw * 0.8;
      const wobble = () => (rnd() - 0.5) * lw * 1.1;
      g.strokeStyle = 'rgba(66,59,43,' + (pass ? 0.4 : 0.8) + ')';
      g.lineWidth = lw * (pass ? 0.7 : 1);
      g.beginPath();
      g.moveTo(inset + wobble(), inset + wobble());
      g.lineTo(size - inset + wobble(), inset + wobble());
      g.lineTo(size - inset + wobble(), size - inset + wobble());
      g.lineTo(inset + wobble(), size - inset + wobble());
      g.closePath();
      g.stroke();
    }
    return c;
  }

  function rebuildTiles() {
    const size = Math.max(10, Math.round((CELL - 2) * DPR));
    tileSize = size;
    TYPES.concat('W', 'M').forEach(function (t) { tileCache[t] = buildTile(t, size); sketchCache[t] = buildSketchTile(t, size); });
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
    if (!SCRIPTED && !G.dew && !G.frog && !G.hopper && G.bankDew == null && G.bankFrog == null) {
      // one passenger at a time: a dewdrop, more rarely the frog
      const roll = Math.random();
      if (roll < DEW_CHANCE) p.dew = randomDewCell(type);
      else if (roll < DEW_CHANCE + FROG_CHANCE) p.frog = randomDewCell(type);
    }
    G.active = p;
    G.lockTimer = 0;
    G.lockResets = 0;
    G.gravityAcc = 0;
    G.lastWasRotation = false;
    if (collides(p.type, p.rot, p.x, p.y)) {
      topOut();
    }
  }

  /* ==========================================================================
     8. Movement, rotation, locking
     ========================================================================== */

  function tryMove(dx, dy, byPlayer) {
    const p = G.active;
    if (!p) return false;
    if (byPlayer && dx) T.windDir = dx;   // the wind tool blows the way you last moved
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
      addScore(dist * 2);
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
    ageDew();
    if (p.dew) { const at = dewOffset(p); G.dew = { x: p.x + at.x, y: p.y + at.y, left: DEW_LOCKS }; }
    if (p.frog) { const at = cellOffset(p, p.frog); G.frog = { x: p.x + at.x, y: p.y + at.y }; }
    buzz(wasHard ? 14 : 8);
    if (!wasHard) {
      shake(2.5, 110);
      sfx.lock();
    }
    squash(p.type, p.rot, p.x, p.y);
    addLandingDust(p, minY);
    Z.locks++;

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
        addScore(400 * G.level);
        popup('T-SPIN', 'popup-ts');
      }
      G.combo = -1;
      G.b2b = false;
      G.canHold = true;
      finishTurn();
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
    const byTool = T.byTool;   // rows completed by a tool: half score, no combo, no new tool
    T.byTool = false;
    const clearedCells = rows.flatMap(y => G.board[y].map((type, x) => ({ x, y, type })));
    let dewCaught = false;
    if (G.dew) {
      if (rows.includes(G.dew.y)) { dewCaught = true; G.dew = null; }
      else G.dew.y += rows.filter(r => r > G.dew.y).length;   // rows below it are gone: it sinks with its block
    }
    let frogFreed = null;
    if (G.frog) {
      if (rows.includes(G.frog.y)) { frogFreed = { x: G.frog.x, y: G.frog.y - HIDDEN }; G.frog = null; }
      else G.frog.y += rows.filter(r => r > G.frog.y).length;
    }

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
    if (byTool) {
      gained = Math.floor(gained / 2);
    } else {
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
      gained = Math.round(gained * WEATHER[W.kind].score);
    }

    addScore(gained);
    if (label) popup(label, 'popup-main');

    // lines and level
    G.lines += n;
    // eraser crumbs
    rows.forEach(function (r) { addEraserCrumbs(r); });

    if (!G.active) G.canHold = true;   // wind and flood keep the falling piece, and its hold state
    G.clearRows = [];
    lockPulses.length = 0;   // rows have shifted; any unfinished colouring is now in the wrong place
    G.pendingTSpin = false;
    G.state = 'playing';
    freeActive();
    if (!byTool && n === 4) grantRandomTool();
    if (!byTool && (G.mode === 'endless' || (G.score < STAGES[C.index].target && !C.reminderThisTurn))) speakClear(n);
    // after any spoken praise, so these notes are the caption that stays
    if (dewCaught) {
      // the dewdrop's row is gone: a tool, or points when every tool is full
      if (grantRandomTool()) note('拆开了包裹，得到一件工具');
      else { addScore(300 * level); note('拆开了包裹，+' + 300 * level); }
      sfx.dew();
    }
    buzz(n === 4 ? [20, 30, 40] : 22);
    if (frogFreed) releaseFrog(frogFreed.x, frogFreed.y);
    C.reminderThisTurn = false;
    finishTurn(clearedCells);
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
     8b. Rainy-day tools: lightning, wind, flood
     ========================================================================== */

  function resetTools() {
    TOOL_KINDS.forEach(kind => { T[kind] = TOOL_START; });
    T.until = 0; T.byTool = false; T.windDir = -1; T.bolt_fx = null; T.gust = 0; T.fx = null;
  }

  function grantTool(kind) {
    if (T[kind] >= TOOL_CAP) return false;
    T[kind]++;
    sfx.toolGain();
    const button = $('tool-' + kind);
    button.classList.remove('earned');
    void button.offsetWidth;
    button.classList.add('earned');
    return true;
  }

  // One more of a random tool that is not already full.
  function grantRandomTool() {
    const open = TOOL_KINDS.filter(kind => T[kind] < TOOL_CAP);
    return open.length > 0 && grantTool(open[Math.floor(Math.random() * open.length)]);
  }

  // A tool may have moved blocks into the falling piece: lift it clear.
  function freeActive() {
    const p = G.active;
    if (!p) return;
    for (let n = 0; n < ROWS_TOTAL && collides(p.type, p.rot, p.x, p.y); n++) p.y--;
    p.visY = p.y;
    G.lockTimer = 0;
  }

  function markCell(x, y) {
    if (!reducedMotion()) lockPulses.push({ gx: x, gy: y - HIDDEN, t: G.time });
  }

  // Lightning splits the falling piece: its four cells drop straight down, each on its own.
  function strikeBolt() {
    const p = G.active;
    const m = matrixOf(p.type, p.rot);
    const cells = [];
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m[y].length; x++) if (m[y][x]) cells.push({ x: p.x + x, y: p.y + y });
    cells.sort((a, b) => b.y - a.y);   // lowest first, so stacked cells land on each other
    T.bolt_fx = { x: cells.reduce((sum, c) => sum + c.x, 0) / cells.length + .5, y: Math.max(0, cells[cells.length - 1].y - HIDDEN) };
    G.active = null;
    ageDew();
    const dewAt = p.dew ? dewOffset(p) : null, frogAt = p.frog ? cellOffset(p, p.frog) : null;
    cells.forEach(function (cell) {
      let y = Math.max(cell.y, 0);
      while (y + 1 < ROWS_TOTAL && !G.board[y + 1][cell.x]) y++;
      G.board[y][cell.x] = p.type;
      markCell(cell.x, y);
      if (dewAt && cell.x === p.x + dewAt.x && cell.y === p.y + dewAt.y) G.dew = { x: cell.x, y: y, left: DEW_LOCKS };
      if (frogAt && cell.x === p.x + frogAt.x && cell.y === p.y + frogAt.y) G.frog = { x: cell.x, y: y };
    });
    Z.locks++;
    G.canHold = true;
    return true;
  }

  // Wind pushes every row tight against one side, so the gaps line up on the other.
  function blowWind() {
    const dir = T.windDir < 0 ? -1 : 1;
    let moved = false;
    for (let y = 0; y < ROWS_TOTAL; y++) {
      const cells = G.board[y].filter(Boolean);
      const gaps = new Array(COLS - cells.length).fill(null);
      const row = dir < 0 ? cells.concat(gaps) : gaps.concat(cells);
      for (let x = 0; x < COLS; x++) {
        if (row[x] !== G.board[y][x]) moved = true;
        if (row[x] && !G.board[y][x]) markCell(x, y);
      }
      [G.dew, G.frog].forEach(function (rider) {
        if (!rider || rider.y !== y) return;
        // a passenger rides its block: same place in the row's order
        const before = G.board[y].slice(0, rider.x).filter(Boolean).length;
        rider.x = dir < 0 ? before : COLS - cells.length + before;
      });
      G.board[y] = row;
    }
    if (!moved) return false;
    T.gust = dir;
    freeActive();
    return true;
  }

  // Rainwater runs to the lowest row and fills its gaps, which completes and clears it.
  function raiseFlood() {
    for (let y = ROWS_TOTAL - 1; y >= 0; y--) {
      if (!G.board[y].some(Boolean)) continue;
      for (let x = 0; x < COLS; x++) {
        if (!G.board[y][x]) { G.board[y][x] = 'W'; markCell(x, y); }
      }
      freeActive();
      return true;
    }
    return false;
  }

  function useTool(kind) {
    if (G.state !== 'playing' || !G.active) return false;
    if (T[kind] < 1) { sfx.deny(); return false; }
    const worked = kind === 'bolt' ? strikeBolt() : kind === 'wind' ? blowWind() : raiseFlood();
    if (!worked) { sfx.deny(); return false; }
    T[kind]--;
    sfx[kind]();
    buzz(kind === 'bolt' ? [30, 40, 70] : 30);
    if (!reducedMotion()) {
      // full-screen transition, drawn on the rain layer (drawToolTransition)
      const field = el.boardCanvas.getBoundingClientRect(), bolt = T.bolt_fx || { x: COLS / 2, y: VIS / 2 };
      T.fx = { kind: kind, t: G.time, dir: T.gust || -1, seed: (Math.random() * 1e9) >>> 0,
        tx: field.left + bolt.x * CELL, ty: field.top + (bolt.y + .5) * CELL };
      if (kind === 'bolt') shake(7, 260);
    }
    // a beat for the effect to play out; nothing falls meanwhile
    G.state = 'tool';
    T.until = G.time + (reducedMotion() ? 60 : TOOL_MS);
    return true;
  }

  function finishTool() {
    const full = findFullRows();
    if (full.length > 0) {
      T.byTool = true;
      G.pendingTSpin = false;
      G.clearRows = full;
      G.clearStart = G.time;
      G.state = 'clearing';
      sfx.lineClear(full.length);
    } else {
      G.state = 'playing';
      finishTurn();
    }
  }

  /* ==========================================================================
     8c. Weather, dewdrops, the windowsill plant, haptics
     ========================================================================== */

  // A handwritten line in the caption slot.
  function note(text) {
    const caption = $('voice-caption');
    caption.textContent = text;
    caption.hidden = false;
    voiceCaptionUntil = G.time + 3400;
  }

  // Phones that support it get a small tap for the things the SOUND switch covers.
  function buzz(pattern) {
    try {
      if (SETTINGS.sound && typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) { /* not available */ }
  }

  function resetWeather() {
    W.kind = 'drizzle'; W.clock = 0; W.until = 0; W.last = null;
    W.nextAt = 22000 + Math.random() * 16000;   // the first change comes early enough to be seen
    applyWeather();
  }

  function setWeather(kind) {
    const was = W.kind;
    W.kind = WEATHER[kind] ? kind : 'drizzle';
    if (W.kind === 'drizzle') {
      W.nextAt = W.clock + 35000 + Math.random() * 25000;
      if (was !== 'drizzle') note(was === 'clear' ? '又下起了小雨' : '雨小了');
    } else {
      W.until = W.clock + WEATHER[W.kind].ms;
      W.strikeAt = W.clock + 3500;
      W.last = W.kind;
      note(WEATHER[W.kind].note);
      sfx.weather();
    }
    applyWeather();
  }

  function applyWeather() {
    $('sheet-title').textContent = W.kind === 'drizzle' ? 'GRAPHITE BLOCKS' : WEATHER[W.kind].title;
    updateMusicVolume();
  }

  // Runs on play time only, so a pause or the menu holds the weather where it was.
  function updateWeather(dt) {
    W.clock += dt;
    if (W.kind === 'drizzle') {
      if (SCRIPTED || W.clock < W.nextAt) return;
      // 静页 only gets the weather that helps
      const kinds = (G.mode === 'zen' ? ['storm', 'clear'] : ['downpour', 'storm', 'clear']).filter(kind => kind !== W.last);
      setWeather(kinds[Math.floor(Math.random() * kinds.length)]);
    } else if (W.clock >= W.until) {
      setWeather('drizzle');
    } else if (W.kind === 'storm' && G.state === 'playing' && W.clock >= W.strikeAt) {
      W.strikeAt = W.clock + 6000 + Math.random() * 3500;
      skyStrike();
    }
  }

  // A bolt from the storm knocks out one cell of the highest row.
  function skyStrike() {
    let hit = null;
    for (let y = 0; y < ROWS_TOTAL && !hit; y++) {
      const filled = [];
      for (let x = 0; x < COLS; x++) if (G.board[y][x]) filled.push(x);
      if (filled.length) hit = { x: filled[Math.floor(Math.random() * filled.length)], y: y };
    }
    const at = hit ? { x: hit.x + .5, y: Math.max(0, hit.y - HIDDEN) + .5 } : { x: Math.random() * COLS, y: 2 + Math.random() * 6 };
    if (hit) {
      const color = COLORS[G.board[hit.y][hit.x]];
      G.board[hit.y][hit.x] = null;
      if (G.dew && G.dew.x === hit.x && G.dew.y === hit.y) G.dew = null;
      if (G.frog && G.frog.x === hit.x && G.frog.y === hit.y) { G.frog = null; releaseFrog(hit.x, hit.y - HIDDEN); }   // startled out
      for (let i = 0; i < 8; i++) {
        particles.push({ x: at.x * CELL, y: at.y * CELL, vx: (Math.random() - .5) * 3, vy: -1 - Math.random() * 2.5,
          life: 700, maxLife: 700, size: CELL * (.1 + Math.random() * .12), color: color, kind: 'burst' });
      }
    }
    if (!reducedMotion()) {
      const field = el.boardCanvas.getBoundingClientRect();
      T.fx = { kind: 'strike', t: G.time, dir: -1, seed: (Math.random() * 1e9) >>> 0, tx: field.left + at.x * CELL, ty: field.top + at.y * CELL };
    }
    sfx.skyBolt();
    buzz(18);
    return hit;
  }

  // Pickups ("dew" in the code, drawn as a parcel): one cell of a piece now and then carries one.
  // Clear its row to open it.
  function randomDewCell(type) {
    const m = MATRICES[type][0], cells = [];
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m[y].length; x++) if (m[y][x]) cells.push({ x: x, y: y });
    return cells[Math.floor(Math.random() * cells.length)];
  }

  // Where one of the piece's cells (given in its unrotated matrix) sits in the current rotation.
  function cellOffset(p, cell) {
    const n = MATRICES[p.type][0].length;
    let x = cell.x, y = cell.y;
    for (let r = 0; r < ((p.rot % 4) + 4) % 4; r++) { const nx = n - 1 - y; y = x; x = nx; }
    return { x: x, y: y };
  }
  function dewOffset(p) { return cellOffset(p, p.dew); }

  function ageDew() {
    if (G.dew && --G.dew.left <= 0) G.dew = null;
  }

  /* ---- the frog ---- */

  const columnTop = col => G.board.findIndex(row => row[col]);   // row of the highest block, or -1

  function releaseFrog(x, y) {
    addScore(FROG_BONUS * G.level);
    note('青蛙跳出来了，+' + FROG_BONUS * G.level + '。看它要去哪儿捣乱');
    sfx.croak();
    G.hopper = { left: FROG_HOPS, muds: 0, x: x, y: y, from: null, to: null, t: 0 };
    planHop();
  }

  // Aim the next hop: another column while hops remain, then off the nearer side of the board.
  function planHop() {
    const h = G.hopper;
    h.from = { x: h.x, y: h.y };
    h.t = 0;
    if (h.left <= 0) { h.to = { x: h.x < COLS / 2 ? -2 : COLS + 1, y: h.y - 2, exit: true }; return; }
    const cols = [];
    for (let col = 0; col < COLS; col++) if (col !== h.x) cols.push(col);
    const col = cols[Math.floor(frogRandom() * cols.length)], top = columnTop(col);
    h.to = { x: col, y: (top < 0 ? ROWS_TOTAL : top) - 1 - HIDDEN };
  }

  // Hops only move on while pieces are falling, so a pause or a clear holds the frog mid-air.
  function updateHopper(dt) {
    const h = G.hopper;
    if (!h) return;
    h.t += dt;
    if (h.t < FROG_HOP_MS) return;
    if (h.to.exit) { G.hopper = null; garden.frogUntil = G.time + 9000; sfx.croak(); return; }   // off to sit in the garden
    frogLands(h, h.to.x);
    const top = columnTop(h.to.x);
    h.x = h.to.x;
    h.y = (top < 0 ? ROWS_TOTAL : top) - 1 - HIDDEN;
    h.left--;
    planHop();
  }

  // Each landing either leaves a block of mud on the column or stomps its top block flat.
  // Mud is kept off tall columns, never completes a row and never lands inside the falling
  // piece; at most FROG_MUD_MAX of the hops leave mud, and 静页's frog only ever stomps.
  function frogLands(h, col) {
    const top = columnTop(col);
    sfx.plop();
    buzz(10);
    if (G.mode !== 'zen' && h.muds < FROG_MUD_MAX && frogRandom() < .5) {
      const y = (top < 0 ? ROWS_TOTAL : top) - 1;
      const p = G.active, m = p ? matrixOf(p.type, p.rot) : [];
      const inPiece = m.some((line, my) => line.some((on, mx) => on && p.x + mx === col && p.y + my === y));
      if (y >= HIDDEN + 6 && G.board[y].filter(Boolean).length < COLS - 1 && !inPiece) {
        G.board[y][col] = 'M';
        markCell(col, y);
        h.muds++;
        return 'mud';
      }
    }
    if (top < 0) return 'nothing';
    const color = COLORS[G.board[top][col]];
    G.board[top][col] = null;
    if (G.dew && G.dew.x === col && G.dew.y === top) G.dew = null;
    if (G.frog && G.frog.x === col && G.frog.y === top) G.frog = null;
    for (let i = 0; i < 7; i++) {
      particles.push({ x: (col + .5) * CELL, y: (top - HIDDEN + .5) * CELL, vx: (Math.random() - .5) * 3, vy: -1 - Math.random() * 2,
        life: 600, maxLife: 600, size: CELL * (.1 + Math.random() * .12), color: color, kind: 'burst' });
    }
    return 'stomp';
  }

  /* ---- the garden ---- */

  // Score -> growth, 0..10 with fractions: the whole part is the level.
  function gardenGrowth(score) {
    for (let i = GARDEN_STEPS.length - 1; i > 0; i--) {
      if (score >= GARDEN_STEPS[i - 1]) return Math.min(10, i - 1 + (score - GARDEN_STEPS[i - 1]) / (GARDEN_STEPS[i] - GARDEN_STEPS[i - 1]));
    }
    return 0;
  }

  const runScore = () => C.total + (C.cleared.includes(C.index) ? 0 : G.score);

  // In the campaign the garden follows this run; elsewhere it shows the best run's garden.
  function gardenTarget() {
    return gardenGrowth(G.mode === 'classic' ? runScore() : G.best);
  }

  function updateGarden(dt) {
    const target = gardenTarget(), level = Math.floor(target + 1e-9);
    if (garden.debug != null) garden.shown = garden.debug;
    // (a level reached on the move that clears a stage is left to the result screen)
    if (!garden.quiet && level > garden.level && G.mode === 'classic' && ['playing', 'clearing', 'tool'].includes(G.state)) {
      note('花园 ' + level + ' 级：' + GARDEN_NAMES[level]);
      sfx.bloom();
    }
    garden.level = level;
    garden.quiet = false;
    if (garden.debug == null) {
      garden.shown += (target - garden.shown) * Math.min(1, dt / 500);
      if (Math.abs(target - garden.shown) < .002) garden.shown = target;
    }
    if (!garden.geom) return;

    // weather and tools move it
    const still = reducedMotion(), fx = T.fx, age = fx ? clamp((G.time - fx.t) / TOOL_MS, 0, 1) : 1;
    const lean = (G.state === 'tool' && T.gust ? T.gust * .55 : 0) + (W.kind === 'downpour' ? -.09 : 0);
    garden.lean += (lean - garden.lean) * Math.min(1, dt / 180);
    const open = G.danger ? .6 : W.kind === 'clear' ? 1.18 : W.kind === 'downpour' ? .85 : 1;
    garden.open += (open - garden.open) * Math.min(1, dt / 600);
    const env = {
      amp: still ? 0 : { drizzle: .05, downpour: .13, storm: .09, clear: .035 }[W.kind],
      lean: still ? 0 : garden.lean,
      open: garden.open,
      kind: W.kind,
      frog: G.time < garden.frogUntil,
      shake: !still && fx && (fx.kind === 'bolt' || fx.kind === 'strike') ? (1 - age) * 2.2 : 0,   // lightning makes it flinch
      bob: !still && fx && fx.kind === 'flood' ? Math.sin(Math.PI * age) * garden.geom.u * .4 : 0   // the flood lifts the pots
    };
    const g = garden.geom;
    gardenCtx.clearRect(0, 0, g.w, g.h);
    drawGarden(gardenCtx, g, garden.shown, still ? 0 : G.time, env);
  }

  const GARDEN_FLOWERS = ['#c97a6e', '#a48fb0', '#dcc87e', '#d49a68', '#7f98b8', '#d9a0a8'];

  // Everything is sized in `f.u` and placed from the frame's edges, so the same drawing
  // serves the board (game) and the little frame on the menu page.
  function drawGarden(ctx, f, growth, t, env) {
    const g = clamp(growth, 0, 10), u = f.u, ink = '#423b2b', stem = '#55733f';
    const ground = f.bottom - (f.label ? 1.15 * u : .2 * u), left = f.left;
    const sway = (h, phase) => (Math.sin(t / 1000 * 1.7 + phase) + Math.sin(t / 1000 * 2.9 + phase * 1.7) * .4) * env.amp * h
      + env.lean * h + env.shake * Math.sin(t * .09 + phase * 7);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function leaf(x, y, side, len, tilt) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((side > 0 ? -.55 : Math.PI + .55) + tilt);
      ctx.beginPath();
      ctx.ellipse(len / 2, 0, len / 2, len * .26, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#93b07c';
      ctx.fill();
      ctx.strokeStyle = stem;
      ctx.lineWidth = .9;
      ctx.stroke();
      ctx.restore();
    }

    function flower(x, y, r, color) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = .8;
      ctx.fillStyle = color;
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * r * .62 * env.open, y + Math.sin(a) * r * .62 * env.open, r * .5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, r * .38, 0, Math.PI * 2);
      ctx.fillStyle = '#e6d488';
      ctx.fill();
      ctx.stroke();
    }

    // A stem from (x, y) up `h`, with leaves along it and maybe a flower on top.
    function stalk(x, y, h, phase, leaves, color, size) {
      const dx = sway(h, phase), tx = x + dx, ty = y - h + Math.abs(dx) * .25, cx = x + dx * .25, cy = y - h * .6;
      ctx.strokeStyle = stem;
      ctx.lineWidth = Math.max(1.1, u * .13);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(cx, cy, tx, ty);
      ctx.stroke();
      for (let i = 0; i < leaves; i++) {
        const k = (i + 1) / (leaves + 1.4), q = 1 - k;
        leaf(q * q * x + 2 * q * k * cx + k * k * tx, q * q * y + 2 * q * k * cy + k * k * ty, i % 2 ? 1 : -1, u * .78, dx / Math.max(h, 1) * .8);
      }
      if (color) flower(tx, ty, size, color);
    }

    function pot(x, w, h, y) {
      ctx.beginPath();
      ctx.moveTo(x - w / 2, y - h);
      ctx.lineTo(x + w / 2, y - h);
      ctx.lineTo(x + w * .36, y);
      ctx.lineTo(x - w * .36, y);
      ctx.closePath();
      ctx.fillStyle = '#c9966a';
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - w * .56, y - h);
      ctx.lineTo(x + w * .56, y - h);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    function grass(seed, from, to, count, scale) {
      const rnd = mulberry32(seed);
      ctx.strokeStyle = '#7d9a63';
      ctx.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        const x = lerp(from, to, rnd()), h = u * (.5 + rnd() * .8) * scale, phase = rnd() * 6;
        if (i >= count) continue;
        const dx = sway(h, phase) * 1.4;
        ctx.beginPath();
        ctx.moveTo(x, ground);
        ctx.quadraticCurveTo(x, ground - h * .6, x + dx + (i % 2 ? 1 : -1) * u * .15, ground - h);
        ctx.stroke();
      }
    }

    // the ground line the pots stand on
    ctx.strokeStyle = 'rgba(66,59,43,.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left - 5 * u, ground);
    ctx.lineTo(left - .15 * u, ground);
    ctx.stroke();

    if (g >= 2) grass(11, left - 4.9 * u, left - .3 * u, Math.round(clamp((g - 2) * 3, 2, 14)), clamp(g - 1.6, .4, 1));

    // the flower bed behind the pots: more and taller stems as the score grows
    if (g > 3) {
      // the first stems are short; later ones stand taller behind them, up to a fifth of the frame
      const rnd = mulberry32(23), many = clamp((g - 3) * 2, 0, 14);
      for (let i = 13; i >= 0; i--) {
        const x = left - u * (1.3 + rnd() * 3.1), h = u * (2.2 + rnd() * 2 + i * .5), phase = rnd() * 6, color = GARDEN_FLOWERS[Math.floor(rnd() * GARDEN_FLOWERS.length)];
        const grown = clamp(many - i, 0, 1);
        if (grown > 0) stalk(x, ground, h * grown, phase, 2 + Math.floor(i / 3), grown > .6 ? color : null, u * (.52 + rnd() * .14) * grown);
      }
    }

    // the vine up the frame's left edge, then (level 9+) along the top as a garland
    const climb = clamp((g - 4) / 5, 0, 1) * (ground - f.top);
    if (climb > 0) {
      const step = 1.25 * u, every = g >= 8 ? 2 : g >= 6.5 ? 3 : 4, vx = i => left - .75 * u + Math.sin(i * 1.1) * .3 * u + sway(i * step * .07, i);
      ctx.strokeStyle = stem;
      ctx.lineWidth = Math.max(1.3, u * .15);
      ctx.beginPath();
      ctx.moveTo(vx(0), ground);
      const nodes = Math.floor(climb / step);
      for (let i = 1; i <= nodes; i++) ctx.lineTo(vx(i), ground - i * step);
      ctx.lineTo(vx(nodes + 1), ground - climb);
      ctx.stroke();
      for (let i = 1; i <= nodes; i++) {
        const side = i % 2 ? -1 : 1, tilt = sway(1, i * 2.3) * 1.5;
        leaf(vx(i), ground - i * step, side, u * (side < 0 ? .8 : .45), tilt);
        if (g >= 5 && i % every === every - 1) flower(vx(i) - u * .7, ground - i * step - u * .2, u * (g >= 7 && i % 5 === 4 ? .62 : .42), GARDEN_FLOWERS[i % GARDEN_FLOWERS.length]);
      }
    }
    if (g > 9) {
      const span = (f.right - left + .75 * u) * clamp(g - 9, 0, 1), step = 1.25 * u, top = f.top - .3 * u;
      const gy = i => top + Math.sin(i * 1.3) * .18 * u + sway(1, i) * .6;
      ctx.strokeStyle = stem;
      ctx.lineWidth = Math.max(1.3, u * .15);
      ctx.beginPath();
      ctx.moveTo(left - .75 * u, f.top + u);
      ctx.quadraticCurveTo(left - .75 * u, top, left - .75 * u + Math.min(span, step), gy(1));
      const nodes = Math.floor(span / step);
      for (let i = 2; i <= nodes; i++) ctx.lineTo(left - .75 * u + i * step, gy(i));
      ctx.stroke();
      for (let i = 1; i <= nodes; i++) {
        const x = left - .75 * u + i * step;
        leaf(x, gy(i), i % 2 ? 1 : -1, u * .62, Math.PI / 2 * (i % 2 ? -1 : 1) * .4 + sway(1, i * 1.7));
        if (i % 2 === 0) flower(x, gy(i) - u * .05, u * (i % 6 === 0 ? .5 : .4), GARDEN_FLOWERS[(i + 2) % GARDEN_FLOWERS.length]);
      }
      if (g >= 10) {
        // the garland spills a little way down the right side
        const x = f.right + .45 * u;
        ctx.strokeStyle = stem;
        ctx.beginPath();
        ctx.moveTo(x - .6 * u, top);
        ctx.quadraticCurveTo(x, top, x + sway(3 * u, 9) * .3, f.top + 3 * u);
        ctx.stroke();
        flower(x + sway(3 * u, 9) * .15, f.top + 1.5 * u, u * .42, GARDEN_FLOWERS[0]);
        flower(x + sway(3 * u, 9) * .3, f.top + 3 * u, u * .5, GARDEN_FLOWERS[2]);
      }
    }

    // a second, smaller bed right of the frame from level 6
    if (g > 6) {
      const rnd = mulberry32(37), many = clamp((g - 6) * 1.8 + .6, 0, 7);
      grass(41, f.right + .5 * u, f.right + 3.6 * u, Math.round(many * 2), 1);
      for (let i = 6; i >= 0; i--) {
        const x = f.right + u * (1 + rnd() * 2.2), h = u * (1.8 + rnd() * 1.6 + i * .5), phase = rnd() * 6, color = GARDEN_FLOWERS[Math.floor(rnd() * GARDEN_FLOWERS.length)];
        const grown = clamp(many - i, 0, 1);
        if (grown > 0) stalk(x, ground, h * grown, phase, 2 + Math.floor(i / 3), grown > .6 ? color : null, u * .5 * grown);
      }
    }

    // the two pots, in front
    const potY = ground - env.bob;
    if (g >= 4) {
      const scale = clamp((g - 4) * 3, .3, 1), x = left - 1.75 * u;
      stalk(x, potY - 1.1 * u * scale, u * clamp(1 + (g - 4) * .8, 1, 3.3) * scale, 2.1, g >= 5 ? 3 : 2, g >= 4.6 ? GARDEN_FLOWERS[1] : null, u * .66 * clamp((g - 4.6) * 2.5, .3, 1));
      pot(x, 1.5 * u * scale, 1.15 * u * scale, potY);
    }
    const potX = left - 3.7 * u;
    if (g < 1) stalk(potX, potY - 1.45 * u, u * (.15 + g * .85), .7, g > .5 ? 2 : 0, null, 0);
    else stalk(potX, potY - 1.45 * u, u * clamp(1 + (g - 1) * 1.1, 1, 3.2 + g * .08), .7, Math.min(6, 2 + Math.floor((g - 1) * 2)),
      g >= 2.6 ? GARDEN_FLOWERS[0] : null, u * .82 * clamp((g - 2.6) * 2.2, .3, 1));
    pot(potX, 1.9 * u, 1.5 * u, potY);

    if (g > 7) {
      const scale = clamp(g - 7, .25, 1);
      [[left - 2.75 * u, .5], [left - 4.75 * u, .36]].forEach(function (spot) {
        const r = u * spot[1] * scale;
        ctx.fillStyle = '#efe6cc';
        ctx.strokeStyle = ink;
        ctx.lineWidth = .9;
        ctx.beginPath();
        ctx.rect(spot[0] - r * .28, ground - r * .9, r * .56, r * .9);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(spot[0], ground - r * .9, r, Math.PI, 0);
        ctx.closePath();
        ctx.fillStyle = '#c97a6e';
        ctx.fill();
        ctx.stroke();
      });
    }

    // creatures: who is out depends on the level and the weather
    const wet = env.kind !== 'clear', rough = env.kind === 'downpour' || env.kind === 'storm', sec = t / 1000;

    if (g >= 5 && wet) {
      // a snail on the ground, out while it rains
      const x = left - 2.7 * u + Math.sin(sec * .12) * 1.9 * u, dir = Math.cos(sec * .12) >= 0 ? 1 : -1, r = u * .42;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.fillStyle = '#d9c9a0';
      ctx.beginPath();
      ctx.ellipse(x + dir * r * .5, ground - r * .22, r * 1.25, r * .24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + dir * r * 1.5, ground - r * .35);
      ctx.lineTo(x + dir * r * 1.75, ground - r * 1.05);
      ctx.moveTo(x + dir * r * 1.25, ground - r * .4);
      ctx.lineTo(x + dir * r * 1.35, ground - r * 1.05);
      ctx.stroke();
      ctx.fillStyle = '#c9966a';
      ctx.beginPath();
      ctx.arc(x, ground - r * .95, r * .8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, ground - r * .95, r * .42, .4, Math.PI * 1.7);
      ctx.stroke();
    }

    if (g >= 6 && !rough) {
      // butterflies over the bed
      for (let i = 0; i < (g >= 9 ? 3 : g >= 7.5 ? 2 : 1); i++) {
        const x = left - 2.7 * u + Math.sin(sec * (.55 + i * .13) + i * 2.1) * 1.9 * u;
        const y = ground - (4.5 + i * 2.6) * u + Math.sin(sec * (.9 + i * .2) + i) * 1.3 * u, flap = .25 + .75 * Math.abs(Math.sin(sec * 9 + i)), r = u * .5;
        ctx.strokeStyle = ink;
        ctx.lineWidth = .8;
        ctx.fillStyle = GARDEN_FLOWERS[[3, 4, 5][i]];
        [-1, 1].forEach(function (side) {
          ctx.beginPath();
          ctx.ellipse(x + side * r * .55 * flap, y - r * .25, r * .6 * flap, r * .55, side * .5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(x + side * r * .4 * flap, y + r * .35, r * .42 * flap, r * .36, -side * .4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
        ctx.beginPath();
        ctx.moveTo(x, y - r * .6);
        ctx.lineTo(x, y + r * .6);
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
    }

    if (g >= 8 && !wet) {
      // bees come out when the sky clears
      for (let i = 0; i < (g >= 10 ? 3 : 2); i++) {
        const x = left - (1.6 + i * 1.3) * u + Math.sin(sec * 2.3 + i * 2.4) * 1.1 * u + Math.sin(sec * 17 + i) * .08 * u;
        const y = ground - (3.4 + i * 3.2) * u + Math.sin(sec * 4.6 + i * 1.3) * .6 * u, r = u * .3, dir = Math.cos(sec * 2.3 + i * 2.4) >= 0 ? 1 : -1;
        ctx.fillStyle = 'rgba(245,242,228,.85)';
        ctx.strokeStyle = ink;
        ctx.lineWidth = .7;
        [-1, 1].forEach(function (side) {
          ctx.beginPath();
          ctx.ellipse(x - dir * r * .1 + side * r * .35, y - r * .85, r * .42, r * .62, side * .5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
        ctx.fillStyle = '#e3c452';
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.15, r * .78, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = .9;
        ctx.stroke();
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x - r * .3, y - r * .7);
        ctx.lineTo(x - r * .3, y + r * .7);
        ctx.moveTo(x + r * .3, y - r * .7);
        ctx.lineTo(x + r * .3, y + r * .7);
        ctx.stroke();
      }
    }

    if (g >= 10) {
      // fireflies drifting along the vine and garland
      for (let i = 0; i < 6; i++) {
        const along = i / 6, up = i % 2 === 0;
        const x = (up ? left - 1.6 * u : lerp(left, f.right, along)) + Math.sin(sec * (.4 + i * .07) + i * 1.9) * 1.5 * u;
        const y = (up ? lerp(ground - 6 * u, f.top + 3 * u, along) : f.top + 1.6 * u) + Math.cos(sec * (.33 + i * .05) + i) * 1.2 * u;
        const glow = (.35 + .65 * Math.pow(Math.max(0, Math.sin(sec * 1.6 + i * 2.2)), 2)) * (wet ? 1 : .45);
        ctx.fillStyle = 'rgba(240,214,96,' + (glow * .28).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(x, y, u * .55, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(250,232,130,' + glow.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(x, y, u * .2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // the frog drops in for a while after its mischief
    if (env.frog) drawFrogOn(ctx, f.right + 1.7 * u, ground - u * .45 + Math.abs(Math.sin(sec * 2.2)) * -u * .12, u * 1.5);

    if (f.label) {
      ctx.fillStyle = '#7d7562';
      ctx.textAlign = 'center';
      ctx.font = Math.max(8, Math.round(u * .8)) + 'px "ArchitectsDaughter", "Kaiti SC", KaiTi, serif';
      ctx.fillText('花园 ' + Math.floor(g + 1e-9) + ' 级', left - 2.7 * u, f.bottom - 1);
    }
    ctx.restore();
  }

  // The best run's garden, kept on the menu page.
  function drawMenuGarden() {
    const W0 = 230, H0 = 118, dpr = Math.min(window.devicePixelRatio || 1, 2), canvas = $('menu-garden'), ctx = canvas.getContext('2d');
    canvas.width = Math.round(W0 * dpr);
    canvas.height = Math.round(H0 * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W0, H0);
    const f = { left: W0 / 2 - 26, right: W0 / 2 + 26, top: 14, bottom: H0 - 2, u: 6.5, label: false };
    ctx.fillStyle = 'rgba(255,252,240,.3)';
    ctx.strokeStyle = '#423b2b';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.rect(f.left, f.top, f.right - f.left, f.bottom - f.top - 1.3);
    ctx.fill();
    ctx.stroke();
    const growth = gardenGrowth(G.best);
    drawGarden(ctx, f, growth, 0, { amp: 0, lean: 0, open: 1, shake: 0, bob: 0, kind: 'clear', frog: false });
    $('garden-note').textContent = G.best > 0
      ? '我的花园 · ' + Math.floor(growth + 1e-9) + ' 级 · 最好的一轮 ' + formatScore(G.best) + ' 分'
      : '闯关累计的积分，会让棋盘边的花园长起来。';
  }

  /* ---- the campaign run, kept across reloads ---- */

  function saveRun() {
    try {
      if (C.cleared.length === 0 || C.cleared.length >= STAGES.length) localStorage.removeItem(LS_RUN);
      else localStorage.setItem(LS_RUN, JSON.stringify({ index: C.index, total: C.total, totalLines: C.totalLines, cleared: C.cleared }));
    } catch (e) { /* the run still lasts until the page closes */ }
  }

  function savedRun() {
    try {
      const run = JSON.parse(localStorage.getItem(LS_RUN) || 'null');
      const stage = n => Number.isInteger(n) && n >= 0 && n < STAGES.length;
      if (!run || !Array.isArray(run.cleared) || !run.cleared.every(stage) || new Set(run.cleared).size !== run.cleared.length) return null;
      if (run.cleared.length === 0 || run.cleared.length >= STAGES.length || !stage(run.index)) return null;
      if (!Number.isSafeInteger(run.total) || run.total < 0 || !Number.isSafeInteger(run.totalLines) || run.totalLines < 0) return null;
      return run;
    } catch (e) { return null; }
  }

  function continueRun() {
    const run = savedRun();
    if (!run) return;
    ensureAudio();
    G.mode = 'classic';
    MENU.selectedMode = 'classic';
    C.cleared = run.cleared.slice();
    C.passed = C.cleared.length;
    C.total = run.total;
    C.totalLines = run.totalLines;
    C.index = run.index;
    if (C.cleared.includes(C.index)) C.index = nextUnclearedStage();
    MENU.selectedStage = C.index;
    startStage();
  }

  // Warm lamp light on the page: full when the sky clears, partial while a combo runs.
  function updateGlow(dt) {
    const wanted = W.kind === 'clear' ? 1 : clamp(G.combo, 0, 4) / 4 * .75;
    W.glow += clamp(wanted - W.glow, -dt / 1400, dt / 500);
    const shown = Math.round(W.glow * 50);
    if (shown !== W.shown) { W.shown = shown; $('sheet-glow').style.opacity = (shown / 50).toFixed(2); }
  }

  // The pile is near the top: the rain comes down harder until it is cut back.
  function checkDanger() {
    const top = G.board.findIndex(row => row.some(Boolean));
    const danger = top >= 0 && top < HIDDEN + 7;
    if (danger !== G.danger) { G.danger = danger; updateMusicVolume(); }
  }

  /* ==========================================================================
     9. Hold
     ========================================================================== */

  function holdPiece() {
    const p = G.active;
    if (!p || !G.canHold) return;
    if (G.bank == null) {
      G.bank = p.type;
      G.bankDew = p.dew || null;
      G.bankFrog = p.frog || null;
      G.active = null;
      sfx.hold();
      spawnNext();
    } else {
      const t = G.bank, dew = G.bankDew, frog = G.bankFrog;
      G.bank = p.type;
      G.bankDew = p.dew || null;
      G.bankFrog = p.frog || null;
      const np = makePiece(t);
      np.dew = dew;                       // a passenger stays with its piece through the hold
      np.frog = frog;
      np.visX = np.x; np.visY = np.y;
      G.active = np;
      G.lockTimer = 0; G.lockResets = 0; G.gravityAcc = 0;
      if (collides(np.type, np.rot, np.x, np.y)) topOut();
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
    // freshly locked cells get coloured in over COLOUR_MS (see drawColouring)
    if (reducedMotion()) return;
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
    if (G.mode === 'zen') return;
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
    if (reducedMotion() || G.mode === 'zen') return;
    shakeMag = Math.max(shakeMag, mag);
    shakeUntil = Math.max(shakeUntil, performance.now() + dur);
  }

  /* ==========================================================================
     11. Rendering — board
     ========================================================================== */

  let borderPath = null;
  const PAGE_TURN_MS = 800;
  const COLOUR_MS = 360;

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

    // settled blocks (a full 静页 page fades out as it turns)
    const settledAlpha = G.state === 'page-turn' ? clamp((Z.turnAt - G.time) / PAGE_TURN_MS, 0, 1) : 1;
    const colouring = colouringCells();
    for (let y = HIDDEN; y < ROWS_TOTAL; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = G.board[y][x];
        if (!t) continue;
        const progress = colouring.get(x + ',' + (y - HIDDEN));
        if (progress != null && settledAlpha === 1) drawColouring(t, x, y - HIDDEN, progress);
        else drawBlockAt(t, x, y - HIDDEN, settledAlpha);
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

    if (G.dew && G.dew.y >= HIDDEN) drawDew(G.dew.x, G.dew.y - HIDDEN, clamp(G.dew.left / 4, .3, 1));
    if (G.active && G.active.dew) {
      const at = dewOffset(G.active);
      if (G.active.visY + at.y - HIDDEN > -1) drawDew(G.active.visX + at.x, G.active.visY + at.y - HIDDEN, 1);
    }

    if (G.frog && G.frog.y >= HIDDEN) drawFrog(G.frog.x, G.frog.y - HIDDEN, .82);
    if (G.active && G.active.frog) {
      const at = cellOffset(G.active, G.active.frog);
      if (G.active.visY + at.y - HIDDEN > -1) drawFrog(G.active.visX + at.x, G.active.visY + at.y - HIDDEN, .82);
    }

    // particles
    drawParticles();
    if (G.hopper) {
      // mid-hop: an arc from where it was to where it lands
      const h = G.hopper, k = clamp(h.t / FROG_HOP_MS, 0, 1);
      drawFrog(lerp(h.from.x, h.to.x, k), lerp(h.from.y, h.to.y, k) - Math.sin(Math.PI * k) * 2.4, 1.15);
    }

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

  function drawBlockAt(type, gx, gy, alpha, sketch) {
    const tile = sketch ? sketchCache[type] : getTile(type);
    if (!tile) return;
    const x = gx * CELL;
    const y = gy * CELL;
    boardCtx.globalAlpha = alpha == null ? 1 : alpha;
    boardCtx.drawImage(tile, x + 1, y + 1, CELL - 2, CELL - 2);
    boardCtx.globalAlpha = 1;
  }

  // A pencil frog, centred on a cell.
  function drawFrog(gx, gy, scale) {
    drawFrogOn(boardCtx, (gx + .5) * CELL, (gy + .5) * CELL, CELL * scale);
  }

  function drawFrogOn(ctx, cx, cy, u) {
    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#3f5a31';
    ctx.fillStyle = '#93b07c';
    // hind legs, then the body over them
    [-1, 1].forEach(function (side) {
      ctx.beginPath();
      ctx.ellipse(cx + side * u * .3, cy + u * .2, u * .14, u * .1, side * .5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.ellipse(cx, cy + u * .06, u * .32, u * .25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    [-1, 1].forEach(function (side) {
      ctx.beginPath();
      ctx.arc(cx + side * u * .17, cy - u * .17, u * .11, 0, Math.PI * 2);
      ctx.fillStyle = '#f1ecd6';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + side * u * .17, cy - u * .17, u * .04, 0, Math.PI * 2);
      ctx.fillStyle = '#2f2a1f';
      ctx.fill();
    });
    ctx.beginPath();
    ctx.arc(cx, cy + u * .02, u * .17, Math.PI * .15, Math.PI * .85);
    ctx.stroke();
    ctx.restore();
  }

  // The tool pickup riding a cell: a small kraft-paper parcel tied with red string.
  // (Called "dew" in the code.) It fades as the rain soaks it.
  function drawDew(gx, gy, alpha) {
    const cx = (gx + .5) * CELL, cy = (gy + .56) * CELL, w = CELL * .6, h = CELL * .46, r = CELL * .07;
    const left = cx - w / 2, top = cy - h / 2;
    boardCtx.save();
    boardCtx.globalAlpha = alpha;
    boardCtx.lineJoin = 'round';
    boardCtx.lineCap = 'round';
    // the box
    boardCtx.beginPath();
    boardCtx.moveTo(left + r, top);
    boardCtx.lineTo(left + w - r, top);
    boardCtx.quadraticCurveTo(left + w, top, left + w, top + r);
    boardCtx.lineTo(left + w, top + h - r);
    boardCtx.quadraticCurveTo(left + w, top + h, left + w - r, top + h);
    boardCtx.lineTo(left + r, top + h);
    boardCtx.quadraticCurveTo(left, top + h, left, top + h - r);
    boardCtx.lineTo(left, top + r);
    boardCtx.quadraticCurveTo(left, top, left + r, top);
    boardCtx.fillStyle = '#dcb27c';
    boardCtx.fill();
    boardCtx.strokeStyle = '#423b2b';
    boardCtx.lineWidth = 1.2;
    boardCtx.stroke();
    // string round it, and a bow on top
    boardCtx.strokeStyle = '#a8483c';
    boardCtx.lineWidth = Math.max(1.2, CELL * .055);
    boardCtx.beginPath();
    boardCtx.moveTo(cx, top);
    boardCtx.lineTo(cx, top + h);
    boardCtx.moveTo(left, cy);
    boardCtx.lineTo(left + w, cy);
    boardCtx.stroke();
    boardCtx.lineWidth = Math.max(1.1, CELL * .05);
    [-1, 1].forEach(function (side) {
      boardCtx.beginPath();
      boardCtx.moveTo(cx, top);
      boardCtx.quadraticCurveTo(cx + side * CELL * .24, top - CELL * .26, cx + side * CELL * .17, top - CELL * .04);
      boardCtx.quadraticCurveTo(cx + side * CELL * .1, top + CELL * .02, cx, top);
      boardCtx.stroke();
    });
    boardCtx.restore();
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
      boardCtx.fillStyle = pt.color ? rgba(pt.color, a) : pt.kind === 'crumb'
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

  // Cells locked within the last COLOUR_MS, keyed "x,y" -> progress 0..1.
  function colouringCells() {
    const cells = new Map();
    for (let i = lockPulses.length - 1; i >= 0; i--) {
      const p = lockPulses[i];
      const age = (G.time - p.t) / COLOUR_MS;
      if (age >= 1) { lockPulses.splice(i, 1); continue; }
      cells.set(p.gx + ',' + p.gy, age);
    }
    return cells;
  }

  // Colour a sketched cell in with five diagonal pencil strokes, back and forth.
  function drawColouring(type, gx, gy, progress) {
    drawBlockAt(type, gx, gy, 1, true);
    const tile = getTile(type);
    if (!tile) return;
    const STROKES = 5, x0 = gx * CELL + 1, y0 = gy * CELL + 1, size = CELL - 2;
    boardCtx.save();
    boardCtx.beginPath();
    for (let i = 0; i < STROKES; i++) {
      const drawn = clamp(progress * STROKES - i, 0, 1);
      if (drawn <= 0) break;
      // In (a = u + v, b = u - v) space each stroke is a band of `a`, growing along `b`.
      const a0 = i / STROKES * 2, a1 = (i + 1) / STROKES * 2;
      const b0 = i % 2 ? 1 - 2 * drawn : -1, b1 = i % 2 ? 1 : -1 + 2 * drawn;
      [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].forEach(function (corner, n) {
        const px = x0 + (corner[0] + corner[1]) / 2 * size, py = y0 + (corner[0] - corner[1]) / 2 * size;
        if (n === 0) boardCtx.moveTo(px, py); else boardCtx.lineTo(px, py);
      });
      boardCtx.closePath();
    }
    boardCtx.clip();
    boardCtx.drawImage(tile, x0, y0, size, size);
    boardCtx.restore();
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
    // on phones the tool buttons sit in the gutters either side of the board
    const availW = pf.clientWidth - (isMobileLayout() ? 2 * 54 : 0);
    const availH = pf.clientHeight;
    let cell = Math.min(availW / COLS, availH / VIS);
    cell = clamp(Math.floor(cell), 6, 34);
    CELL = cell;

    const w = COLS * CELL;
    const h = VIS * CELL;
    el.boardCanvas.style.width = w + 'px';
    el.boardCanvas.style.height = h + 'px';
    el.boardCanvas.width = Math.round(w * DPR);
    el.boardCanvas.height = Math.round(h * DPR);

    boardCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // the garden's canvas wraps the board: room left for the beds and vine, above for the garland, right for a small bed
    const margin = { l: 58, t: 18, r: 44, b: 2 }, gw = w + margin.l + margin.r, gh = h + margin.t + margin.b;
    gardenCanvas.style.left = ((el.boardCanvas.offsetLeft || 0) - margin.l) + 'px';
    gardenCanvas.style.top = ((el.boardCanvas.offsetTop || 0) - margin.t) + 'px';
    gardenCanvas.style.width = gw + 'px';
    gardenCanvas.style.height = gh + 'px';
    gardenCanvas.width = Math.round(gw * DPR);
    gardenCanvas.height = Math.round(gh * DPR);
    gardenCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    garden.geom = { left: margin.l, top: margin.t, right: margin.l + w, bottom: margin.t + h, u: clamp(CELL * .42, 9, 12), label: true, w: gw, h: gh };
    resizeRain();
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
    el.best.textContent = G.mode === 'zen' ? '第 ' + Z.pages + ' 页 · 不计胜负' : G.mode === 'endless' ? '最高分 ' + formatScore(E.best) : '目标 ' + formatScore(STAGES[C.index].target) + ' · 总分 ' + formatScore(C.total + (C.cleared.includes(C.index) ? 0 : G.score));
    el.level.textContent = String(G.level).padStart(2, '0');
    $('stage-stat').hidden = G.mode !== 'classic';
    $('level-label').textContent = 'STAGE';
    el.lines.textContent = String(G.lines);
    if (G.time > voiceCaptionUntil) $('voice-caption').hidden = true;
    TOOL_KINDS.forEach(kind => {
      $('tool-' + kind + '-count').textContent = String(T[kind]);
      $('tool-' + kind).classList.toggle('empty', T[kind] < 1);
    });
    $('tool-wind-dir').textContent = T.windDir < 0 ? '←' : '→';
  }

  /* ==========================================================================
     15. Settings & persistence
     ========================================================================== */

  const LS_BEST = 'graphiteBlocksCampaignBestV1';
  const LS_ENDLESS_BEST = 'graphiteBlocksEndlessBestV1';
  const LS_SET = 'graphiteBlocksSettings';
  const LS_RUN = 'graphiteBlocksRunV1';

  function readBest(key) {
    try {
      const value = Number(localStorage.getItem(key));
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    } catch (e) { return 0; }
  }

  function loadSettings() {
    G.best = readBest(LS_BEST);
    E.best = readBest(LS_ENDLESS_BEST);
    try {
      const s = localStorage.getItem(LS_SET);
      if (s) {
        const o = JSON.parse(s);
        if (typeof o.sound === 'boolean') SETTINGS.sound = o.sound;
        if (typeof o.music === 'boolean') SETTINGS.music = o.music;
        // A saved `voice: true` from before it became opt-in is not a choice the player made.
        if (o.voiceChosen === true && typeof o.voice === 'boolean') { SETTINGS.voice = o.voice; SETTINGS.voiceChosen = true; }
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
      b.setAttribute('aria-pressed', String(on));
    });
    el.grainLabel.textContent = SETTINGS.grain;
    el.grainLayer.className = 'grain-' + SETTINGS.grain.toLowerCase()
      + (SETTINGS.grain === 'LIGHT' ? ' grain-light' : '') + (G.mode === 'zen' ? ' grain-zen' : '');
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
    if (key === 'voice') SETTINGS.voiceChosen = true;
    if (key === 'voice' && !SETTINGS.voice) stopVoice();
    applySettings();
    saveSettings();
  }

  /* ==========================================================================
     16. Audio (WebAudio effects, bundled voice and music)
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

  // Bundled Mandarin female recordings. WebAudio shares the user-unlocked context
  // with the game, so delayed line-clear events also work on mobile browsers.
  const VOICE = {
    'clear-2-a': '双消，漂亮！', 'clear-2-b': '一次带走两层，赚到啦！', 'clear-2-c': '节奏不错，继续保持！',
    'clear-3-a': '三连消！太流畅了！', 'clear-3-b': '哇，这波有点厉害哦！', 'clear-3-c': '三层一起清掉，舒服！',
    'clear-4-a': '四连消！这把太帅啦！', 'clear-4-b': '哇，全场高光！给你撒花！', 'clear-4-c': '方块大师，就是你啦！',
    near: '就差一点点啦，稳住，马上过关！',
    passed: '过关啦！这波配合，满分！',
    complete: '十关全过！方块大师，恭喜你呀！',
    start: '准备好了吗？一起闯关吧！',
    next: '新的一关，冲呀！',
    retry: '差一点点，再来一次！'
  };
  const VOICE_REVISION = 'gemini-v2';
  const voiceBuffers = new Map();
  let voiceSource = null, voiceTicket = 0, voicePriority = -1, voiceBusyUntil = 0;
  let voiceCaptionUntil = 0, lastClearVoiceAt = -Infinity, lastVoice = null;
  const clearVoiceBags = { 2: [], 3: [], 4: [] };
  const lastClearVariant = {};

  function stopVoice() {
    voiceTicket++;
    if (voiceSource) { try { voiceSource.stop(); } catch (e) {} voiceSource = null; }
    voicePriority = -1;
    voiceBusyUntil = 0;
    $('voice-caption').hidden = true;
    updateMusicVolume();
  }

  function speakVoice(key, text, priority = 0) {
    if (document.hidden || G.mode === 'zen') return false;
    if (G.time < voiceBusyUntil && (priority < voicePriority || priority === 0)) return false;
    stopVoice();
    const ticket = voiceTicket;
    const caption = text || VOICE[key];
    lastVoice = { key, text: caption };
    $('voice-caption').textContent = caption;
    $('voice-caption').hidden = false;
    voiceCaptionUntil = G.time + (priority > 0 ? 6500 : 3600);
    voicePriority = priority;
    voiceBusyUntil = G.time + (priority > 0 ? 6500 : 2600);
    if (!SETTINGS.voice || !AC || typeof fetch !== 'function') return true;
    if (!voiceBuffers.has(key)) {
      voiceBuffers.set(key, fetch('audio/' + key + '.m4a?v=' + VOICE_REVISION)
        .then(response => { if (!response.ok) throw new Error('Voice unavailable'); return response.arrayBuffer(); })
        .then(buffer => AC.decodeAudioData(buffer))
        .catch(() => { voiceBuffers.delete(key); return null; }));
    }
    voiceBuffers.get(key).then(buffer => {
      if (!buffer || ticket !== voiceTicket || !SETTINGS.voice || document.hidden || G.time > voiceBusyUntil) return;
      const source = AC.createBufferSource();
      const gain = AC.createGain();
      source.buffer = buffer;
      voiceBusyUntil = G.time + buffer.duration * 1000;
      gain.gain.value = .85;
      source.connect(gain); gain.connect(AC.destination);
      voiceSource = source;
      updateMusicVolume();
      source.onended = () => {
        source.disconnect(); gain.disconnect();
        if (ticket === voiceTicket) { voiceSource = null; voiceBusyUntil = 0; updateMusicVolume(); }
      };
      source.start();
    }).catch(() => {});
    return true;
  }

  function speakClear(lines) {
    if (lines < 2 || lines > 4 || G.time - lastClearVoiceAt < 1800) return;
    const bag = clearVoiceBags[lines];
    if (!bag.length) {
      bag.push('a', 'b', 'c');
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag[0] === lastClearVariant[lines]) [bag[0], bag[1]] = [bag[1], bag[0]];
    }
    if (speakVoice('clear-' + lines + '-' + bag[0])) {
      lastClearVariant[lines] = bag.shift();
      lastClearVoiceAt = G.time;
    }
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

  /* ---- Every action plays a note; pencil, eraser and paper are the sound effects ---- */
  // Notes come from a five-note scale in the key of the piece playing underneath
  // (MUSIC_TRACKS[].scale), so whatever the player does stays in tune with it.
  const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);
  let zenBus = null;

  // The bass alternates between the key note and its fifth every six placed pieces,
  // so the player's pace sets the harmonic rhythm.
  function zenChord() {
    const track = currentMusicTrack();
    return { set: track.scale, bass: track.bass + (Math.floor(Z.locks / 6) % 2 ? 7 : 0) };
  }

  // Three octaves of the current pentatonic set, low to high.
  function zenLadder() {
    const out = [];
    for (let octave = 0; octave < 3; octave++) zenChord().set.forEach(step => out.push(60 + 12 * octave + step));
    return out;
  }

  // The piece's column picks the pitch: left is low, right is high.
  function zenNote(offset = 0) {
    const ladder = zenLadder();
    const column = G.active ? G.active.x + 2 : 5;
    // on a run of clears the notes ring an octave higher
    return midiHz(ladder[clamp(column + offset, 0, ladder.length - 1)] + (G.combo >= 2 ? 12 : 0));
  }

  function ensureZenBus() {
    if (zenBus || !AC) return zenBus;
    zenBus = AC.createGain();
    const delay = AC.createDelay(1), feedback = AC.createGain(), damp = AC.createBiquadFilter(), wet = AC.createGain();
    delay.delayTime.value = .31; feedback.gain.value = .32; wet.gain.value = .35;
    damp.type = 'lowpass'; damp.frequency.value = 1800;
    zenBus.connect(masterGain);
    zenBus.connect(delay); delay.connect(damp); damp.connect(feedback); feedback.connect(delay);
    damp.connect(wet); wet.connect(masterGain);
    return zenBus;
  }

  // Soft kalimba-like pluck: a sine with two quieter, shorter overtones.
  function pluck(freq, opts = {}) {
    if (!AC || !SETTINGS.sound || !ensureZenBus()) return;
    const t0 = now() + (opts.delay || 0), dur = opts.dur || 1.1, vol = opts.vol == null ? .12 : opts.vol;
    const out = opts.dry ? masterGain : zenBus;   // dry notes skip the echo so quick runs do not smear
    [[1, 1, dur], [2, .22, dur * .5], [3, .06, dur * .3]].forEach(([mult, level, length]) => {
      const osc = AC.createOscillator(), gain = AC.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      gain.gain.setValueAtTime(.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol * level, t0 + .006);
      gain.gain.exponentialRampToValueAtTime(.0001, t0 + length);
      osc.connect(gain); gain.connect(out);
      osc.start(t0); osc.stop(t0 + length + .05);
    });
  }

  // Paper foley: a swell of filtered noise whose colour slides from `from` to `to` Hz.
  function paper(opts) {
    if (!AC || !SETTINGS.sound) return;
    const t0 = now() + (opts.delay || 0), dur = opts.dur || .15;
    const len = Math.max(1, Math.floor(AC.sampleRate * dur));
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len);
    const src = AC.createBufferSource(), f = AC.createBiquadFilter(), gain = AC.createGain();
    src.buffer = buf;
    f.type = 'bandpass'; f.Q.value = .7;
    f.frequency.setValueAtTime(opts.from, t0);
    f.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    gain.gain.value = opts.vol == null ? .06 : opts.vol;
    src.connect(f); f.connect(gain); gain.connect(masterGain);
    src.start(t0); src.stop(t0 + dur + .02);
  }

  // A sine that slides up to a peak and back down: the whistle in a gust of wind.
  function glide(opts) {
    if (!AC || !SETTINGS.sound) return;
    const t0 = now(), osc = AC.createOscillator(), gain = AC.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(opts.from, t0);
    osc.frequency.exponentialRampToValueAtTime(opts.peak, t0 + opts.dur * .45);
    osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.dur);
    gain.gain.setValueAtTime(.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.vol, t0 + opts.dur * .4);
    gain.gain.exponentialRampToValueAtTime(.0001, t0 + opts.dur);
    osc.connect(gain); gain.connect(ensureZenBus());
    osc.start(t0); osc.stop(t0 + opts.dur + .05);
  }

  // One syllable of a croak: a low buzz chopped by a fast flutter.
  function ribbit(delay) {
    if (!AC || !SETTINGS.sound) return;
    const t0 = now() + delay, dur = .15;
    const osc = AC.createOscillator(), flutter = AC.createOscillator(), depth = AC.createGain(), gain = AC.createGain(), tone = AC.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(230, t0 + dur);
    flutter.type = 'square'; flutter.frequency.value = 34;
    depth.gain.value = .05;
    gain.gain.setValueAtTime(.05, t0);
    gain.gain.setValueAtTime(.05, t0 + dur * .8);
    gain.gain.linearRampToValueAtTime(0, t0 + dur);
    tone.type = 'bandpass'; tone.frequency.value = 620; tone.Q.value = 1.4;
    flutter.connect(depth); depth.connect(gain.gain);
    osc.connect(tone); tone.connect(gain); gain.connect(masterGain);
    osc.start(t0); flutter.start(t0);
    osc.stop(t0 + dur + .02); flutter.stop(t0 + dur + .02);
  }

  function zenLand(vol) {
    pluck(midiHz(zenChord().bass), { vol: vol * .6, dur: 1.8 });
    pluck(zenNote(), { vol: vol * .5, dur: 1.2 });
    noiseBurst({ filter: 'lowpass', cutoff: 700, dur: .05, vol: .09 });   // pencil tip on paper
  }

  const sfx = {
    move: function () {
      pluck(zenNote(), { vol: .03, dur: .3, dry: true });
      noiseBurst({ cutoff: 3600, q: .6, dur: .035, vol: .018 });          // pencil scratch
    },
    rotate: function () { pluck(zenNote(2), { vol: .035, dur: .4, dry: true }); },
    softTick: function () { noiseBurst({ cutoff: 2800, dur: .02, vol: .012 }); },
    hardDrop: function () { paper({ from: 2400, to: 700, dur: .12, vol: .05 }); zenLand(.16); },
    lock: function () { zenLand(.13); },
    hold: function () { paper({ from: 900, to: 2600, dur: .18, vol: .05 }); pluck(zenNote(-2), { vol: .06 }); },
    lineClear: function (n) {
      const ladder = zenLadder();
      for (let i = 0; i < 3; i++) paper({ from: 1500, to: 900, dur: .11, vol: .07, delay: i * .1 });   // eraser rubs
      for (let i = 0; i < clamp(n, 1, 4) + 2; i++) {
        pluck(midiHz(ladder[Math.min(ladder.length - 1, 3 + i * 2)]), { vol: .1, dur: 1.5, delay: .08 + i * .09 });
      }
    },
    levelUp: function () {
      const ladder = zenLadder();
      [5, 7, 9, 10, 12].forEach((step, i) => pluck(midiHz(ladder[step]), { vol: .1, dur: 1.6, delay: i * .1 }));
    },
    gameOver: function () {
      const ladder = zenLadder();
      [7, 5, 3, 0].forEach((step, i) => pluck(midiHz(ladder[step] - 12), { vol: .12, dur: 2, delay: i * .24 }));
    },
    // thunder: a long low rumble under a sharp crack
    // thunder: two sharp cracks, then a rumble that rolls away
    bolt: function () {
      paper({ from: 6000, to: 800, dur: .08, vol: .22 });
      paper({ from: 4000, to: 600, dur: .12, vol: .16, delay: .15 });
      noiseBurst({ filter: 'lowpass', cutoff: 170, dur: 1.7, vol: .6, delay: .03 });
      noiseBurst({ filter: 'lowpass', cutoff: 110, dur: 1.4, vol: .4, delay: .55 });
      pluck(midiHz(zenChord().bass - 12), { vol: .22, dur: 2.4, delay: .03 });
    },
    // a gust: rushing air that rises and falls, with a faint whistle through it
    wind: function () {
      paper({ from: 300, to: 2000, dur: .6, vol: .16 });
      paper({ from: 2000, to: 420, dur: .7, vol: .12, delay: .42 });
      glide({ from: 520, peak: 980, to: 430, dur: 1, vol: .028 });
    },
    // water: a surge, then bubbles and drips
    flood: function () {
      const ladder = zenLadder();
      paper({ from: 220, to: 760, dur: .75, vol: .16 });
      noiseBurst({ filter: 'lowpass', cutoff: 420, dur: .6, vol: .12, delay: .1 });
      for (let i = 0; i < 8; i++) {
        pluck(midiHz(ladder[7 + Math.floor(Math.random() * 7)] + 12), { vol: .045, dur: .22, delay: .12 + i * .07 + Math.random() * .04, dry: true });
      }
    },
    croak: function () { ribbit(0); ribbit(.2); },
    plop: function () {
      paper({ from: 500, to: 180, dur: .09, vol: .12 });
      pluck(midiHz(zenChord().bass + 12), { vol: .08, dur: .25, dry: true });
    },
    weather: function () {
      const ladder = zenLadder();
      [4, 7, 9].forEach((step, i) => pluck(midiHz(ladder[step]), { vol: .07, dur: 1.6, delay: i * .16 }));
    },
    skyBolt: function () {
      paper({ from: 5000, to: 700, dur: .08, vol: .12 });
      noiseBurst({ filter: 'lowpass', cutoff: 150, dur: 1.4, vol: .34, delay: .03 });
    },
    dew: function () {
      const ladder = zenLadder();
      [10, 12, 14].forEach((step, i) => pluck(midiHz(ladder[step]) * 2, { vol: .06, dur: .9, delay: i * .08 }));
    },
    bloom: function () {
      const ladder = zenLadder();
      [5, 7, 9, 10, 12, 14].forEach((step, i) => pluck(midiHz(ladder[step]), { vol: .09, dur: 2, delay: i * .12 }));
    },
    toolGain: function () {
      const ladder = zenLadder();
      [7, 10].forEach((step, i) => pluck(midiHz(ladder[step]), { vol: .07, dur: 1.2, delay: .25 + i * .12 }));
    },
    deny: function () { noiseBurst({ filter: 'lowpass', cutoff: 500, dur: .05, vol: .06 }); },
    pageTurn: function () {
      const ladder = zenLadder();
      paper({ from: 500, to: 3200, dur: .55, vol: .11 });
      [9, 7, 5].forEach((step, i) => pluck(midiHz(ladder[step]), { vol: .08, dur: 1.6, delay: .1 + i * .18 }));
    }
  };

  /* ---- background ambience: rain loops with a sustained pad (see music/LICENSE.txt) ---- */
  // Ten stages, then endless, then 静页. Generated by scripts/build-ambience.py:
  // `scale` is the pad's major pentatonic (semitones above C) and `bass` its root (MIDI),
  // which the player's notes use; [loopStart, loopEnd] is the seamless region of the file;
  // `bed` is the rain recording, which also sets how heavily the drawn rain falls.
  const MUSIC_TRACKS = [
    { id: 'stage-01', title: '林间细雨 · D 调', scale: [2, 4, 6, 9, 11], bass: 38, loopStart: 0.25, loopEnd: 96.25, bed: 'open' },
    { id: 'stage-02', title: '窗边的雨 · G 调', scale: [2, 4, 7, 9, 11], bass: 43, loopStart: 0.25, loopEnd: 70.25, bed: 'window' },
    { id: 'stage-03', title: '屋内听雨 · C 调', scale: [0, 2, 4, 7, 9], bass: 36, loopStart: 0.25, loopEnd: 96.25, bed: 'indoor' },
    { id: 'stage-04', title: '林间细雨 · F 调', scale: [0, 2, 5, 7, 9], bass: 41, loopStart: 0.25, loopEnd: 96.25, bed: 'open' },
    { id: 'stage-05', title: '窗边的雨 · A 调', scale: [1, 4, 6, 9, 11], bass: 45, loopStart: 0.25, loopEnd: 70.25, bed: 'window' },
    { id: 'stage-06', title: '屋内听雨 · E 调', scale: [1, 4, 6, 8, 11], bass: 40, loopStart: 0.25, loopEnd: 96.25, bed: 'indoor' },
    { id: 'stage-07', title: '林间细雨 · G 调', scale: [2, 4, 7, 9, 11], bass: 43, loopStart: 0.25, loopEnd: 96.25, bed: 'open' },
    { id: 'stage-08', title: '窗边的雨 · D 调', scale: [2, 4, 6, 9, 11], bass: 38, loopStart: 0.25, loopEnd: 70.25, bed: 'window' },
    { id: 'stage-09', title: '屋内听雨 · F 调', scale: [0, 2, 5, 7, 9], bass: 41, loopStart: 0.25, loopEnd: 96.25, bed: 'indoor' },
    { id: 'stage-10', title: '林间细雨 · A 调', scale: [1, 4, 6, 9, 11], bass: 45, loopStart: 0.25, loopEnd: 96.25, bed: 'open' },
    { id: 'endless', title: '林间细雨 · C 调', scale: [0, 2, 4, 7, 9], bass: 36, loopStart: 0.25, loopEnd: 96.25, bed: 'open' },
    { id: 'zen', title: '屋内听雨 · D 调', scale: [2, 4, 6, 9, 11], bass: 38, loopStart: 0.25, loopEnd: 96.25, bed: 'indoor' }
  ];
  const MUSIC_REVISION = 'rain-v1';
  const musicLoads = new Map();
  const music = {
    track: null, buffer: null, bufferId: null, source: null, gain: null, playing: false, loading: false,
    offset: 0, startedAt: 0, span: 0, ticket: 0, status: 'idle'
  };

  function currentMusicTrack() {
    return MUSIC_TRACKS[G.mode === 'zen' ? STAGES.length + 1 : G.mode === 'endless' ? STAGES.length : C.index];
  }

  // Loops are about a minute and a half, so only the current one is kept decoded.
  function loadMusic(track) {
    if (music.bufferId === track.id) return Promise.resolve(music.buffer);
    if (!musicLoads.has(track.id)) {
      const pending = fetch('music/' + track.id + '.m4a?v=' + MUSIC_REVISION)
        .then(response => { if (!response.ok) throw new Error('Music unavailable'); return response.arrayBuffer(); })
        .then(data => AC.decodeAudioData(data))
        .catch(() => null).finally(() => musicLoads.delete(track.id));
      musicLoads.set(track.id, pending);
    }
    return musicLoads.get(track.id);
  }

  function updateMusicVolume() {
    if (!AC || !music.gain) return;
    const gain = music.gain.gain;
    gain.cancelScheduledValues(AC.currentTime);
    gain.setTargetAtTime((voiceSource ? .22 : .5) * WEATHER[W.kind].sound * (G.danger ? 1.2 : 1), AC.currentTime, .4);
  }

  function startMusic() {
    if (!AC || !SETTINGS.music || document.hidden || !['playing', 'clearing', 'tool', 'page-turn'].includes(G.state) || typeof fetch !== 'function') return;
    const track = currentMusicTrack();
    if ((music.playing || music.loading) && music.track === track.id) return;
    if (music.track !== track.id) stopMusic(true);
    music.track = track.id;
    const ticket = ++music.ticket;
    music.loading = true;
    music.status = 'loading';
    loadMusic(track).then(buffer => {
      if (ticket !== music.ticket) return;
      music.loading = false;
      if (!buffer) { music.status = 'unavailable'; return; }
      music.buffer = buffer; music.bufferId = track.id;
      const source = AC.createBufferSource();
      const gain = AC.createGain();
      const loopEnd = Math.min(track.loopEnd, buffer.duration);
      music.span = loopEnd - track.loopStart;
      music.offset %= music.span;
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = track.loopStart;
      source.loopEnd = loopEnd;
      gain.gain.value = 0;
      source.connect(gain); gain.connect(AC.destination);
      music.source = source; music.gain = gain;
      source.start(0, track.loopStart + music.offset);
      music.startedAt = AC.currentTime;
      music.playing = true;
      music.status = 'playing';
      updateMusicVolume();
    }).catch(() => {
      if (ticket === music.ticket) { stopMusic(); music.status = 'unavailable'; }
    });
  }

  function stopMusic(reset = false) {
    music.ticket++;
    if (music.source) {
      music.offset = (music.offset + Math.max(0, AC.currentTime - music.startedAt)) % music.span;
      const source = music.source, gain = music.gain;
      // a short fade so the rain does not cut off with a click
      gain.gain.cancelScheduledValues(AC.currentTime);
      gain.gain.setTargetAtTime(0, AC.currentTime, .03);
      try { source.stop(AC.currentTime + .2); } catch (e) {}
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      music.source = null; music.gain = null;
    }
    music.playing = false; music.loading = false;
    music.status = reset ? 'idle' : 'paused';
    if (reset) { music.track = null; music.offset = 0; }
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
     17b. Rain — pencil-drawn drops falling across the desk and the page
     ========================================================================== */

  // Seen from above: each drop slants in towards the spot where it lands and leaves
  // a small ring there. Follows the MUSIC switch, so the rain you see is the rain you hear.
  const rainCanvas = $('rain-layer');
  const rainCtx = rainCanvas.getContext('2d');
  const RAIN_DENSITY = { open: 1, window: .7, indoor: .4 };
  const RAIN_SLANT = .22;
  const RAIN_INK = { desk: '222,214,190', page: '63,55,42' };
  const rain = { drops: [], rings: [], w: 0, h: 0, level: 0, gust: 0, rectsAt: -Infinity, sheet: null, field: null, blank: true };

  function resizeRain() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    rain.w = window.innerWidth || 0;
    rain.h = window.innerHeight || 0;
    rainCanvas.width = Math.round(rain.w * dpr);
    rainCanvas.height = Math.round(rain.h * dpr);
    rainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rain.base = clamp(Math.round(rain.w * rain.h / 4500), 50, 320);
    rain.drops.length = Math.round(rain.base * 2.6);   // room for a downpour
    for (let i = 0; i < rain.drops.length; i++) rain.drops[i] = newDrop();
    rain.rectsAt = -Infinity;
    rain.blank = false;
  }

  function newDrop() {
    return {
      x: Math.random() * rain.w, y: Math.random() * rain.h,     // where it will land
      left: 80 + Math.random() * 320,                           // distance still to fall
      speed: 520 + Math.random() * 300, len: 9 + Math.random() * 11
    };
  }

  const within = (rect, x, y) => !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

  function updateRain(dt) {
    if (!rain.w) return;
    const wanted = SETTINGS.music && !reducedMotion() ? RAIN_DENSITY[currentMusicTrack().bed] * WEATHER[W.kind].rain * (G.danger ? 1.35 : 1) : 0;
    W.rainbow += clamp((W.kind === 'clear' && !reducedMotion() ? 1 : 0) - W.rainbow, -dt / 1500, dt / 1500);
    rain.level += clamp(wanted - rain.level, -dt / 900, dt / 900);
    if (rain.level <= 0 && !rain.rings.length && !T.fx && W.rainbow <= 0) {
      if (!rain.blank) { rainCtx.clearRect(0, 0, rain.w, rain.h); rain.blank = true; }
      return;
    }
    rain.blank = false;
    if (G.time - rain.rectsAt > 500) {
      rain.rectsAt = G.time;
      rain.sheet = el.sheet.getBoundingClientRect();
      rain.field = el.boardCanvas.getBoundingClientRect();
    }
    // never draw over the board while it is in view: the game stays perfectly readable
    const field = ['menu', 'start'].includes(G.state) ? null : rain.field;
    const ctx = rainCtx, active = Math.min(rain.drops.length, Math.round(rain.base * rain.level));
    // the wind tool throws the rain sideways for a moment
    rain.gust += (T.gust - rain.gust) * Math.min(1, dt / 160);
    const slant = RAIN_SLANT - rain.gust * .75;
    ctx.clearRect(0, 0, rain.w, rain.h);
    ctx.lineCap = 'round';

    const strokes = { desk: [], page: [] };
    for (let i = 0; i < active; i++) {
      const d = rain.drops[i];
      d.left -= d.speed * dt / 1000;
      if (d.left <= 0) {
        if (!within(field, d.x, d.y)) rain.rings.push({ x: d.x, y: d.y, born: G.time, page: within(rain.sheet, d.x, d.y) });
        rain.drops[i] = newDrop();
        continue;
      }
      const x = d.x + d.left * slant, y = d.y - d.left;
      if (within(field, x, y)) continue;
      strokes[within(rain.sheet, x, y) ? 'page' : 'desk'].push(x, y, d.len);
    }
    ['desk', 'page'].forEach(function (where) {
      const list = strokes[where];
      ctx.strokeStyle = 'rgba(' + RAIN_INK[where] + ',' + (where === 'desk' ? .24 : .17) + ')';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let i = 0; i < list.length; i += 3) {
        ctx.moveTo(list[i], list[i + 1]);
        ctx.lineTo(list[i] + list[i + 2] * slant, list[i + 1] - list[i + 2]);
      }
      ctx.stroke();
    });

    ctx.lineWidth = 1;
    for (let i = rain.rings.length - 1; i >= 0; i--) {
      const ring = rain.rings[i], age = (G.time - ring.born) / 520;
      if (age >= 1) { rain.rings.splice(i, 1); continue; }
      ctx.strokeStyle = 'rgba(' + RAIN_INK[ring.page ? 'page' : 'desk'] + ',' + ((1 - age) * (ring.page ? .26 : .34)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(ring.x, ring.y, 1.5 + age * 7, (1.5 + age * 7) * .6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (W.rainbow > 0) drawRainbow(ctx, field);
    drawToolTransition(ctx);
  }

  // A pencil rainbow across a top corner of the page while the sky is clear, kept off the board.
  function drawRainbow(ctx, field) {
    const sheet = rain.sheet;
    if (!sheet) return;
    const radius = Math.min(sheet.width, sheet.height) * .46;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sheet.left, sheet.top, sheet.width, sheet.height);
    if (field) ctx.rect(field.left, field.top, field.width, field.height);
    ctx.clip('evenodd');
    ctx.lineWidth = 5;
    ['201,122,110', '212,154,104', '220,200,126', '147,176,124', '127,152,184', '164,143,176'].forEach(function (rgb, i) {
      ctx.strokeStyle = 'rgba(' + rgb + ',' + (W.rainbow * .5).toFixed(3) + ')';
      ctx.beginPath();
      // phones: top-left corner; wide layout: top-right, where the board is not in the way
      if (isMobileLayout()) ctx.arc(sheet.left, sheet.top + sheet.height * .02, radius - i * 5.5, 0, Math.PI / 2);
      else ctx.arc(sheet.right, sheet.top + sheet.height * .02, radius - i * 5.5, Math.PI / 2, Math.PI);
      ctx.stroke();
    });
    ctx.restore();
  }

  function strokePoints(ctx, pts, width, style) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach((pt, i) => { if (i) ctx.lineTo(pt[0], pt[1]); else ctx.moveTo(pt[0], pt[1]); });
    ctx.stroke();
  }

  // Full-screen transitions for the tools, over everything but the grain.
  function drawToolTransition(ctx) {
    const fx = T.fx;
    if (!fx) return;
    const age = fx.hold != null ? fx.hold : (G.time - fx.t) / TOOL_MS;
    if (age >= 1) { T.fx = null; return; }
    const w = rain.w, h = rain.h, rnd = mulberry32(fx.seed);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (fx.kind === 'bolt' || fx.kind === 'strike') {
      // two flashes, then a forked bolt from the top of the screen down to the piece (dimmer for a storm's own strike)
      const flash = (Math.max(0, 1 - age / .16) * .62 + (age > .22 && age < .42 ? (1 - (age - .22) / .2) * .34 : 0)) * (fx.kind === 'strike' ? .45 : 1);
      if (flash > 0) { ctx.fillStyle = 'rgba(255,253,240,' + flash.toFixed(3) + ')'; ctx.fillRect(0, 0, w, h); }
      const alpha = clamp(1 - (age - .12) / .6, 0, 1);
      const startX = fx.tx + (rnd() - .5) * w * .5, steps = 9, pts = [[startX, 0]];
      for (let i = 1; i <= steps; i++) {
        pts.push([i === steps ? fx.tx : lerp(startX, fx.tx, i / steps) + (rnd() - .5) * 52, fx.ty * i / steps]);
      }
      strokePoints(ctx, pts, 9, 'rgba(255,253,240,' + (alpha * .5).toFixed(3) + ')');
      strokePoints(ctx, pts, 2.8, 'rgba(52,46,34,' + alpha.toFixed(3) + ')');
      [3, 6].forEach(function (from) {
        const side = rnd() < .5 ? -1 : 1, branch = [pts[from]];
        let x = pts[from][0], y = pts[from][1];
        for (let j = 0; j < 3; j++) { x += side * (18 + rnd() * 32); y += 14 + rnd() * 30; branch.push([x, y]); }
        strokePoints(ctx, branch, 1.5, 'rgba(52,46,34,' + (alpha * .8).toFixed(3) + ')');
      });
      // the strike: rings and sparks around the piece
      ctx.strokeStyle = 'rgba(52,46,34,' + (alpha * .7).toFixed(3) + ')';
      ctx.lineWidth = 1.4;
      [1, .6].forEach(function (scale) {
        ctx.beginPath();
        ctx.arc(fx.tx, fx.ty, 8 + age * 90 * scale, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const ang = rnd() * Math.PI * 2, near = 14 + age * 60, far = near + 8 + rnd() * 16;
        ctx.moveTo(fx.tx + Math.cos(ang) * near, fx.ty + Math.sin(ang) * near);
        ctx.lineTo(fx.tx + Math.cos(ang) * far, fx.ty + Math.sin(ang) * far);
      }
      ctx.stroke();
    } else if (fx.kind === 'wind') {
      // long curling strokes racing across the whole screen, drawn dark and light so they read on desk and page
      for (let i = 0; i < 30; i++) {
        const y = rnd() * h, len = w * (.2 + rnd() * .38), delay = rnd() * .35, curl = (rnd() - .5) * 34, drift = (rnd() - .5) * 14;
        const p = clamp((age - delay) / (1 - delay), 0, 1);
        if (p <= 0) continue;
        const travel = (w + len * 2) * (1 - Math.pow(1 - p, 2));
        const x = fx.dir < 0 ? w + len - travel : travel - len * 2;
        const a = Math.sin(Math.PI * p);
        [['52,46,34', .42, 0], ['236,230,208', .3, 2]].forEach(function (tone) {
          ctx.strokeStyle = 'rgba(' + tone[0] + ',' + (a * tone[1]).toFixed(3) + ')';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, y + tone[2]);
          ctx.quadraticCurveTo(x + len / 2, y + curl + tone[2], x + len, y + drift + tone[2]);
          ctx.stroke();
        });
      }
    } else {
      // a wash of rainwater swells up from the bottom of the screen and drains away
      const swell = Math.sin(Math.PI * Math.min(1, age * 1.08));
      [[.4, .3, 0], [.3, .2, 1.7]].forEach(function (layer) {
        const top = h - swell * h * layer[0];
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w + 16; x += 16) {
          ctx.lineTo(x, top + Math.sin(x / 40 + age * 13 + layer[2]) * 7 + Math.sin(x / 17 - age * 8 + layer[2]) * 3);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = 'rgba(141,180,204,' + layer[1] + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(62,98,124,' + (.5 * swell).toFixed(3) + ')';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      });
      ctx.strokeStyle = 'rgba(62,98,124,' + (.5 * swell).toFixed(3) + ')';
      ctx.lineWidth = 1.1;
      for (let i = 0; i < 16; i++) {
        const x = rnd() * w, y = h - rnd() * swell * h * .34, grow = (age * 3 + rnd()) % 1;
        ctx.beginPath();
        ctx.ellipse(x, y, 3 + grow * 12, (3 + grow * 12) * .5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /* ==========================================================================
     18. Input — keyboard
     ========================================================================== */

  const keys = {};
  const touchStops = [];

  function keyDown(e) {
    const k = e.key;
    const code = e.code;

    if (['stage-burst', 'stage-won', 'complete'].includes(G.state)) {
      if ([' ', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      if (k === 'Enter' && !e.repeat && e.target.tagName !== 'BUTTON') advanceStage();
      return;
    }

    if (G.state === 'menu') {
      if (k === 'Escape' && MENU.resumeState) closeMenu();
      if (k === 'Enter' && !e.repeat && e.target.tagName !== 'BUTTON') launchSelection();
      return;
    }
    if (e.target.tagName === 'BUTTON' && (k === 'Enter' || k === ' ')) return;

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
    else if (k === '1') { useTool('bolt'); }
    else if (k === '2') { useTool('wind'); }
    else if (k === '3') { useTool('flood'); }
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
      addScore(1);
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
      touchStops.push(clearRepeat);

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

  function addScore(points) {
    G.score += points;
    if (G.mode === 'zen') return;
    if (G.mode === 'endless') {
      if (G.score > E.best) {
        E.best = G.score;
        try { localStorage.setItem(LS_ENDLESS_BEST, String(E.best)); } catch (e) { /* retain the session record if storage is unavailable */ }
      }
      return;
    }
    if (C.reminded || G.score >= STAGES[C.index].target) return;
    if (G.score >= STAGES[C.index].target * .8) {
      C.reminded = true;
      C.reminderThisTurn = true;
      const remaining = STAGES[C.index].target - G.score;
      speakVoice('near', '还差 ' + remaining + ' 分就过关啦，加油！', 2);
    }
  }

  function finishStage(clearedCells) {
    if (G.mode !== 'classic' || C.cleared.includes(C.index)) return;
    C.cleared.push(C.index);
    C.passed = C.cleared.length;
    C.total += G.score;
    C.totalLines += G.lines;
    if (C.total > G.best) { G.best = C.total; saveBest(); }
    saveRun();
    G.displayScore = G.score;
    G.active = null;
    G.state = 'stage-burst';
    resetInput();
    stopMusic();
    stopVoice();
    sfx.levelUp();
    levelUpPulse();
    const cells = clearedCells.concat(G.board.flatMap((row, y) => row.map((type, x) => ({ x, y, type }))));
    particles.length = 0;
    if (!reducedMotion()) {
      cells.filter(cell => cell.type && cell.y >= HIDDEN).forEach(cell => {
        for (let i = 0; i < 3; i++) {
          particles.push({ x: (cell.x + .5) * CELL, y: (cell.y - HIDDEN + .5) * CELL,
            vx: (cell.x - 4.5) * .7 + (Math.random() - .5) * 4,
            vy: -3 - Math.random() * 6, life: 1250, maxLife: 1250,
            size: CELL * (.12 + Math.random() * .16), color: COLORS[cell.type], kind: 'burst' });
        }
      });
      shake(4, 220);
    }
    G.board = emptyBoard();
    G.dew = null; G.frog = null; G.hopper = null;
    lockPulses.length = dropTrails.length = 0;
    C.resultAt = G.time + (reducedMotion() ? 100 : 950);
    updateHUD();
  }

  function showStageResult() {
    const complete = C.passed === STAGES.length;
    const next = nextUnclearedStage();
    G.state = complete ? 'complete' : 'stage-won';
    $('stage-result-eyebrow').textContent = complete ? 'ALL TEN CHAPTERS · COMPLETE' : 'STAGE ' + String(C.index + 1).padStart(2, '0') + ' · CLEARED';
    $('stage-result-seal').textContent = complete ? '✧ 10 ✧' : '✦ ' + String(C.index + 1).padStart(2, '0');
    $('stage-result-title').textContent = complete ? '十关通关，方块大师！' : '第 ' + (C.index + 1) + ' 关，过啦！';
    $('stage-result-message').textContent = complete ? '每一次落下，都让你离这场花雨更近。' : '这一页很漂亮，送你一场彩纸花雨。';
    $('stage-result-score').textContent = formatScore(G.score);
    $('stage-result-target').textContent = '本关目标 ' + formatScore(STAGES[C.index].target) + ' 分';
    $('stage-result-lines').textContent = '本关消除 ' + G.lines + ' 行';
    $('stage-result-total').textContent = '累计 ' + formatScore(C.total) + ' 分';
    $('stage-result-path').innerHTML = STAGES.map((stage, i) => '<span class="' + (C.cleared.includes(i) ? 'passed' : '') + '">' + (C.cleared.includes(i) ? '✦' : String(i + 1).padStart(2, '0')) + '</span>').join('');
    $('stage-next-hint').textContent = complete ? '全部 10 关完成 · 共消除 ' + C.totalLines + ' 行 · 最佳总分 ' + formatScore(G.best) : '已完成 ' + C.passed + ' / 10 关 · 接下来第 ' + (next + 1) + ' 关\n' + STAGES[next].name + ' · ' + formatScore(STAGES[next].target) + ' 分，积分重新从 0 累积。';
    $('next-stage').textContent = complete ? '再闯十关 →' : '进入第 ' + (next + 1) + ' 关 →';
    $('stage-result').classList.toggle('all-complete', complete);
    $('stage-result').hidden = false;
    const confetti = $('celebration-confetti');
    confetti.innerHTML = Array.from({ length: reducedMotion() ? 18 : complete ? 96 : 64 }, (_, i) => {
      const x = Math.random() * 100;
      return '<i style="left:' + x.toFixed(2) + '%;--fall-delay:' + (Math.random() * 2).toFixed(2) + 's;--fall-duration:' + (3.5 + Math.random() * 2).toFixed(2) + 's;--drift:' + ((Math.random() - .5) * 200).toFixed(0) + 'px;--turn:' + (Math.random() * 720).toFixed(0) + 'deg;--petal:' + COLORS[TYPES[i % TYPES.length]] + ';top:' + (-10 - Math.random() * 30).toFixed(0) + 'px"></i>';
    }).join('');
    confetti.hidden = false;
    speakVoice(complete ? 'complete' : 'passed', null, 3);
    $('next-stage').focus({ preventScroll: true });
  }

  function nextUnclearedStage() {
    for (let step = 1; step <= STAGES.length; step++) {
      const index = (C.index + step) % STAGES.length;
      if (!C.cleared.includes(index)) return index;
    }
    return 0;
  }

  function advanceStage() {
    if (!['stage-won', 'complete'].includes(G.state)) return;
    if (C.passed === STAGES.length) { startGame(); return; }
    C.index = nextUnclearedStage();
    saveRun();
    startStage();
  }

  function startGame(mode = 'classic', stage = 0) {
    G.mode = ['endless', 'zen'].includes(mode) ? mode : 'classic';
    MENU.selectedMode = G.mode;
    E.recordAtStart = E.best;
    C.index = G.mode === 'classic' && Number.isInteger(stage) ? clamp(stage, 0, STAGES.length - 1) : 0;
    MENU.selectedStage = C.index;
    C.total = 0; C.totalLines = 0; C.passed = 0; C.cleared = [];
    if (G.mode === 'classic') saveRun();   // a new run replaces the saved one
    startStage();
  }

  function startStage(retry = false) {
    stopVoice();
    stopMusic(true);
    hideGameScreens();
    applyModeLayout();
    el.cardStart.classList.add('hidden');
    el.cardPause.classList.add('hidden');
    el.cardOver.classList.add('hidden');
    resetGame();
    resetTools();
    resetWeather();
    garden.quiet = true;   // no level-up note for the garden a run starts with
    Z.pages = 1; Z.locks = 0; Z.turnAt = 0;
    G.level = G.mode === 'classic' ? C.index + 1 : 1;
    C.reminded = false;
    C.reminderThisTurn = false;
    C.resultAt = 0;
    lastClearVoiceAt = -Infinity;
    G.state = 'playing';
    spawnNext();
    updateHUD();
    drawHold();
    drawNext();
    ensureAudio();
    if (SETTINGS.music && AC) startMusic();
    if (G.mode === 'classic' || retry) speakVoice(retry ? 'retry' : C.index === 0 ? 'start' : 'next');
    document.activeElement.blur();
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
    G.dew = null;
    G.bankDew = null;
    G.frog = null;
    G.bankFrog = null;
    G.hopper = null;
    G.danger = false;
    particles.length = 0;
    G.showOverAt = 0;
    resetInput();
    dropTrails.length = 0;
    lockPulses.length = 0;
    G.state = 'playing';
    G.overReveal = 0;
    G.overStart = 0;
    drawNext();
    drawHold();
  }

  function restartGame() {
    if (G.mode === 'classic' && C.cleared.includes(C.index)) return;
    E.recordAtStart = E.best;
    startStage(true);
  }

  function togglePause() {
    if (['playing', 'clearing', 'tool', 'page-turn', 'stage-burst'].includes(G.state)) {
      G.pauseState = G.state;
      G.pauseTime = G.time;
      resetInput();
      G.state = 'paused';
      el.cardPause.classList.remove('hidden');
      stopMusic();
      stopVoice();
    } else if (G.state === 'paused') {
      G.state = G.pauseState || 'playing';
      if (G.state === 'clearing') G.clearStart += G.time - G.pauseTime;
      if (G.state === 'stage-burst') C.resultAt += G.time - G.pauseTime;
      if (G.state === 'page-turn') Z.turnAt += G.time - G.pauseTime;
      if (G.state === 'tool') T.until += G.time - G.pauseTime;
      el.cardPause.classList.add('hidden');
      if (SETTINGS.music && AC) startMusic();
    }
  }

  // Classic and endless end the run; a full 静页 page simply turns over.
  function topOut() {
    if (G.mode !== 'zen') { gameOver(); return; }
    if (G.active) G.queue.unshift(G.active.type);   // the piece that did not fit opens the next page
    G.active = null;
    G.state = 'page-turn';
    Z.turnAt = G.time + (reducedMotion() ? 150 : PAGE_TURN_MS);
    resetInput();
    sfx.pageTurn();
  }

  function finishPageTurn() {
    G.board = emptyBoard();
    G.dew = null;
    G.frog = null;
    G.hopper = null;
    Z.pages++;
    TOOL_KINDS.forEach(grantTool);   // a fresh page comes with one more of each
    G.combo = -1;
    G.b2b = false;
    G.canHold = true;
    particles.length = dropTrails.length = lockPulses.length = 0;
    G.state = 'playing';
    spawnNext();
  }

  function gameOver() {
    G.active = null;
    G.state = 'over';
    G.overReveal = 0;
    stopMusic();
    resetInput();
    sfx.gameOver();
    const endless = G.mode === 'endless';
    const isBest = endless ? G.score > E.recordAtStart : C.total + G.score > G.best;
    if (!endless && isBest) { G.best = C.total + G.score; saveBest(); }
    $('over-stage').textContent = endless ? '无限模式 · 共消除 ' + G.lines + ' 行' : '第 ' + (C.index + 1) + ' 关 · 还差 ' + formatScore(Math.max(0, STAGES[C.index].target - G.score)) + ' 分';
    $('over-score-label').textContent = endless ? '本局得分' : '本关得分';
    $('over-best-label').textContent = endless ? '最高分' : '最佳总分';
    el.playAgain.textContent = endless ? '再来一局 (R)' : '重试本关 (R)';
    el.overScore.textContent = formatScore(G.score);
    el.overBest.textContent = formatScore(endless ? E.best : G.best);
    el.newBest.classList.toggle('hidden', !isBest);
    // show the card after the grey-out reveal
    el.cardOver.classList.add('hidden');
    G.showOverAt = G.time + 900;
    G.overStart = G.time;
    shake(8, 300);
    speakVoice('retry', null, 2);
  }

  /* ==========================================================================
     21. Update loop
     ========================================================================== */

  function dropIntervalMs() {
    // Gradual acceleration per cleared line, with a playable 180 ms floor.
    if (G.mode === 'zen') return 1000;
    const speed = WEATHER[W.kind].speed;
    if (G.mode === 'endless') return Math.round(Math.max(180, Math.round(1000 * Math.pow(.988, G.lines))) * speed);
    return Math.round(STAGES[C.index].gravity * speed);
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

    if (G.state === 'playing' || G.state === 'clearing') updateWeather(dt);
    updateGlow(dt);
    updateGarden(dt);
    if (G.state === 'playing') {
      updateDAS(dt);
      if (G.state === 'playing') updateSoftDrop(dt);
      if (G.state === 'playing') updateGravity(dt);
      if (G.state === 'playing') updateHopper(dt);
      if (G.state === 'playing') updatePieceVisual(dt);
    } else if (G.state === 'clearing') {
      if (G.time - G.clearStart >= G.clearDuration) finalizeClear();
    } else if (G.state === 'tool') {
      if (G.time >= T.until) { T.gust = 0; finishTool(); }
    } else if (G.state === 'page-turn') {
      if (G.time >= Z.turnAt) finishPageTurn();
    } else if (G.state === 'stage-burst') {
      if (G.time >= C.resultAt) showStageResult();
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
    updateRain(dt);
    drawBoard();
    drawNext();
    updateHUD();

    requestAnimationFrame(loop);
  }

  /* ==========================================================================
     Mode selection, suspension and turn settlement.
     ========================================================================== */

  function resetInput() {
    Object.keys(keys).forEach(key => delete keys[key]);
    touchStops.forEach(stop => stop());
    G.das = { dir: 0, timer: 0, arr: 0 };
    G.softDrop = { active: false, timer: 0 };
  }

  function hideGameScreens() {
    ['menu-screen', 'stage-result', 'celebration-confetti'].forEach(id => { $(id).hidden = true; });
    el.cardPause.classList.add('hidden');
    el.cardOver.classList.add('hidden');
    el.cardStart.classList.add('hidden');
    MENU.resumeState = null;
    resetInput();
  }

  function applyModeLayout() {
    el.sheet.classList.add('game-mode');
    applySettings();
    $('stage-stat').hidden = G.mode !== 'classic';
    layout();
  }

  function renderMenu() {
    const endless = MENU.selectedMode === 'endless', zen = MENU.selectedMode === 'zen';
    ['classic', 'endless', 'zen'].forEach(mode => {
      const selected = mode === MENU.selectedMode;
      $('mode-' + mode).classList.toggle('selected', selected);
      $('mode-' + mode).setAttribute('aria-pressed', String(selected));
      $(mode + '-description').hidden = !selected;
    });
    $('book-footnote').textContent = zen ? '静页不记录分数，随时可以合上。' : endless ? '最高分自动保存在此浏览器。刷新或重开会开始新的一局。' : '闯关进度和最佳总分保存在此浏览器，刷新后可以继续上次闯关。';
    $('endless-record').textContent = formatScore(E.best);
    $('begin-game').textContent = zen ? '翻开静页 →' : endless ? '开始无限挑战 →' : '从第 ' + String(MENU.selectedStage + 1).padStart(2, '0') + ' 关出发 →';
    $('stage-roadmap').innerHTML = STAGES.map((stage, i) => '<button type="button" class="roadmap-stop' + (MENU.selectedStage === i ? ' selected' : '') + '" data-stage="' + i + '" aria-pressed="' + (MENU.selectedStage === i) + '" aria-label="第 ' + (i + 1) + ' 关，目标 ' + stage.target + ' 分"><span>' + String(i + 1).padStart(2, '0') + '</span><strong>' + formatScore(stage.target) + '</strong><small>' + stage.name + '</small></button>').join('');
    const stage = STAGES[MENU.selectedStage];
    $('stage-music').textContent = '♫ 本关声景 · ' + MUSIC_TRACKS[MENU.selectedStage].title;
    $('stage-selection').textContent = '已选第 ' + (MENU.selectedStage + 1) + ' 关 · ' + stage.name + ' · ' + (stage.gravity / 1000).toFixed(2) + ' 秒 / 格';
    const saved = savedRun();
    $('continue-run').hidden = !saved || (!!MENU.resumeState && G.mode === 'classic');
    if (saved) $('continue-run').textContent = '继续上次闯关 · 已完成 ' + saved.cleared.length + ' 关 · ' + formatScore(saved.total) + ' 分';
    drawMenuGarden();
    $('resume-game').hidden = !MENU.resumeState;
    $('resume-game').textContent = '继续' + (G.mode === 'zen' ? '静页' : G.mode === 'endless' ? '无限模式' : '经典闯关');
  }

  function openMenu() {
    if (G.state === 'menu') return;
    const resumable = ['playing', 'clearing', 'tool', 'page-turn', 'paused', 'stage-burst', 'stage-won', 'complete'].includes(G.state);
    MENU.resumeState = resumable ? G.state : null;
    MENU.suspendedAt = G.time;
    MENU.selectedMode = G.mode;
    if (G.mode === 'classic') MENU.selectedStage = C.index;
    G.state = 'menu';
    resetInput();
    stopMusic();
    stopVoice();
    $('stage-result').hidden = true;
    $('celebration-confetti').hidden = true;
    $('menu-screen').hidden = false;
    renderMenu();
  }

  function closeMenu() {
    if (!MENU.resumeState) return;
    G.state = MENU.resumeState;
    if (G.state === 'clearing') G.clearStart += G.time - MENU.suspendedAt;
    if (G.state === 'stage-burst') C.resultAt += G.time - MENU.suspendedAt;
    if (G.state === 'page-turn') Z.turnAt += G.time - MENU.suspendedAt;
    if (G.state === 'tool') T.until += G.time - MENU.suspendedAt;
    if (['stage-won', 'complete'].includes(G.state)) {
      $('stage-result').hidden = false;
      $('celebration-confetti').hidden = false;
    }
    MENU.resumeState = null;
    $('menu-screen').hidden = true;
    resetInput();
    document.activeElement.blur();
    if (SETTINGS.music && AC) startMusic();
  }

  function launchSelection() {
    ensureAudio();
    startGame(MENU.selectedMode, MENU.selectedStage);
    document.activeElement.blur();
  }

  function finishTurn(clearedCells = []) {
    if (G.mode === 'classic' && G.score >= STAGES[C.index].target) { finishStage(clearedCells); return; }
    C.reminderThisTurn = false;
    checkDanger();
    if (!G.active) spawnNext();   // after wind or flood the same piece keeps falling
  }

  function bindMenu() {
    ['classic', 'endless', 'zen'].forEach(mode => {
      $('mode-' + mode).onclick = () => { MENU.selectedMode = mode; renderMenu(); };
    });
    $('stage-roadmap').onclick = e => {
      const button = e.target.closest('[data-stage]');
      if (!button) return;
      const index = Number(button.dataset.stage);
      if (!Number.isInteger(index) || index < 0 || index >= STAGES.length) return;
      MENU.selectedStage = index;
      renderMenu();
      $('stage-roadmap').querySelector('[data-stage="' + index + '"]').focus({ preventScroll: true });
    };
    TOOL_KINDS.forEach(kind => {
      $('tool-' + kind).onclick = () => { ensureAudio(); useTool(kind); document.activeElement.blur(); };
    });
    $('begin-game').onclick = launchSelection;
    $('resume-game').onclick = closeMenu;
    $('continue-run').onclick = () => { continueRun(); document.activeElement.blur(); };
    $('menu-button').onclick = openMenu;
    $('resume-pause').onclick = () => { togglePause(); document.activeElement.blur(); };
    $('next-stage').onclick = advanceStage;
    document.querySelectorAll('.back-to-book').forEach(b => { b.onclick = openMenu; });
    G.state = 'start';
    openMenu();
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
    if (document.hidden) stopVoice();
    if (document.hidden && ['playing', 'clearing', 'tool', 'page-turn', 'stage-burst'].includes(G.state)) {
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
        started: !['start', 'menu'].includes(G.state) || !!MENU.resumeState,
        board: visBoard,
        active: G.active ? G.active.type : null,
        hold: G.bank,
        next: G.queue.slice(0, 3),
        combo: G.combo,
        b2b: G.b2b,
        status: G.state,
        mode: G.mode,
        best: G.mode === 'endless' ? E.best : G.best,
        gravity: dropIntervalMs(),
        weather: W.kind,
        dew: G.dew ? { x: G.dew.x, y: G.dew.y - HIDDEN, left: G.dew.left } : null,
        activeDew: !!(G.active && G.active.dew),
        frog: G.frog ? { x: G.frog.x, y: G.frog.y - HIDDEN } : null,
        activeFrog: !!(G.active && G.active.frog),
        hopper: G.hopper ? { left: G.hopper.left, muds: G.hopper.muds, x: G.hopper.x } : null,
        garden: { level: Math.floor(gardenTarget() + 1e-9), growth: gardenTarget(), best: gardenGrowth(G.best) },
        savedRun: savedRun(),
        gardenFrog: G.time < garden.frogUntil,
        danger: !!G.danger,
        tools: { bolt: T.bolt, wind: T.wind, flood: T.flood, windDir: T.windDir },
        zen: G.mode === 'zen' ? { pages: Z.pages, placed: Z.locks, grain: el.grainLayer.className } : null,
        campaign: G.mode === 'classic' ? { stage: C.index + 1, target: STAGES[C.index].target, gravity: dropIntervalMs(),
          passed: C.passed, cleared: C.cleared.map(i => i + 1), total: C.total, totalLines: C.totalLines, reminded: C.reminded,
          complete: C.passed === STAGES.length } : null,
        music: { id: currentMusicTrack().id, title: currentMusicTrack().title, status: music.status, playing: music.playing, offset: music.offset },
        voice: lastVoice,
        piece: G.active ? { type: G.active.type, x: G.active.x, y: G.active.y, rot: G.active.rot } : null
      };
    },
    start: startGame,
    restart: restartGame,
    pause: togglePause,
    settings: SETTINGS,
    openMenu: openMenu,
    useTool: useTool,
    debugGarden: function (growth) { garden.debug = growth; },   // hold the drawn garden at one growth, for visual checks
    debugWeather: function (kind) { setWeather(kind); W.rainbow = W.kind === 'clear' ? 1 : 0; },   // no fade-in, for visual checks
    debugStrike: skyStrike,
    debugDew: function () { if (G.active) G.active.dew = randomDewCell(G.active.type); },
    debugFrog: function () { if (G.active) G.active.frog = randomDewCell(G.active.type); },
    debugFrogRandom: function (fn) { frogRandom = fn || Math.random; },
    debugTransition: function (kind, age) {   // hold a tool transition at one moment, for visual checks
      T.fx = kind ? { kind: kind, t: G.time, hold: age, dir: -1, seed: 12345, tx: rain.w * .5, ty: rain.h * .45 } : null;
    },
    debugBoard: function (rows) {   // rows of 10 chars from the bottom up; '.' is empty
      G.board = emptyBoard();
      rows.forEach((row, i) => { G.board[ROWS_TOTAL - 1 - i] = row.split('').map(c => c === '.' ? null : c); });
    },
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
    bindMenu();
    updateHUD();
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
