const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { session } = require('./session.cjs');

function clear(s) {
  s.api.debugSetRows(4); s.key('ArrowUp');
  for (let i = 0; i < 5; i++) s.key('ArrowLeft');
  s.key(' ', 'Space'); s.tick();
}
function finish(s) {
  for (let i = 0; i < 50 && s.state().status === 'playing'; i++) clear(s);
  s.tick(1400);
  assert.ok(['stage-won', 'complete'].includes(s.state().status));
}

test('each of ten unlocked stage buttons starts the selected target, speed, multiplier and music', () => {
  const s = session();
  const targets = [5000, 10000, 15000, 20000, 30000, 40000, 50000, 60000, 80000, 100000];
  const speeds = [1000, 850, 720, 610, 520, 440, 370, 310, 260, 220];
  const music = require('../music/manifest.json').tracks;
  for (let i = 0; i < 10; i++) {
    s.chooseStage(i);
    assert.match(s.element('begin-game').textContent, new RegExp(String(i + 1).padStart(2, '0')));
    assert.ok(s.element('stage-music').textContent.includes(music[i].title));
    s.click('begin-game');
    const state = s.state();
    assert.equal(state.campaign.stage, i + 1);
    assert.equal(state.campaign.target, targets[i]);
    assert.equal(state.gravity, speeds[i]);
    assert.equal(state.level, i + 1);
    assert.equal(state.music.id, music[i].id);
    assert.equal(state.score, 0);
    assert.equal(state.campaign.total, 0);
    assert.equal(state.campaign.passed, 0);
    assert.deepEqual(state.campaign.cleared, []);
    s.click('menu-button');
  }
});

test('starting at stage 10 never grants skipped stages; all ten must actually be cleared to win', () => {
  const s = session(); s.chooseStage(9); s.click('begin-game');
  finish(s);
  assert.equal(s.state().status, 'stage-won');
  assert.equal(s.state().campaign.complete, false);
  assert.equal(s.state().campaign.passed, 1);
  assert.deepEqual(s.state().campaign.cleared, [10]);
  assert.equal(s.state().voice.key, 'passed');
  assert.equal((s.element('stage-result-path').innerHTML.match(/class="passed"/g) || []).length, 1);
  assert.match(s.element('next-stage').textContent, /第 1 关/);
  s.click('next-stage');
  assert.equal(s.state().campaign.stage, 1);
  for (let stage = 1; stage <= 9; stage++) {
    finish(s);
    assert.equal(s.state().campaign.passed, stage + 1);
    if (stage < 9) {
      assert.equal(s.state().status, 'stage-won');
      s.click('next-stage');
    }
  }
  assert.equal(s.state().status, 'complete');
  assert.equal(s.state().campaign.complete, true);
  assert.equal(new Set(s.state().campaign.cleared).size, 10);
  assert.equal(s.state().voice.key, 'complete');
});

test('selecting in the menu leaves the paused run intact until explicitly starting a new run', () => {
  const s = session(); s.chooseStage(6); s.click('begin-game'); clear(s);
  const before = s.state();
  s.click('menu-button'); s.chooseStage(2); s.click('resume-game');
  assert.equal(s.state().campaign.stage, 7);
  assert.equal(s.state().score, before.score);
  assert.equal(s.state().music.id, 'stage-07');
  s.key('r', 'KeyR');
  assert.equal(s.state().campaign.stage, 7);
  assert.equal(s.state().score, 0);
  s.click('menu-button'); s.chooseStage(2); s.click('begin-game');
  assert.equal(s.state().campaign.stage, 3);
  assert.equal(s.state().campaign.passed, 0);
  assert.equal(s.state().music.id, 'stage-03');
});

test('selecting a stage after a result starts a fresh run while retaining best scores', () => {
  const s = session(); s.click('begin-game'); finish(s);
  const best = s.state().best;
  s.click('menu-button'); s.chooseStage(8); s.click('begin-game');
  assert.equal(s.state().campaign.stage, 9);
  assert.equal(s.state().campaign.total, 0);
  assert.equal(s.state().campaign.passed, 0);
  assert.equal(s.state().best, best);
  assert.equal(s.element('stage-result').hidden, true);
  assert.equal(s.element('celebration-confetti').hidden, true);
  s.click('menu-button'); s.click('mode-endless'); s.click('begin-game');
  assert.equal(s.state().music.id, 'endless');
  assert.equal(s.state().campaign, null);
});

test('all twelve ambience loops are distinct, available, credited and match the game', () => {
  const manifest = require('../music/manifest.json');
  const license = fs.readFileSync(path.join(__dirname, '../music/LICENSE.txt'), 'utf8');
  const game = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
  assert.equal(manifest.tracks.length, 12);
  assert.deepEqual(manifest.tracks.map(track => track.id), [...Array.from({ length: 10 }, (_, i) => 'stage-' + String(i + 1).padStart(2, '0')), 'endless', 'zen']);
  assert.ok(game.includes("MUSIC_REVISION = '" + manifest.revision + "'"));
  const hashes = manifest.tracks.map(track => {
    const bytes = fs.readFileSync(path.join(__dirname, '..', track.file));
    assert.equal(bytes.length, track.bytes);
    assert.ok(track.loopEnd - track.loopStart > 60 && track.loopEnd < 120);
    assert.match(track.license, /^(CC0 1\.0|Public domain)$/);
    assert.ok(license.includes(track.file) && license.includes(track.sourceUrl), track.id + ' is credited');
    assert.equal(track.scale.length, 5);
    assert.ok(game.includes("{ id: '" + track.id + "', title: '" + track.title + "', scale: " + JSON.stringify(track.scale).replace(/,/g, ', ') + ', bass: ' + track.bass + ', loopStart: ' + track.loopStart + ', loopEnd: ' + track.loopEnd + ", bed: '" + track.bed + "' }"), track.id + ' matches the game');
    return crypto.createHash('sha256').update(bytes).digest('hex');
  });
  assert.equal(new Set(hashes).size, 12);
});
