const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const express = require('express');
const axios = require('axios');
const { rewriteWarpPlaylist } = require('../services/stream-routing');
const { prepareDashManifest, resolveDashResource } = require('../services/dash-manifest');
const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
function loadRoute(app, prefix, sessionMap = new Map()) {
  const start = serverCode.indexOf(prefix);
  const end = serverCode.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(serverCode.slice(start, end), {
    app, axios, require, URL, URLSearchParams, Buffer, console, setTimeout,
    storage: { getConfig: () => ({}), getChannels: () => [], getCustomChannels: () => [] },
    httpKeepAliveAgent: new http.Agent(), httpsKeepAliveAgent: new https.Agent(),
    rewriteWarpPlaylist, prepareDashManifest, resolveDashResource, dashSegmentSessions: sessionMap,
    redactDiagnostic: value => value
  });
}

test('real HLS proxy preserves relative query URLs and streams the complete delayed response', async t => {
  const upstream = await listen(t, (req, res) => {
    if (req.url === '/live/list.m3u8') {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.end('#EXTM3U\n#EXTINF:2,\nsegment.ts?token=a%2Bb\n');
    } else {
      assert.equal(req.url, '/live/segment.ts?token=a%2Bb');
      res.setHeader('Content-Type', 'video/mp2t');
      res.write('first');
      setTimeout(() => res.end('last'), 30);
    }
  });
  const app = express();
  loadRoute(app, "app.get(['/api/stream/proxy.mpd'");
  const proxy = await listen(t, app);
  const playlist = await fetch(`${proxy}/api/stream/proxy.m3u8?url=${encodeURIComponent(upstream + '/live/list.m3u8')}`).then(r => r.text());
  const segment = playlist.split('\n').find(line => line.startsWith('http'));
  assert.ok(segment);
  assert.equal(new URL(segment).searchParams.has('warp'), false);
  assert.equal(await fetch(segment).then(r => r.text()), 'firstlast');
});

test('DASH route forwards byte ranges and signed parameters to the registered resource', async t => {
  const upstream = await listen(t, (req, res) => {
    assert.equal(req.url, '/track.mp4?sig=a%2Bb');
    assert.equal(req.headers.range, 'bytes=2-4');
    res.writeHead(206, { 'Content-Range': 'bytes 2-4/10', 'Content-Type': 'video/mp4' });
    res.end('234');
  });
  const session = { resources: new Map([['fixture', { template: upstream + '/track.mp4?sig=a%2Bb', variables: [] }]]) };
  const app = express();
  loadRoute(app, "app.get('/internal/dash-seg/", new Map([['session', session]]));
  const proxy = await listen(t, app);
  const response = await fetch(`${proxy}/internal/dash-seg/session/r/fixture`, { headers: { Range: 'bytes=2-4' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 2-4/10');
  assert.equal(await response.text(), '234');
});
