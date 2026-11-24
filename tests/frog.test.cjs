const { test } = require('node:test');
const assert = require('node:assert/strict');
const { session } = require('./session.cjs');

function start(mode) {
  const s = session();
  if (mode !== 'classic') s.click('mode-' + mode);
  s.click('begin-game');
  return s;
}
const count = (s, type) => s.state().board.flat().filter(cell => cell === type).length;
const column = (s, x) => s.state().board.map(row => row[x] || '.').join('').replace(/^\.+/, '');
// Script the frog: each value answers one of its random choices, in order.
function script(s, values) { let i = 0; s.api.debugFrogRandom(() => values[i++ % values.length]); }
// A frog rides the I piece into the open column and the four completed rows clear.
// `above` is what sits on those four rows and is left standing afterwards.
function freeFrog(s, above = []) {
  s.api.debugSetRows(4);
  s.api.debugBoard(Array.from({ length: 4 }, () => '.JJJJJJJJJ').concat(above));
  s.api.debugFrog();
  s.key('ArrowUp');
  for (let i = 0; i < 5; i++) s.key('ArrowLeft');
  s.key(' ', 'Space');
}

test('the frog rides its piece and sits in the pile until its row is cleared', () => {
  const s = start('endless');
  s.api.debugSetRows(0);
  s.api.debugBoard(['JJJ......J']);
  s.api.debugFrog();
  assert.equal(s.state().activeFrog, true);
  s.key(' ', 'Space'); s.tick();
  const frog = s.state().frog;
  assert.ok(frog && frog.y === 19 && frog.x >= 3 && frog.x <= 6, 'it landed with the piece');
  for (let i = 0; i < 8; i++) { s.api.debugSetRows(0); s.key('ArrowUp'); s.key('ArrowLeft'); s.key('ArrowLeft'); s.key('ArrowLeft'); s.key(' ', 'Space'); s.tick(); }
  assert.deepEqual(s.state().frog, frog, 'unlike a dewdrop it does not leave by itself');
  assert.equal(s.state().hopper, null);
});

test('clearing its row frees the frog: a bonus, three hops, then it is gone', () => {
  const s = start('endless');
  // answers: column 1, mud; column 9, mud; column 2 (the mud limit is reached, so a stomp)
  script(s, [0, 0, .99, 0, .25]);
  freeFrog(s, ['.SSS..SSSS', '.ZZZ..ZZZZ']);
  const before = s.state().score;
  s.tick();
  assert.equal(s.state().score - before, 800 + 200, 'four lines plus the frog bonus');
  assert.match(s.element('voice-caption').textContent, /青蛙/);
  assert.deepEqual([s.state().hopper.left, s.state().frog], [3, null]);
  s.tick(450);
  assert.equal(count(s, 'M'), 1, 'first landing: mud');
  assert.equal(column(s, 1), 'MZS', 'on top of column 1');
  s.tick(450);
  assert.equal(column(s, 9), 'MZS', 'second landing: mud on the last column');
  assert.equal(s.state().hopper.muds, 2);
  s.tick(450);
  assert.equal(count(s, 'M'), 2, 'third landing had to be a stomp: no third mud');
  assert.equal(column(s, 2), 'S', 'and it flattened the top of column 2');
  assert.equal(s.state().hopper.left, 0);
  s.tick(600);
  assert.equal(s.state().hopper, null, 'hopped off the board');
  assert.equal(s.state().gardenFrog, true, 'and into the garden for a while');
  s.tick(10000);
  assert.equal(s.state().gardenFrog, false);
  assert.equal(s.state().status, 'playing');
});

test('mud never tops a tall column, never completes a row, and 静页 frogs only stomp', () => {
  const s = start('endless');
  script(s, [.99, 0]);   // the last column, and "mud" if it is allowed
  freeFrog(s, Array.from({ length: 14 }, () => '.........J'));
  s.tick(); s.tick(450);
  assert.equal(count(s, 'M'), 0, 'column 9 is too tall for mud');
  assert.equal(column(s, 9).length, 13, 'so the frog stomped it instead');

  const full = start('endless');
  script(full, [.12, 0]);   // column 1, "mud"
  full.api.debugSetRows(0);
  full.api.debugBoard(['J.JJJJJJJJ', 'JJJ....JJJ']);
  full.api.debugFrog();
  full.key(' ', 'Space'); full.tick(); full.tick(450);
  assert.equal(full.state().lines, 1);
  assert.equal(full.state().hopper.left, 2, 'it has landed once');
  assert.equal(count(full, 'M'), 0, 'mud in column 1 would have completed the bottom row');

  const zen = start('zen');
  script(zen, [0, 0]);
  freeFrog(zen, ['.SSS..SSSS', '.ZZZ..ZZZZ']);
  zen.tick(); zen.tick(2500);
  assert.equal(count(zen, 'M'), 0);
  assert.equal(zen.state().hopper, null);
  assert.ok(count(zen, 'S') + count(zen, 'Z') < 14, 'it stomped a few flat');
});

test('the frog waits out a pause, follows the wind, and a restart sends it away', () => {
  const s = start('endless');
  script(s, [0, .99]);
  freeFrog(s, ['.SSS..SSSS']);
  s.tick();
  s.key('p'); s.tick(5000);
  assert.equal(s.state().hopper.left, 3, 'mid-air while paused');
  s.key('p'); s.tick(450);
  assert.equal(s.state().hopper.left, 2);
  s.key('r', 'KeyR');
  assert.equal(s.state().hopper, null);

  s.api.debugSetRows(0);
  s.api.debugBoard(['JJJJJJJJJ.']);
  s.api.debugFrog();
  s.key(' ', 'Space'); s.tick();
  const sat = s.state().frog;
  s.key('2'); s.tick(1000);
  assert.equal(s.state().frog.x, sat.x - 3, 'blown left with its block');
  assert.equal(s.state().board[s.state().frog.y][s.state().frog.x], 'I');
});
