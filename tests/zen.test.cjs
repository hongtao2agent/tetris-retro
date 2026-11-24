const { test } = require('node:test');
const assert = require('node:assert/strict');
const { session } = require('./session.cjs');

function zen(saved, options) {
  const s = session(saved, options);
  s.click('mode-zen'); s.click('begin-game');
  return s;
}

function fillPage(s) {
  for (let i = 0; i < 40 && s.state().status === 'playing'; i++) { s.key(' ', 'Space'); s.tick(32); }
}

test('quiet page never ends: a full page turns over and play continues', () => {
  const s = zen();
  assert.equal(s.state().mode, 'zen');
  assert.equal(s.state().zen.pages, 1);
  fillPage(s);
  assert.equal(s.state().status, 'page-turn');
  assert.equal(s.state().over, false);
  const waiting = s.state().next[0];
  s.tick(1000);
  const after = s.state();
  assert.equal(after.status, 'playing');
  assert.equal(after.zen.pages, 2);
  assert.ok(after.board.every(row => row.every(cell => !cell)), 'new page is blank');
  assert.equal(after.active, waiting, 'the piece that did not fit opens the next page');
  assert.equal(s.element('card-over').classList.contains('hidden'), true);
  fillPage(s); s.tick(1000);
  assert.equal(s.state().zen.pages, 3);
});

test('quiet page keeps one speed, has no stage, voice or saved record', () => {
  const s = zen();
  assert.equal(s.state().gravity, 1000);
  assert.equal(s.element('stage-stat').hidden, true);
  for (let i = 0; i < 30; i++) {
    s.api.debugSetRows(4);
    s.key('ArrowUp');
    for (let n = 0; n < 5; n++) s.key('ArrowLeft');
    s.key(' ', 'Space'); s.tick();
  }
  const state = s.state();
  assert.equal(state.lines, 120);
  assert.equal(state.gravity, 1000, 'no acceleration');
  assert.equal(state.status, 'playing');
  assert.equal(state.voice, null, 'no praise voice');
  assert.equal(state.campaign, null);
  assert.equal(s.storage.size, 0, 'nothing is recorded');
  assert.match(s.element('best-value').textContent, /第 1 页/);
});

test('quiet page drops the scanlines and uses its own soundtrack; other modes keep theirs', () => {
  const s = zen();
  assert.match(s.state().zen.grain, /grain-zen/);
  assert.equal(s.state().music.id, 'zen');
  s.api.openMenu(); s.click('mode-endless'); s.click('begin-game');
  assert.equal(s.state().zen, null);
  assert.equal(s.state().music.id, 'endless');
  assert.doesNotMatch(s.element('grain-layer').className, /grain-zen/);
});

test('a page turn survives pause and the menu', () => {
  const s = zen();
  fillPage(s);
  assert.equal(s.state().status, 'page-turn');
  s.key('p'); s.tick(2000);
  assert.equal(s.state().paused, true);
  assert.equal(s.state().zen.pages, 1);
  s.key('p');
  assert.equal(s.state().status, 'page-turn');
  s.api.openMenu(); s.tick(2000); s.click('resume-game');
  assert.equal(s.state().status, 'page-turn');
  s.tick(1000);
  assert.equal(s.state().status, 'playing');
  assert.equal(s.state().zen.pages, 2);
});
