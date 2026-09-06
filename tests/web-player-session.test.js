const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/js/player.js'), 'utf8');

function setup(useShaka = true) {
  const engines = [], timers = new Map();
  let timer = 0;
  const video = { id: 'livetv-video', currentTime: 0, paused: true, plays: 0,
    pause() { this.paused = true; }, removeAttribute() {}, load() {},
    play() { this.paused = false; this.plays++; return Promise.resolve(); }
  };
  class Engine {
    constructor() { this.events = {}; engines.push(this); }
    on(event, fn) { this.events[event] = fn; }
    addEventListener(event, fn) { this.on(event, fn); }
    emit(event, ...args) { if (this.events[event]) this.events[event](...args); }
    configure() {}
    getNetworkingEngine() { return { clearAllRequestFilters() {}, registerRequestFilter() {} }; }
    load(url) { if (url) return new Promise(resolve => { this.finish = resolve; }); }
    loadSource() {}
    attachMedia() {}
    attachMediaElement() {}
    destroy() { this.destroyed = true; return Promise.resolve(); }
    play() { return video.play(); }
  }
  Engine.isBrowserSupported = () => useShaka;
  Engine.isSupported = () => true;
  Engine.Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest' };
  const shaka = { Player: Engine, polyfill: { installAll() {} }, net: { NetworkingEngine: { RequestType: { LICENSE: 1 } } } };
  const mpegts = { isSupported: () => true, createPlayer: () => new Engine(), Events: { ERROR: 'error' } };
  const window = { shaka, mpegts, Hls: Engine, location: { origin: 'http://localhost', host: 'localhost' }, appConfig: {}, addEventListener() {}, removeEventListener() {} };
  const context = { window, shaka, mpegts, Hls: Engine, URL, URLSearchParams, console: { warn() {}, log() {} },
    document: { addEventListener() {} },
    setInterval(fn) { timers.set(++timer, fn); return timer; }, clearInterval(id) { timers.delete(id); }
  };
  vm.createContext(context); vm.runInContext(source, context);
  return { video, engines, timers, play: context.playOnVideoElement, proxy: context.buildProxyUrl };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('late load from a previous channel cannot restart or overwrite the current session', async () => {
  const app = setup();
  const first = app.play(app.video, { url: 'https://cdn.test/first.m3u8' });
  const old = app.engines[0];
  const second = app.play(app.video, { url: 'https://cdn.test/second.m3u8' });
  await flush();
  assert.equal(old.destroyed, true);
  old.finish(); app.engines[1].finish();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.closed, true);
  assert.equal(app.video._playSession, b);
  assert.equal(app.video.plays, 1);
  assert.equal(app.timers.size, 1);
  old.emit('error', { detail: { severity: 2 } });
  await flush();
  assert.equal(app.engines.length, 2);
});

test('closing a video during asynchronous load prevents playback and watchdog creation', async () => {
  const app = setup();
  const pending = app.play(app.video, { url: 'https://cdn.test/live.m3u8' });
  await app.video._playSession.destroy();
  app.engines[0].finish(); await pending;
  assert.equal(app.video.plays, 0);
  assert.equal(app.timers.size, 0);
});

test('AceStream fallback transfers ownership and later cleanup destroys HLS too', async () => {
  const app = setup(false);
  const session = await app.play(app.video, { url: 'acestream://' + 'a'.repeat(40) });
  const mpeg = app.engines[0];
  mpeg.emit('error', 'network');
  await flush();
  assert.equal(mpeg.destroyed, true);
  assert.equal(session.engine, app.engines[1]);
  mpeg.emit('error', 'network'); await flush();
  assert.equal(app.engines.length, 2);
  await session.destroy();
  assert.equal(app.engines[1].destroyed, true);
  assert.equal(app.timers.size, 0);
});

test('signed URLs are not double-decoded and CDN /stream/ paths still use the proxy', () => {
  const app = setup();
  const uri = 'https://cdn.test/stream/video.m4s?sig=a%252Bb&token=one%26two';
  const proxy = new URL(app.proxy(uri, {}, true), 'http://localhost');
  assert.equal(proxy.searchParams.get('url'), uri);
  assert.equal(proxy.searchParams.get('warp'), '1');
  const internal = 'http://localhost/internal/dash-seg/session/r/id/100';
  assert.equal(app.proxy(internal, {}, true), internal);
});

test('already routed MPEG-TS streams use MSE directly instead of Shaka DASH', async () => {
  const app = setup();
  const session = await app.play(app.video, { url: '/stream/mpd/channel.ts?warp=1', id: 'channel' });
  assert.equal(app.engines.length, 1);
  assert.equal(app.engines[0].finish, undefined);
  assert.equal(app.video.plays, 1);
  await session.destroy();
});
