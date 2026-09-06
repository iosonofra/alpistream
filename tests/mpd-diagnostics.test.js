const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFfmpegDiagnostics, parseStreamHeaders, requireMpdDocument } = require('../services/mpd-diagnostics');

test('the initial FFmpeg error survives a long input URL split across chunks', () => {
  const log = createFfmpegDiagnostics();
  log.push('Unable to open initialization segment\nError opening input file ht');
  log.push('tp://127.0.0.1/internal/mpd?token=' + 'private'.repeat(500));
  log.push('\nError opening input files: Invalid data found when processing input\n');
  const result = log.text();
  assert.match(result, /Unable to open initialization segment/);
  assert.match(result, /Invalid data found/);
  assert.doesNotMatch(result, /private|127\.0\.0\.1/);
});

test('logs stay bounded and preserve both first and last errors', () => {
  const log = createFfmpegDiagnostics();
  for (let i = 0; i < 200; i++) log.push(`error ${i}\n`);
  assert.match(log.text(), /error 0\n/);
  assert.match(log.text(), /error 199/);
  assert.ok(log.text().length < 2000);
});

test('an oversized line is discarded without leaking its trailing query', () => {
  const log = createFfmpegDiagnostics();
  log.push('http://example.test/' + 'x'.repeat(70000));
  log.push('secret-token\nactual error\n');
  assert.doesNotMatch(log.text(), /secret-token/);
  assert.match(log.text(), /actual error/);
});

test('CDN headers accept encoded pairs, a single user agent, and HTTP lines', () => {
  assert.deepEqual(parseStreamHeaders('User-Agent=Mozilla/5.0 (TV)'), { 'User-Agent': 'Mozilla/5.0 (TV)' });
  assert.deepEqual(parseStreamHeaders('Referer=https%3A%2F%2Fexample.test%2F&Origin=https%3A%2F%2Fexample.test'), {
    Referer: 'https://example.test/', Origin: 'https://example.test'
  });
  assert.deepEqual(parseStreamHeaders('User-Agent: TV\r\nReferer: https://example.test/\r\n'), {
    'User-Agent': 'TV', Referer: 'https://example.test/'
  });
  assert.deepEqual(parseStreamHeaders('X-Test=foo%0D%0AInjected%3Abar'), {});
});

test('HTML error pages fail before reaching the FFmpeg MPD demuxer', () => {
  assert.throws(() => requireMpdDocument('<html>Access denied</html>'), /non ha restituito/);
  assert.throws(() => requireMpdDocument(''), /non ha restituito/);
  assert.doesNotThrow(() => requireMpdDocument('<?xml version="1.0"?><MPD></MPD>'));
});
