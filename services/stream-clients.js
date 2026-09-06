function addStreamClient(state, response, onIdle) {
  if (state.closeTimer) clearTimeout(state.closeTimer);
  state.closeTimer = null;
  state.listeners.add(response);
  response.once('close', () => {
    state.listeners.delete(response);
    if (!state.closed && state.listeners.size === 0 && !state.closeTimer) {
      state.closeTimer = setTimeout(() => {
        state.closeTimer = null;
        if (!state.closed && state.listeners.size === 0) onIdle();
      }, 10000);
    }
  });
  if (response.destroyed) response.emit('close');
}

function writeStreamChunk(state, chunk, writeHeaders) {
  for (const response of state.listeners) {
    if (response.destroyed || response.writableEnded) {
      state.listeners.delete(response);
      continue;
    }
    // Never stall all viewers or accumulate unbounded data for a slow connection.
    if (response.writableLength > 2 * 1024 * 1024) {
      response.destroy();
      continue;
    }
    try {
      writeHeaders(response);
      response.write(chunk);
    } catch (_) {
      response.destroy();
    }
  }
}

module.exports = { addStreamClient, writeStreamChunk };
