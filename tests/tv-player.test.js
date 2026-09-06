const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../webos-app/js/tv-player.js'), 'utf8');
function setup() {
  const timers = new Map();
  const statuses = [];
  let timerId = 0;
  class Engine {
    constructor(config) { this.config = config; this.events = {}; this.recoveries = 0; }
    on(event, fn) { this.events[event] = fn; }
    emit(event, ...args) { if (this.events[event]) this.events[event](...args); }
    destroy() { this.destroyed = true; }
    pause() {}
    unload() {}
    detachMediaElement() {}
    attachMediaElement(video) { this.video = video; }
    attachMedia(video) { this.video = video; }
    loadSource(url) { this.url = url; }
    load() {}
    startLoad() {}
    recoverMediaError() { this.recoveries++; }
    play() { return this.video.play(); }
  }
  Engine.isSupported = () => true;
  Engine.Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest', FRAG_LOADED: 'loaded', FRAG_PARSED: 'parsed' };
  Engine.ErrorTypes = { MEDIA_ERROR: 'media', NETWORK_ERROR: 'network' };
  const mpegts = {
    isSupported: () => true,
    Events: { ERROR: 'error', MEDIA_INFO: 'info', STATISTICS_INFO: 'stats' },
    createPlayer: () => new Engine()
  };
  const video = {
    events: {}, currentTime: 0, frames: 0, videoWidth: 1920, paused: true, readyState: 0,
    addEventListener(name, fn) { this.events[name] = fn; },
    emit(name) { if (this.events[name]) this.events[name]({}); },
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    removeAttribute() {},
    load() { this.currentTime = 0; this.frames = 0; },
    getVideoPlaybackQuality() { return { totalVideoFrames: this.frames, droppedVideoFrames: 0 }; }
  };
  const window = { location: { origin: 'http://localhost' }, Hls: Engine, mpegts };
  vm.runInNewContext(source, {
    window, Hls: Engine, mpegts, URLSearchParams, console: { log() {}, warn() {} },
    setInterval(fn) { timers.set(++timerId, fn); return timerId; },
    clearInterval(id) { timers.delete(id); }
  });
  const player = window.tvPlayer;
  player.init(video, '', (state, details) => statuses.push({ state, details }));
  function tick(count, audio = false, frames = false) {
    for (let i = 0; i < count; i++) {
      if (audio) video.currentTime++;
      if (frames) video.frames += 25;
      for (const fn of [...timers.values()]) fn();
    }
  }
  return { player, video, timers, statuses, tick };
}
const channel = { id: 'live', url: '/live.m3u8' };

test('watchdog survives play and channel changes; stop cancels it', async () => {
  const { player, timers } = setup();
  await player.play(channel);
  assert.equal(timers.size, 1);
  await player.play({ ...channel, id: 'next' });
  assert.equal(timers.size, 1);
  player.stop();
  assert.equal(timers.size, 0);
});

test('audio advancing with frozen video causes a complete restart', async () => {
  const { player, video, tick } = setup();
  await player.play(channel);
  video.paused = false;
  video.readyState = 4;
  tick(3, true, true);
  const previous = player.hlsInstance;
  tick(12, true, false);
  assert.equal(previous.destroyed, true);
  assert.equal(player.recoveryCount, 1);
  assert.notEqual(player.hlsInstance, previous);
});

test('empty buffer is monitored even at readyState zero', async () => {
  const { player, tick } = setup();
  await player.play(channel);
  const previous = player.hlsInstance;
  tick(45);
  assert.equal(previous.destroyed, true);
  assert.equal(player.recoveryCount, 1);
});

test('download and timeupdate events cannot hide a stall or reset retries', async () => {
  const { player, video, tick, statuses } = setup();
  await player.play(channel);
  player.retryCount = 1;
  for (let i = 0; i < 44; i++) {
    player.hlsInstance.emit('loaded');
    player.hlsInstance.emit('parsed');
    video.emit('timeupdate');
    tick(1);
  }
  assert.equal(player.retryCount, 1);
  assert.equal(statuses.some(s => s.state === 'playing'), false);
  tick(1);
  assert.equal(player.recoveryCount, 1);
});

test('persistent stalls stop after two retries and release engines', async () => {
  const { player, tick, statuses, timers } = setup();
  await player.play(channel);
  tick(135);
  assert.equal(player.currentChannel, null);
  assert.equal(player.hlsInstance, null);
  assert.equal(timers.size, 0);
  assert.equal(statuses.at(-1).state, 'error');
});

test('normal playback and explicit pause do not restart the channel', async () => {
  const { player, video, tick } = setup();
  await player.play(channel);
  video.paused = false;
  const previous = player.hlsInstance;
  tick(60, true, true);
  video.paused = true;
  tick(60);
  assert.equal(player.hlsInstance, previous);
  assert.equal(player.recoveryCount, 0);
});

test('fallback destroys the previous engine and ignores its late callbacks', async () => {
  const { player } = setup();
  await player.play(channel);
  const previous = player.hlsInstance;
  player.playMpegTs('/stream/test.ts');
  const current = player.mpegInstance;
  assert.equal(previous.destroyed, true);
  assert.equal(player.hlsInstance, null);
  previous.emit('error', null, { fatal: true, type: 'media' });
  previous.emit('manifest');
  assert.equal(player.mpegInstance, current);
  assert.equal(player.recoveryCount, 0);
});

