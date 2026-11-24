// Run the actual game engine with a minimal browser surface; no dependencies.
// Inputs go through the same buttons and keyboard listeners as a real session.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function session(saved = {}, options = {}) {
  const elements = new Map(), listeners = {}, storage = new Map(Object.entries(saved));
  const ids = new Set([...fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  let frame, clock = 1000;
  const context2d = new Proxy({}, { get: (_, key) => {
    if (key === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    return () => {};
  }, set: () => true });
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set(), events = {};
    const el = {
      id, tagName: 'BUTTON', hidden: false, style: {}, dataset: {}, events,
      classList: { add: c => classes.add(c), remove: c => classes.delete(c),
        toggle(c, yes) { if (yes === undefined) yes = !classes.has(c); yes ? classes.add(c) : classes.delete(c); }, contains: c => classes.has(c) },
      clientWidth: id === 'playfield' ? 300 : 160, clientHeight: id === 'playfield' ? 600 : 120,
      getContext: () => context2d, toDataURL: () => '',
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 600 }),
      addEventListener: (name, fn) => { events[name] = fn; },
      querySelector: selector => element(String(id) + selector),
      setAttribute() {}, getAttribute(name) { return name.startsWith('data-') ? this.dataset[name.slice(5)] || '' : ''; }, appendChild() {}, removeChild() {}, blur() {}, focus() {}
    };
    elements.set(id, el); return el;
  }
  const document = {
    getElementById: id => ids.has(id) ? element(id) : null, createElement: () => element(Symbol()),
    querySelectorAll: selector => selector === '.check' ? ['sound', 'music', 'voice', 'grain'].map(key => {
      const el = element('setting-' + key); el.dataset.setting = key; return el;
    }) : [], readyState: 'complete', activeElement: { blur() {} },
    addEventListener: (name, fn) => { listeners[name] = fn; }
  };
  const window = {
    __tetrisScripted: !options.live,   // no random weather or dew unless a test asks for it
    devicePixelRatio: 1, matchMedia: query => ({ matches: !!options.reducedMotion && query.includes('reduced-motion') }),
    addEventListener: (name, fn) => { listeners[name] = fn; }
  };
  const speech = { spoken: [], cancelled: 0 };
  if (options.voices) {
    window.speechSynthesis = { getVoices: () => options.voices, cancel: () => speech.cancelled++, speak: u => speech.spoken.push(u) };
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  }
  const env = { window, document, console, performance: { now: () => clock },
    localStorage: {
      getItem: k => { if (options.storageUnavailable) throw new Error('Storage disabled'); return storage.get(k) || null; },
      setItem: (k, v) => { if (options.storageUnavailable) throw new Error('Storage disabled'); storage.set(k, v); },
      removeItem: k => { if (options.storageUnavailable) throw new Error('Storage disabled'); storage.delete(k); }
    },
    requestAnimationFrame: fn => { frame = fn; }, setTimeout: () => 1, clearTimeout() {},
    setInterval: () => 1, clearInterval() {}, getComputedStyle: () => ({ width: '160px', height: '120px' }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8'), env);
  const state = () => JSON.parse(JSON.stringify(window.__tetris.state()));
  const click = id => {
    const el = element(id);
    assert.ok(!el.disabled, id + ' is enabled');
    const fn = el.onclick || el.events.click;
    assert.ok(fn, id + ' has a handler');
    fn({ preventDefault() {}, stopPropagation() {}, target: el });
  };
  const key = (key, code = key) => {
    const e = { key, code, repeat: false, target: { tagName: 'BODY' }, preventDefault() {} };
    listeners.keydown(e); listeners.keyup(e);
  };
  const tick = (ms = 350) => { for (let n = 0; n < ms; n += 16) { clock += 16; frame(clock); } };
  const chooseStage = index => element('stage-roadmap').onclick({ target: { closest: () => ({ dataset: { stage: String(index) } }) } });
  return { state, click, key, tick, chooseStage, element, storage, document, listeners, speech, api: window.__tetris };
}


module.exports = { session };
