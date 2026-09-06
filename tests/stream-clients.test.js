const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { addStreamClient, writeStreamChunk } = require('../services/stream-clients');
function response() {
  const r = new EventEmitter(); r.writableLength = 0; r.writes = 0;
  r.write = () => { r.writes++; };
  r.destroy = () => { r.destroyed = true; r.emit('close'); };
  return r;
}
test('a slow client is disconnected without blocking other viewers', () => {
  const state = { listeners: new Set(), closed: false };
  const slow = response(), fast = response();
  addStreamClient(state, slow, () => {}); addStreamClient(state, fast, () => {});
  slow.writableLength = 3 * 1024 * 1024;
  writeStreamChunk(state, Buffer.from('TS'), () => {});
  assert.equal(slow.destroyed, true); assert.equal(fast.writes, 1);
  assert.equal(state.listeners.size, 1);
  state.closed = true; fast.destroy();
  assert.equal(state.closeTimer, null);
});
test('reconnecting cancels the old idle timer; closing a terminated process cannot schedule another', () => {
  const state = { listeners: new Set(), closed: false };
  const first = response(); addStreamClient(state, first, () => {}); first.destroy();
  assert.ok(state.closeTimer);
  const next = response(); addStreamClient(state, next, () => {});
  assert.equal(state.closeTimer, null);
  state.closed = true; next.destroy();
  assert.equal(state.closeTimer, null);
});