test('repeated fatal media errors are bounded despite playing events', async () => {
  const { player, video, statuses } = setup();
  await player.play(channel);
  for (let i = 0; i < 6; i++) {
    video.emit('playing');
    player.hlsInstance.emit('error', null, { fatal: true, type: 'media' });
  }
  assert.equal(player.hlsInstance, null);
  assert.equal(statuses.at(-1).state, 'error');
});

test('rapid play/play/stop cannot resurrect a stopped channel', async () => {
  const { player, timers } = setup();
  const first = player.play(channel);
  const second = player.play({ ...channel, id: 'next' });
  player.stop();
  await Promise.all([first, second]);
  assert.equal(player.currentChannel, null);
  assert.equal(timers.size, 0);
});

test('AceStream manifests go to HLS; MPEG-TS falls back to HLS once', async () => {
  const { player } = setup();
  const hash = 'a'.repeat(40);
  await player.play({ url: `/stream/ace/${hash}/manifest.m3u8` });
  assert.ok(player.hlsInstance);
  assert.equal(player.mpegInstance, null);
  await player.play({ url: `acestream://${hash}` });
  const previous = player.mpegInstance;
  previous.emit('error', 'network');
  assert.equal(previous.destroyed, true);
  assert.ok(player.hlsInstance);
  const current = player.hlsInstance;
  previous.emit('error', 'network');
  assert.equal(player.hlsInstance, current);
});

test('HLS network failure retries HLS without sending non-DASH channels to MPD proxy', async () => {
  const { player } = setup();
  await player.play(channel);
  const previous = player.hlsInstance;
  for (let i = 0; i < 3; i++) previous.emit('error', null, { fatal: true, type: 'network' });
  assert.ok(player.hlsInstance);
  assert.equal(player.mpegInstance, null);
  assert.equal(player.recoveryCount, 1);
});

test('TV browser and packaged player are identical', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../public/tv/js/tv-player.js'), 'utf8'), source);
});

test('FFmpeg WARP catalog variants route MPD sources through the backend', async () => {
  const { player } = setup();
  player.setAuthToken('token & value');
  const ch = { id: 'sport_ffmpeg', url: 'https://cdn.example/live.mpd', streamMode: 'ffmpeg_copy', useWarp: true };
  const target = new URL(player.resolveUrl(ch));
  assert.equal(target.pathname, '/stream/mpd/sport_ffmpeg.ts');
  assert.equal(target.searchParams.get('warp'), '1');
  assert.equal(target.searchParams.get('token'), 'token & value');
  await player.play(ch);
  assert.ok(player.mpegInstance);
  assert.equal(player.hlsInstance, null);
});

test('direct WARP DASH and license metadata also use server decoding on TV', () => {
  const { player } = setup();
  for (const extra of [
    { streamMode: 'warp_direct', kodi_props: { 'inputstream.adaptive.manifest_type': 'mpd' } },
    { kodi_props: { 'inputstream.adaptive.license_key': 'kid:key' }, useWarp: true }
  ]) {
    const target = new URL(player.resolveUrl({ id: 'sport_warp', url: 'https://cdn.example/manifest', ...extra }));
    assert.equal(target.pathname, '/stream/mpd/sport_warp.ts');
    assert.equal(target.searchParams.get('warp'), '1');
  }
});

test('WARP HLS uses the proxy with CDN headers and the server auth token', async () => {
  const { player } = setup();
  player.setAuthToken('secret');
  const ch = { id: 'hls', url: 'https://cdn.example/live.m3u8?signature=a%2Bb', useWarp: true,
    headers: 'Referer=https%3A%2F%2Fsite.example%2F&Origin=https%3A%2F%2Fsite.example&User-Agent=TV' };
  const target = new URL(player.resolveUrl(ch));
  assert.equal(target.pathname, '/api/stream/proxy.m3u8');
  assert.equal(target.searchParams.get('url'), ch.url);
  assert.equal(target.searchParams.get('referer'), 'https://site.example/');
  assert.equal(target.searchParams.get('origin'), 'https://site.example');
  assert.equal(target.searchParams.get('ua'), 'TV');
  assert.equal(target.searchParams.get('token'), 'secret');
  assert.equal(target.searchParams.get('warp'), '1');
  await player.play(ch);
  assert.ok(player.hlsInstance);
});

test('HTSport stays direct even when flagged WARP; plain HLS stays direct', () => {
  const { player } = setup();
  const url = 'https://cdn.example/live.m3u8';
  assert.equal(player.resolveUrl({ url }), url);
  assert.equal(player.resolveUrl({ url, source: 'htsport', useWarp: true }), url);
});

test('WARP transport streams retain MPEG-TS detection behind the proxy query', async () => {
  const { player } = setup();
  await player.play({ url: 'https://cdn.example/live.ts?signature=abc', useWarp: true });
  assert.ok(player.mpegInstance);
  assert.equal(player.hlsInstance, null);
});
