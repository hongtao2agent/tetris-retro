const { test } = require('node:test');
const assert = require('node:assert/strict');
const { session } = require('./session.cjs');

function start(mode, saved, options) {
  const s = session(saved, options);
  if (mode !== 'classic') s.click('mode-' + mode);
  s.click('begin-game');
  return s;
}
function clear(s, rows = 4) {
  s.api.debugSetRows(rows); s.key('ArrowUp');
  for (let i = 0; i < 5; i++) s.key('ArrowLeft');
  s.key(' ', 'Space'); s.tick();
}
const bottom = (s, n = 0) => s.state().board[19 - n].map(cell => cell || '.').join('');

test('a downpour falls faster and pays half again; a clear sky pays double; both pass', () => {
  const s = start('endless');
  assert.equal(s.state().weather, 'drizzle');
  assert.equal(s.element('sheet-title').textContent, 'GRAPHITE BLOCKS');
  clear(s, 1);
  const drop = s.state().score - 100;   // hard-drop points; each clear leaves three cells behind, so the next drop is 6 points shorter
  assert.ok(drop > 0 && drop < 50, 'a single plus the hard drop, in plain drizzle');
  s.api.debugWeather('downpour');
  assert.equal(s.state().gravity, Math.round(Math.round(1000 * Math.pow(.988, 1)) * .8));
  assert.match(s.element('sheet-title').textContent, /雨势变大/);
  assert.match(s.element('voice-caption').textContent, /得分 ×1\.5/);
  let before = s.state().score;
  clear(s, 1);
  assert.equal(s.state().score - before, 150 + 50 * 1.5 + drop - 6, 'single and combo, both ×1.5; drops are not multiplied');
  s.api.debugWeather('clear');
  assert.equal(s.state().gravity, Math.round(1000 * Math.pow(.988, 2)), 'back to normal speed');
  before = s.state().score;
  clear(s, 1);
  assert.equal(s.state().score - before, (100 + 100) * 2 + drop - 12);
  for (let i = 0; i < 12 && s.state().weather === 'clear'; i++) { s.key(' ', 'Space'); s.tick(3000); if (s.state().over) s.key('r', 'KeyR'); }
  assert.equal(s.state().weather, 'drizzle', 'the weather ends by itself');
});

test('weather only moves on play time, and every new run starts in drizzle', () => {
  const s = start('endless');
  s.api.debugWeather('clear');
  s.key('p'); s.tick(60000);
  assert.equal(s.state().weather, 'clear', 'a pause holds it');
  s.key('p');
  s.api.openMenu(); s.tick(60000); s.click('resume-game');
  assert.equal(s.state().weather, 'clear', 'so does the menu');
  s.key('r', 'KeyR');
  assert.equal(s.state().weather, 'drizzle');
});

test('a storm strike knocks one cell out of the highest row and leaves the falling piece alone', () => {
  const s = start('endless');
  s.api.debugSetRows(0);
  s.api.debugBoard(['JJJJJJJJ..', 'LLLL......', '..S.......']);
  const hit = s.api.debugStrike();
  assert.deepEqual([hit.x, hit.y], [2, 19], 'the only cell in the top row');
  assert.equal(bottom(s, 2), '..........');
  assert.equal(bottom(s, 1), 'LLLL......');
  assert.equal(s.state().status, 'playing');
  assert.equal(s.state().active, 'I');
  s.api.debugBoard([]);
  assert.equal(s.api.debugStrike(), null, 'nothing to hit on a blank page');
});

test('a dewdrop rides its piece, and clearing its row brings a tool', () => {
  const s = start('endless');
  s.api.debugSetRows(4);
  s.api.debugDew();
  assert.equal(s.state().activeDew, true);
  s.key('ArrowUp');
  for (let i = 0; i < 5; i++) s.key('ArrowLeft');
  s.key(' ', 'Space');
  assert.equal(s.state().status, 'clearing');
  assert.equal(s.state().dew.x, 0, 'it landed in the column the piece filled');
  s.tick();
  const tools = s.state().tools;
  assert.equal(s.state().dew, null);
  assert.equal(tools.bolt + tools.wind + tools.flood, 5, 'one for the four lines, one for the dew');
  assert.match(s.element('voice-caption').textContent, /包裹/);
});

test('an uncaught dewdrop sinks with its block, follows the wind and dries after four more pieces', () => {
  const s = start('endless');
  s.api.debugSetRows(0);
  s.api.debugBoard(['JJJJJJJJJ.', '.L.L......']);
  s.api.debugDew();
  s.key(' ', 'Space'); s.tick();
  const dew = s.state().dew;
  assert.ok(dew && dew.y === 17, 'resting on the pile');
  s.key('2'); s.tick(1000);
  const blown = s.state().dew;
  assert.equal(s.state().board[blown.y][blown.x], 'I', 'still on its own block after the wind');
  assert.equal(blown.x, dew.x - 3, 'the piece slid from columns 3-6 to 0-3');
  s.api.debugSetRows(0); s.key('ArrowUp');
  for (let i = 0; i < 6; i++) s.key('ArrowRight');
  s.key(' ', 'Space'); s.tick();
  assert.equal(s.state().lines, 1);
  assert.equal(s.state().dew.y, blown.y + 1, 'the row below went: it sank one row');
  assert.equal(s.state().dew.left, 3, 'one piece has landed since');
  for (let i = 0; i < 2; i++) { s.api.debugBoard([]); s.key(' ', 'Space'); s.tick(); }
  assert.equal(s.state().dew.left, 1, 'still there after three');
  s.api.debugBoard([]); s.key(' ', 'Space'); s.tick();
  assert.equal(s.state().dew, null, 'dried up on the fourth');
});

test('a tall pile is flagged as danger and a run of clears warms the page', () => {
  const s = start('endless');
  assert.equal(s.state().danger, false);
  s.api.debugSetRows(0);
  s.api.debugBoard(Array.from({ length: 14 }, () => 'J.........'));
  s.key(' ', 'Space'); s.tick();
  assert.equal(s.state().danger, true);
  s.api.debugBoard([]); s.key(' ', 'Space'); s.tick();
  assert.equal(s.state().danger, false);
  clear(s); clear(s); clear(s);
  assert.ok(Number(s.element('sheet-glow').style.opacity) > 0, 'combo glow');
});

test('live play schedules its own weather; 静页 never gets the downpour', () => {
  const s = start('zen', {}, { live: true });
  const seen = new Set();
  for (let i = 0; i < 400; i++) { s.tick(1000); seen.add(s.state().weather); }
  assert.ok(seen.has('storm') || seen.has('clear'), 'something happened in 400 seconds');
  assert.equal(seen.has('downpour'), false);
});
