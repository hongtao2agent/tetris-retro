const { test } = require('node:test');
const assert = require('node:assert/strict');
const { session } = require('./session.cjs');

const BEST = 'graphiteBlocksEndlessBestV1';
const CLASSIC_BEST = 'graphiteBlocksCampaignBestV1';

function endless(saved, options) {
  const s = session(saved, options);
  s.click('mode-endless'); s.click('begin-game');
  return s;
}

function clear(s, rows = 4, settle = true) {
  s.api.debugSetRows(rows);
  s.key('ArrowUp');
  for (let i = 0; i < 5; i++) s.key('ArrowLeft');
  s.key(' ', 'Space');
  if (settle) s.tick();
}

function topOut(s) {
  for (let i = 0; i < 40 && s.state().status === 'playing'; i++) {
    s.key(' ', 'Space'); s.tick();
  }
  assert.equal(s.state().status, 'over');
  s.tick(1000);
}

test('endless keeps scoring past 100,000 with no stage, reset, target reminder or completion', () => {
  const s = endless();
  let previous = 0, speed = s.state().gravity;
  assert.equal(speed, 1000);
  assert.equal(s.element('stage-stat').hidden, true);
  for (let i = 0; i < 50; i++) {
    clear(s);
    const state = s.state();
    assert.equal(state.status, 'playing');
    assert.equal(state.campaign, null);
    assert.equal(state.level, 1, 'no hidden stage scoring multiplier');
    assert.ok(state.score > previous);
    assert.ok(state.gravity <= speed && state.gravity >= 180);
    assert.ok(!['near', 'passed', 'complete', 'next'].includes(state.voice?.key));
    previous = state.score; speed = state.gravity;
  }
  assert.ok(previous > 100000);
  assert.equal(s.state().lines, 200);
  assert.equal(speed, 180);
  assert.equal(s.element('stage-result').hidden, true);
  assert.equal(s.element('celebration-confetti').hidden, true);
  assert.match(s.element('best-value').textContent, /^最高分 /);
  assert.equal(Number(s.storage.get(BEST)), previous);
});

test('endless high score survives reload and restart without changing classic records', () => {
  const s = endless({ [CLASSIC_BEST]: '77777', [BEST]: '500' });
  clear(s); clear(s);
  const record = s.state().score;
  assert.equal(s.state().best, record);
  assert.equal(s.storage.get(CLASSIC_BEST), '77777');
  s.key('r', 'KeyR');
  assert.equal(s.state().mode, 'endless');
  assert.equal(s.state().score, 0);
  assert.equal(s.state().lines, 0);
  assert.equal(s.state().gravity, 1000);
  assert.equal(s.state().hold, null);
  assert.equal(s.state().best, record);
  s.click('menu-button');
  assert.equal(s.element('endless-record').textContent, record.toLocaleString('en-US'));
  s.click('mode-classic'); s.click('begin-game');
  assert.equal(s.state().best, 77777);
  clear(s);
  assert.equal(Number(s.storage.get(BEST)), record);
  const reloaded = endless(Object.fromEntries(s.storage));
  assert.equal(reloaded.state().best, record);
  assert.equal(reloaded.state().score, 0);
});

test('endless game over shows the run score, record and correct retry action', () => {
  const s = endless();
  clear(s); topOut(s);
  const record = s.state().score;
  assert.equal(s.element('card-over').classList.contains('hidden'), false);
  assert.equal(s.element('new-best').classList.contains('hidden'), false);
  assert.equal(s.element('over-score-label').textContent, '本局得分');
  assert.equal(s.element('over-best-label').textContent, '最高分');
  assert.equal(s.element('play-again').textContent, '再来一局 (R)');
  assert.doesNotMatch(s.element('over-stage').textContent, /关|还差/);
  s.click('play-again');
  assert.equal(s.state().mode, 'endless');
  assert.equal(s.state().status, 'playing');
  assert.equal(s.state().score, 0);
  assert.equal(s.state().best, record);
  topOut(s);
  assert.ok(s.state().score < record);
  assert.equal(s.element('new-best').classList.contains('hidden'), true);
  assert.equal(Number(s.storage.get(BEST)), record);
});

test('menu selection does not change the active run; pause and hidden tabs preserve pending clears', () => {
  const s = endless();
  s.key('c', 'KeyC');
  const before = s.state();
  s.click('menu-button'); s.click('mode-classic'); s.tick(4000);
  s.click('resume-game');
  assert.equal(s.state().mode, 'endless');
  assert.equal(s.state().hold, before.hold);
  assert.deepEqual(s.state().piece, before.piece);
  clear(s, 2, false);
  s.document.hidden = true; s.listeners.visibilitychange(); s.tick(4000);
  assert.equal(s.state().status, 'paused');
  assert.equal(s.state().lines, 0);
  s.document.hidden = false; s.listeners.visibilitychange(); s.click('resume-pause'); s.tick();
  assert.equal(s.state().lines, 2);
  assert.equal(s.state().status, 'playing');
  s.key('p', 'KeyP');
  const paused = s.state(); s.tick(4000);
  assert.deepEqual(s.state().piece, paused.piece);
  s.click('menu-button'); s.click('mode-classic'); s.click('begin-game');
  assert.equal(s.state().campaign.stage, 1);
  assert.equal(s.element('stage-stat').hidden, false);
  assert.equal(s.state().score, 0);
  assert.equal(s.state().hold, null);
});

test('missing, malformed and unavailable high-score storage never prevents play', () => {
  for (const value of [undefined, 'NaN', 'Infinity', '-3', '12oops', '1.5', '{}']) {
    const s = endless(value === undefined ? {} : { [BEST]: value });
    assert.equal(s.state().best, 0);
    clear(s);
    assert.equal(s.state().best, s.state().score);
  }
  const s = endless({}, { storageUnavailable: true });
  clear(s);
  assert.equal(s.state().status, 'playing');
  assert.equal(s.state().best, s.state().score);
});

test('endless single clears stay silent and multi-line clears use the existing voice variants', () => {
  const s = endless();
  clear(s, 1);
  assert.equal(s.state().voice, null);
  clear(s, 2);
  assert.match(s.state().voice.key, /^clear-2-[abc]$/);
});
