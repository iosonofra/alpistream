const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { prepareDashManifest, resolveDashResource } = require('../services/dash-manifest');
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
const available = spawnSync(ffmpeg, ['-version'], { windowsHide: true }).status === 0;
function run(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { windowsHide: true });
    let error = '';
    proc.stderr.on('data', data => { error += data; });
    proc.stdout.resume();
    const timeout = setTimeout(() => { proc.kill(); reject(new Error('FFmpeg timeout')); }, 20000);
    proc.on('error', err => { clearTimeout(timeout); reject(err); });
    proc.on('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(error)); });
  });
}

test('real FFmpeg decodes audio and video through rewritten DASH URLs without 404s', { skip: !available }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpistream-dash-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p', '-g', '10', '-c:a', 'aac', '-f', 'dash', '-seg_duration', '1', path.join(dir, 'manifest.mpd').replace(/\\/g, '/')]);
  const session = {};
  const requests = [];
  let base;
  const server = http.createServer((req, res) => {
    if (req.url === '/manifest.mpd') {
      const xml = fs.readFileSync(path.join(dir, 'manifest.mpd'), 'utf8');
      const rewritten = prepareDashManifest(xml, base + 'source/manifest.mpd', session, base + 'proxy/', true);
      res.setHeader('Content-Type', 'application/dash+xml');
      res.end(rewritten);
      return;
    }
    try {
      const target = resolveDashResource(req.url.slice('/proxy/'.length), session);
      const filename = path.basename(new URL(target).pathname);
      requests.push(filename);
      res.setHeader('Content-Type', 'video/mp4');
      res.end(fs.readFileSync(path.join(dir, filename)));
    } catch (error) {
      console.error('Fixture request failed:', req.url, error.message);
      requests.push('404'); res.statusCode = 404; res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  base = `http://127.0.0.1:${server.address().port}/`;
  await run(['-hide_banner', '-loglevel', 'error', '-i', base + 'manifest.mpd', '-map', '0:v:0', '-map', '0:a:0', '-t', '3', '-f', 'null', '-']);
  assert.ok(requests.length >= 6);
  assert.equal(requests.includes('404'), false);
  assert.ok(requests.some(name => /init.*0/.test(name)));
  assert.ok(requests.some(name => /init.*1/.test(name)));
});
