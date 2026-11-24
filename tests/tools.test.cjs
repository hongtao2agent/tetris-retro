const { test } = require('node:test');
const assert = require('node:assert/strict');
const { session } = require('./session.cjs');

function start(mode, saved, options) {
  const s = session(saved, options);
  if (mode !== 'classic') s.click('mode-' + mode);
  s.click('begin-game');
  return s;
}
// A known falling piece (a flat I over columns 3-6) above a board given from the bottom row up.
function arrange(s, rows) { s.api.debugSetRows(0); s.api.debugBoard(rows); }
const bottom = (s, n = 0) => s.state().board[19 - n].map(cell => cell || '.').join('');
function fourLines(s) {
  s.api.debugSetRows(4); s.key('ArrowUp');
  for (let i = 0; i < 5; i++) s.key('ArrowLeft');
  s.key(' ', 'Space'); s.tick();
}

test('every mode starts with one of each tool, and a restart hands them back', () => {
  for (const mode of ['classic', 'endless', 'zen']) {
    const s = start(mode);
    assert.deepEqual(s.state().tools, { bolt: 1, wind: 1, flood: 1, windDir: -1 }, mode);
    assert.equal(s.element('tool-bolt-count').textContent, '1');
  }
  const s = start('endless');
  arrange(s, ['J........J']); s.key('3'); s.tick();
  assert.equal(s.state().tools.flood, 0);
  assert.equal(s.element('tool-flood').classList.contains('empty'), true);
  s.key('r', 'KeyR');
  assert.equal(s.state().tools.flood, 1);
});

test('lightning splits the falling piece into four cells that each drop down their own column', () => {
  const s = start('endless');
  arrange(s, ['JJJ.JJ.JJJ']);
  s.key('1');
  assert.equal(s.state().status, 'tool');
  assert.equal(s.state().active, null);
  assert.equal(bottom(s), 'JJJIJJIJJJ', 'two cells fell into the gaps');
  assert.equal(bottom(s, 1), '....II....', 'two cells landed on top');
  s.tick(1000);
  const state = s.state();
  assert.equal(state.status, 'playing');
  assert.equal(bottom(s), '....II....', 'the completed row was cleared');
  assert.equal(state.lines, 1);
  assert.equal(state.score, 50, 'a row cleared by a tool scores half');
  assert.equal(state.combo, -1, 'and does not start a combo');
  assert.deepEqual([state.tools.bolt, state.tools.wind, state.tools.flood], [0, 1, 1], 'nor bring a new tool');
  assert.ok(state.active, 'the next piece arrives');
});

test('wind packs every row to the side last moved toward and keeps the falling piece', () => {
  const s = start('endless');
  arrange(s, ['J.L.J.L.J.', '.S.S.S.S.S']);
  s.key('ArrowRight');
  assert.equal(s.state().tools.windDir, 1);
  s.click('tool-wind');
  assert.equal(bottom(s), '.....JLJLJ');
  assert.equal(bottom(s, 1), '.....SSSSS');
  s.tick(1000);
  assert.equal(s.state().status, 'playing');
  assert.equal(s.state().active, 'I');
  assert.equal(s.state().tools.wind, 0);
  assert.equal(s.state().score, 0);
  s.key('ArrowLeft'); s.key('2');
  assert.equal(bottom(s), '.....JLJLJ', 'an empty tool does nothing');

  const still = start('endless');
  arrange(still, ['JJJ.......']);
  still.key('2');
  assert.equal(still.state().tools.wind, 1, 'a gust that would move nothing is not spent');
  assert.equal(still.state().status, 'playing');
});

test('flood fills and clears the lowest row, lifting the falling piece out of the way', () => {
  const s = start('endless');
  arrange(s, ['J........J', 'JJ.......J']);
  for (let i = 0; i < 40; i++) s.key('ArrowDown');   // rest the piece in the bottom row's gap
  const resting = s.state().piece.y;
  s.key('3');
  assert.equal(bottom(s), 'JWWWWWWWWJ');
  assert.ok(s.state().piece.y < resting, 'the piece is lifted above the water');
  s.tick(1000);
  const state = s.state();
  assert.equal(bottom(s), 'JJ.......J');
  assert.equal(state.lines, 1);
  assert.equal(state.active, 'I');
  assert.equal(state.tools.flood, 0);

  const empty = start('endless');
  empty.api.debugBoard([]);
  empty.key('3');
  assert.equal(empty.state().tools.flood, 1, 'nothing to flood on a blank page');
});

const held = s => { const t = s.state().tools; return t.bolt + t.wind + t.flood; };

test('four lines at once bring one random tool, fewer bring none, and three of each is the most', () => {
  const s = start('endless');
  s.api.debugSetRows(3); s.key('ArrowUp');
  for (let i = 0; i < 5; i++) s.key('ArrowLeft');
  s.key(' ', 'Space'); s.tick();
  assert.equal(s.state().lines, 3);
  assert.equal(held(s), 3, 'a triple brings nothing');
  const seen = new Set();
  for (let n = 1; n <= 6; n++) {
    const before = s.state().tools;
    fourLines(s);
    const after = s.state().tools;
    assert.equal(held(s), 3 + n, 'one more per four-line clear');
    ['bolt', 'wind', 'flood'].filter(kind => after[kind] > before[kind]).forEach(kind => seen.add(kind));
    assert.ok(Math.max(after.bolt, after.wind, after.flood) <= 3);
  }
  assert.deepEqual(s.state().tools, { bolt: 3, wind: 3, flood: 3, windDir: -1 }, 'all full after six');
  fourLines(s);
  assert.equal(held(s), 9, 'nothing more once every tool is full');
  assert.equal(seen.size, 3);
});

test('a new stage resets tools; a new quiet page adds one of each', () => {
  const s = start('classic');
  fourLines(s);
  assert.equal(held(s), 4);
  for (let i = 0; i < 12 && s.state().status === 'playing'; i++) fourLines(s);
  s.tick(3000);
  assert.equal(s.state().status, 'stage-won');
  s.click('next-stage');
  assert.deepEqual(s.state().tools, { bolt: 1, wind: 1, flood: 1, windDir: -1 });

  const zen = start('zen');
  for (let i = 0; i < 40 && zen.state().status === 'playing'; i++) { zen.key(' ', 'Space'); zen.tick(32); }
  zen.tick(1000);
  assert.equal(zen.state().zen.pages, 2);
  assert.deepEqual([zen.state().tools.bolt, zen.state().tools.wind, zen.state().tools.flood], [2, 2, 2]);
});

test('a tool in progress survives pause and the menu', () => {
  const s = start('endless');
  arrange(s, ['JJJ.JJ.JJJ']);
  s.key('1');
  s.key('p'); s.tick(2000);
  assert.equal(s.state().paused, true);
  s.key('p');
  assert.equal(s.state().status, 'tool');
  s.api.openMenu(); s.tick(2000); s.click('resume-game');
  assert.equal(s.state().status, 'tool');
  s.tick(1000);
  assert.equal(s.state().status, 'playing');
  assert.equal(s.state().lines, 1);
});
