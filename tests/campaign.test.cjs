const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { session } = require('./session.cjs');

function campaign(options) {
  const s = session({}, options);
  s.click('mode-classic'); s.click('begin-game');
  return s;
}
function clear(s, rows = 4) {
  s.api.debugSetRows(rows);
  s.key('ArrowUp');
  for (let i = 0; i < 5; i++) s.key('ArrowLeft');
  s.key(' ', 'Space'); s.tick();
}
function finish(s) {
  for (let tries = 0; tries < 40 && s.state().status === 'playing'; tries++) clear(s);
  assert.ok(['stage-burst', 'stage-won'].includes(s.state().status));
}
function softPoints(s, amount) {
  for (let i = 0; i < amount; i++) {
    s.api.debugSetRows(0); s.key('ArrowDown');
  }
}

test('all ten score targets, fixed stage speeds, fresh boards and final completion work through real scoring', () => {
  const s = campaign();
  const targets = [5000, 10000, 15000, 20000, 30000, 40000, 50000, 60000, 80000, 100000];
  const speeds = [1000, 850, 720, 610, 520, 440, 370, 310, 260, 220];
  let total = 0, lines = 0;
  targets.forEach((target, i) => {
    const start = s.state();
    assert.equal(start.campaign.stage, i + 1);
    assert.equal(start.campaign.target, target);
    assert.equal(start.campaign.gravity, speeds[i]);
    assert.equal(start.score, 0); assert.equal(start.lines, 0);
    assert.equal(start.hold, null); assert.equal(start.combo, -1);
    assert.equal(start.board.flat().filter(Boolean).length, 0);
    finish(s);
    const won = s.state();
    assert.ok(won.score >= target); assert.equal(won.level, i + 1);
    assert.equal(won.active, null);
    total += won.score; lines += won.lines;
    assert.equal(won.campaign.total, total); assert.equal(won.campaign.passed, i + 1);
    s.key(' ', 'Space'); s.key('r', 'KeyR'); s.tick(1600);
    assert.equal(s.state().score, won.score, 'celebration blocks gameplay input');
    assert.equal(s.state().campaign.total, total, 'settlement counted exactly once');
    assert.equal(s.element('stage-result').hidden, false);
    assert.match(s.element('celebration-confetti').innerHTML, /<i style=/);
    assert.equal(s.state().status, i === 9 ? 'complete' : 'stage-won');
    assert.equal(s.state().voice.key, i === 9 ? 'complete' : 'passed');
    if (i < 9) { s.click('next-stage'); s.click('next-stage'); }
  });
  assert.equal(s.state().campaign.totalLines, lines);
  assert.equal(s.state().campaign.complete, true);
  assert.equal(Number(s.storage.get('graphiteBlocksCampaignBestV1')), total);
  s.click('next-stage');
  assert.equal(s.state().campaign.stage, 1); assert.equal(s.state().campaign.total, 0);
  assert.equal(s.state().campaign.complete, false);
});

test('80% reminder reports the exact remaining score once, including soft-drop points', () => {
  const s = campaign();
  clear(s); clear(s); clear(s);
  softPoints(s, 3999 - s.state().score);
  assert.equal(s.state().campaign.reminded, false);
  softPoints(s, 1);
  assert.equal(s.state().campaign.reminded, true);
  assert.equal(s.state().voice.text, '还差 1000 分就过关啦，加油！');
  softPoints(s, 50);
  assert.equal(s.state().voice.text, '还差 1000 分就过关啦，加油！');
  assert.equal(s.state().score, 4050);
  s.key('r', 'KeyR');
  assert.equal(s.state().campaign.reminded, false);
  softPoints(s, 4000);
  assert.equal(s.state().voice.key, 'near', 'retry rearms the reminder');
});

test('victory cancels an encouragement that was triggered by the same hard-drop move', () => {
  const s = campaign(); clear(s); clear(s); clear(s);
  softPoints(s, 3999 - s.state().score);
  clear(s);
  assert.equal(s.state().status, 'stage-burst');
  assert.equal(s.state().voice.key, 'near', 'hard-drop points may cross 80% before the clear');
  assert.equal(s.element('voice-caption').hidden, true, 'settlement cancels earlier encouragement');
  s.tick(1300);
  assert.equal(s.state().voice.key, 'passed');
});

test('menu and tab suspension preserve a pending victory and result without duplicating total points', () => {
  const s = campaign(); finish(s);
  const total = s.state().campaign.total;
  s.click('menu-button'); s.tick(4000);
  assert.equal(s.element('stage-result').hidden, true);
  s.click('resume-game'); assert.equal(s.state().status, 'stage-burst');
  s.document.hidden = true; s.listeners.visibilitychange(); s.tick(4000);
  assert.equal(s.state().status, 'paused');
  s.document.hidden = false; s.listeners.visibilitychange(); s.click('resume-pause');
  s.tick(1400); assert.equal(s.state().status, 'stage-won');
  assert.equal(s.state().campaign.total, total);
  s.click('menu-button'); s.click('resume-game');
  assert.equal(s.element('stage-result').hidden, false);
  s.click('next-stage'); assert.equal(s.state().campaign.stage, 2);
});

