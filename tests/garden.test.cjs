const { test } = require('node:test');
const assert = require('node:assert/strict');
const { session } = require('./session.cjs');

const RUN = 'graphiteBlocksRunV1', BEST = 'graphiteBlocksCampaignBestV1';
function clear(s, rows = 4) {
  s.api.debugSetRows(rows); s.key('ArrowUp');
  for (let i = 0; i < 5; i++) s.key('ArrowLeft');
  s.key(' ', 'Space'); s.tick();
}
function finish(s) {
  for (let tries = 0; tries < 60 && s.state().status === 'playing'; tries++) clear(s);
  s.tick(3000);
  assert.ok(['stage-won', 'complete'].includes(s.state().status));
}
const reload = s => session(Object.fromEntries(s.storage));

test('the garden grows with the run total: a level per stage cleared in order, ten for all ten', () => {
  const s = session(); s.click('begin-game');
  assert.deepEqual(s.state().garden, { level: 0, growth: 0, best: 0 });
  clear(s);
  const early = s.state().garden.growth;
  assert.ok(early > 0 && early < 1, 'it grows within a level too');
  for (let stage = 1; stage <= 10; stage++) {
    finish(s);
    assert.ok(s.state().garden.level >= stage, 'level ' + stage + ' after stage ' + stage);
    if (stage < 10) s.click('next-stage');
  }
  assert.equal(s.state().status, 'complete');
  assert.deepEqual([s.state().garden.level, s.state().garden.growth], [10, 10], 'full, and capped');
});

test('starting in the middle only counts what was scored; a level-up during play is announced', () => {
  const s = session(); s.chooseStage(9); s.click('begin-game');
  assert.equal(s.state().garden.level, 0, 'stage 10 alone starts from a seed');
  for (let i = 0; i < 3 && s.state().garden.level < 2; i++) clear(s);
  assert.ok(s.state().garden.level >= 2);
  assert.match(s.element('voice-caption').textContent, /花园 \d 级/);
  finish(s);
  const garden = s.state().garden;
  assert.ok(garden.level >= 5 && garden.level < 7, 'about 100,000 points: level ' + garden.level);
  assert.equal(garden.best, garden.growth, 'and it is the best run so far');
});

test('a new run starts the garden over, but the best garden stays on the menu and in other modes', () => {
  const s = session(); s.click('begin-game');
  finish(s); s.click('next-stage'); finish(s);
  const best = s.state().garden.growth;
  assert.ok(best >= 2);
  s.api.openMenu();
  assert.match(s.element('garden-note').textContent, /我的花园 · 2 级/);
  s.chooseStage(0); s.click('begin-game');
  assert.deepEqual([s.state().garden.level, s.state().garden.best], [0, best]);
  s.api.openMenu(); s.click('mode-endless'); s.click('begin-game');
  assert.equal(s.state().garden.growth, best, 'endless shows the best garden');
  assert.match(reload(s).element('garden-note').textContent, /我的花园 · 2 级/);
  assert.match(session().element('garden-note').textContent, /会让棋盘边的花园长起来/);
});

test('the run is saved at each cleared stage and can be continued after a reload', () => {
  const s = session(); s.click('begin-game');
  assert.equal(s.storage.has(RUN), false, 'nothing to continue before a stage is cleared');
  assert.equal(s.element('continue-run').hidden, true);
  finish(s);
  const total = s.state().campaign.total;
  let again = reload(s);                           // reloaded on the result screen
  assert.equal(again.state().status, 'menu');
  assert.equal(again.element('continue-run').hidden, false);
  assert.match(again.element('continue-run').textContent, /已完成 1 关/);
  again.click('continue-run');
  assert.deepEqual([again.state().status, again.state().campaign.stage, again.state().campaign.total, again.state().campaign.cleared],
    ['playing', 2, total, [1]]);
  assert.ok(again.state().garden.level >= 1, 'the garden comes back with it');
  clear(again);
  again = reload(again);                           // reloaded mid-stage: the stage starts over, the run does not
  again.click('continue-run');
  assert.deepEqual([again.state().campaign.stage, again.state().campaign.total, again.state().score], [2, total, 0]);
  finish(again); again.click('next-stage');
  again = reload(again);
  again.click('continue-run');
  assert.deepEqual([again.state().campaign.stage, again.state().campaign.cleared], [3, [1, 2]]);
});

test('continuing keeps skipped stages to do, another mode leaves the run alone, a new run replaces it', () => {
  const s = session(); s.chooseStage(8); s.click('begin-game');
  finish(s); s.click('next-stage');
  assert.equal(s.state().campaign.stage, 10);
  s.api.openMenu();
  assert.equal(s.element('continue-run').hidden, true, 'the live game has its own resume button');
  s.click('mode-zen'); s.click('begin-game');
  s.api.openMenu();
  assert.equal(s.element('continue-run').hidden, false);
  s.click('continue-run');
  assert.deepEqual([s.state().mode, s.state().campaign.stage, s.state().campaign.cleared], ['classic', 10, [9]]);
  finish(s); s.click('next-stage');
  assert.equal(s.state().campaign.stage, 1, 'then round to the stages not yet done');
  s.api.openMenu(); s.click('mode-classic'); s.chooseStage(4); s.click('begin-game');
  assert.equal(s.storage.has(RUN), false);
  assert.equal(reload(s).element('continue-run').hidden, true);
});

test('a finished run and damaged save data offer nothing to continue', () => {
  for (const bad of ['nope', '{"cleared":[0,0],"index":1,"total":5,"totalLines":1}', '{"cleared":[12],"index":1,"total":5,"totalLines":1}',
    '{"cleared":[0],"index":1,"total":-5,"totalLines":1}', '{"cleared":[],"index":0,"total":0,"totalLines":0}']) {
    const s = session({ [RUN]: bad });
    assert.equal(s.element('continue-run').hidden, true, bad);
    assert.equal(s.state().savedRun, null);
  }
  const s = session({ [BEST]: '500000' });
  assert.equal(s.state().garden.best, 10);
});
