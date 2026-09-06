const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(file = path.join(__dirname, '../webos-app/js/tv-app.js')) {
  const counters = { text: 0, logos: 0, queries: 0 };
  const elements = [];
  const timers = new Map();
  let timerId = 0;
  class Element {
    constructor() {
      this.children = []; this.dataset = {}; this.style = {};
      this.scrollTop = 0; this.clientHeight = 620; this.parts = {};
      const classes = new Set();
      this.classList = {
        add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
        toggle(c, enabled) { if (enabled) classes.add(c); else classes.delete(c); }
      };
      elements.push(this);
    }
    set innerHTML(value) { this.children = []; this.parts = {}; }
    set textContent(value) { counters.text++; this.text = String(value); }
    get textContent() { return this.text || ''; }
    set src(value) { counters.logos++; this.source = value; }
    getAttribute(name) { return name === 'src' ? this.source : null; }
    appendChild(child) { this.children.push(child); }
    addEventListener() {}
    querySelector(selector) {
      counters.queries++;
      return this.parts[selector] || (this.parts[selector] = new Element());
    }
  }
  const document = {
    getElementById(id) {
      return elements.find(e => e.id === id) || Object.assign(new Element(), { id });
    },
    createElement() { return new Element(); }
  };
  const window = { location: { protocol: 'http:', host: 'localhost', origin: 'http://localhost' } };
  let source = fs.readFileSync(file, 'utf8');
  source = source.slice(0, source.indexOf("  // Avvio all'evento DOMContentLoaded")) +
    'window.test = { state, el, renderChannels, updateVirtualChannels, updateChannelsMiniEpg, moveFocusVertical, setFocusZone, toggleOverlay }; })();';
  vm.runInNewContext(source, {
    window, document, localStorage: { getItem() { return null; } }, console,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  });
  const api = window.test;
  api.state.filteredChannels = Array.from({ length: 2000 }, (_, i) => ({
    id: String(i), title: `Canale ${i}`, logo: `logo-${i}.png`
  }));
  api.renderChannels();
  function flush() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } }
  function reset() { counters.text = counters.logos = counters.queries = 0; }
  function rows() { return elements.filter(e => e.dataset.channelIndex !== undefined); }
  return { ...api, counters, flush, reset, rows, timers };
}

test('a moving window rebinds only one row and keeps the other logos', () => {
  const app = setup();
  app.state.focusedChannelIdx = 20;
  app.updateVirtualChannels(); app.flush(); app.reset();
  app.moveFocusVertical(1);
  assert.equal(app.counters.logos, 1);
  assert.equal(app.counters.queries, 0);
  assert.equal(app.counters.text, 3);
  assert.equal(app.rows().length, 14);
});

test('rapid navigation postpones details and displays the last selected channel', () => {
  const app = setup(); app.flush(); app.reset();
  for (let i = 0; i < 100; i++) app.moveFocusVertical(1);
  assert.equal(app.timers.size, 1);
  app.flush();
  assert.equal(app.el.cardTitle.textContent, 'Canale 100');
});

test('ring buffer covers focus on forward/backward moves and large jumps', () => {
  const app = setup();
  for (const index of [0, 14, 1000, 1999, 1998, 200, 3, 0]) {
    app.state.focusedChannelIdx = index;
    app.updateVirtualChannels();
    const indices = app.rows().map(r => Number(r.dataset.channelIndex));
    assert.equal(new Set(indices).size, 14);
    const focused = app.rows().filter(r => r.classList.contains('focused'));
    assert.equal(focused.length, 1);
    assert.equal(Number(focused[0].dataset.channelIndex), index);
    for (const row of app.rows()) assert.equal(row.style.top, `${Number(row.dataset.channelIndex) * 94}px`);
  }
});

test('EPG refresh updates the recycled row matching its channel', () => {
  const app = setup();
  app.state.focusedChannelIdx = 35; app.updateVirtualChannels();
  app.state.liveEpgMap['35'] = { nowTitle: 'Nuovo programma' };
  app.updateChannelsMiniEpg();
  const row = app.rows().find(r => Number(r.dataset.channelIndex) === 35);
  assert.equal(row._parts.epg.textContent, 'Nuovo programma');
  app.state.overlayVisible = false; app.reset(); app.updateChannelsMiniEpg();
  assert.equal(app.counters.text, 0);
});

test('leaving the list cancels pending detail updates and removes the old focus', () => {
  const app = setup();
  app.setFocusZone('groups');
  assert.equal(app.timers.size, 0);
  assert.equal(app.rows().filter(r => r.classList.contains('focused')).length, 0);
});

test('short and empty groups render without stale timers', () => {
  const app = setup();
  app.state.filteredChannels = app.state.filteredChannels.slice(0, 3);
  app.renderChannels(); app.state.focusedChannelIdx = 2; app.updateVirtualChannels(); app.flush();
  assert.equal(app.el.cardTitle.textContent, 'Canale 2');
  app.state.filteredChannels = []; app.renderChannels();
  assert.equal(app.timers.size, 0);
});

if (process.env.TV_NAV_BASELINE) {
  for (const file of [process.env.TV_NAV_BASELINE, path.join(__dirname, '../webos-app/js/tv-app.js')]) {
    const app = setup(file);
    app.state.focusedChannelIdx = 20; app.updateVirtualChannels(); app.flush(); app.reset();
    for (let i = 0; i < 100; i++) app.moveFocusVertical(1);
    app.flush();
    console.log(path.basename(file), '100 passi:', JSON.stringify(app.counters));
  }
}