test('failure and restart retain the current stage and previously earned totals', () => {
  const s = campaign(); finish(s); s.tick(1300); s.click('next-stage');
  const priorTotal = s.state().campaign.total;
  for (let tries = 0; tries < 40 && s.state().status === 'playing'; tries++) {
    s.key(' ', 'Space'); s.tick();
  }
  assert.equal(s.state().status, 'over');
  s.tick(1000); s.click('play-again');
  assert.equal(s.state().campaign.stage, 2);
  assert.equal(s.state().score, 0);
  assert.equal(s.state().campaign.total, priorTotal);
  assert.equal(s.state().campaign.passed, 1);
});

test('single-line clears stay silent; each multi-line clear cycles three different cues without adjacent repeats', () => {
  const single = campaign(); single.tick(3000);
  const before = single.state().voice;
  clear(single, 1);
  assert.equal(single.state().lines, 1);
  assert.deepEqual(single.state().voice, before, 'single-line clear never starts a voice cue');
  for (let n = 2; n <= 4; n++) {
    const s = campaign(), heard = [];
    for (let i = 0; i < 6; i++) {
      s.key('r', 'KeyR'); s.tick(3000); clear(s, n);
      assert.equal(s.state().lines, n);
      const cue = s.state().voice.key;
      assert.match(cue, new RegExp('^clear-' + n + '-[abc]$'));
      heard.push(cue);
    }
    assert.equal(new Set(heard.slice(0, 3)).size, 3);
    assert.equal(new Set(heard.slice(3, 6)).size, 3);
    for (let i = 1; i < heard.length; i++) assert.notEqual(heard[i], heard[i - 1]);
  }
  const manifest = require('../audio/manifest.json');
  assert.equal(Object.keys(manifest.lines).filter(key => key.startsWith('clear-1')).length, 0);
  for (const key of Object.keys(manifest.lines)) {
    assert.ok(fs.statSync(path.join(__dirname, '../audio', key + '.m4a')).size > 4000, key);
  }
});

test('switching to endless during celebration clears the campaign result and starts fresh', () => {
  const s = campaign(); finish(s); s.tick(1300);
  const record = s.storage.get('graphiteBlocksCampaignBestV1');
  s.click('menu-button'); s.click('mode-endless'); s.click('begin-game');
  assert.equal(s.state().mode, 'endless');
  assert.equal(s.state().status, 'playing');
  assert.equal(s.state().score, 0);
  assert.equal(s.state().campaign, null);
  assert.equal(s.element('stage-result').hidden, true);
  assert.equal(s.element('celebration-confetti').hidden, true);
  assert.equal(s.storage.get('graphiteBlocksCampaignBestV1'), record);
});

test('reduced motion still reaches the same settlement and never auto-starts the next stage', () => {
  const s = campaign({ reducedMotion: true }); finish(s); s.tick(5000);
  assert.equal(s.state().status, 'stage-won');
  assert.equal(s.state().campaign.stage, 1);
  s.click('next-stage'); assert.equal(s.state().campaign.stage, 2);
});

test('bundled encouragement avoids system speech and keeps exact score captions, mute persistence and pause behavior', () => {
  const s = campaign({ voices: [{ name: 'Tingting', lang: 'zh-CN' }] });
  softPoints(s, 4000);
  assert.equal(s.speech.spoken.length, 0, 'never switch back to the mechanical system voice');
  assert.equal(s.state().voice.key, 'near');
  assert.equal(s.state().voice.text, '还差 1000 分就过关啦，加油！');
  s.document.hidden = true; s.listeners.visibilitychange();
  assert.equal(s.element('voice-caption').hidden, true);
  s.document.hidden = false; s.click('resume-pause');
  assert.equal(s.api.settings.voice, false, 'spoken praise is off until the player turns it on');
  s.click('setting-voice');
  assert.equal(JSON.parse(s.storage.get('graphiteBlocksSettings')).voice, true);
  assert.equal(session(Object.fromEntries(s.storage)).api.settings.voice, true, 'an explicit choice is remembered');
  s.click('setting-voice');
  assert.equal(JSON.parse(s.storage.get('graphiteBlocksSettings')).voice, false);
  s.key('r', 'KeyR'); softPoints(s, 4000);
  assert.equal(s.speech.spoken.length, 0, 'voice stays muted while captions continue');
  assert.match(s.element('voice-caption').textContent, /1000/);
  const reloaded = session(Object.fromEntries(s.storage));
  assert.equal(reloaded.api.settings.voice, false);
  const legacy = session({ graphiteBlocksSettings: JSON.stringify({ sound: true, music: true, voice: true, grain: 'FULL' }) });
  assert.equal(legacy.api.settings.voice, false, 'the old on-by-default value is not treated as a choice');
});
