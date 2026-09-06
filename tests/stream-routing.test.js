const { test } = require('node:test');
const assert = require('node:assert/strict');
const { channelUsesWarp, rewriteWarpPlaylist } = require('../services/stream-routing');

test('catalog WARP metadata respects group configuration and explicit variants', () => {
  const cfg = { warpEnabled: true, warpGroups: [' Sport '] };
  assert.equal(channelUsesWarp({ group: 'SPORT' }, cfg), true);
  assert.equal(channelUsesWarp({ customGroup: 'sport' }, cfg), true);
  assert.equal(channelUsesWarp({ group: 'sport' }, { ...cfg, warpEnabled: false }), false);
  assert.equal(channelUsesWarp({ useWarp: true }), true);
  assert.equal(channelUsesWarp({ streamMode: 'warp_direct' }), true);
  assert.equal(channelUsesWarp({ streamMode: 'ffmpeg_copy' }), true);
  assert.equal(channelUsesWarp({ url: 'https://cdn.example/asn%3A13335/live' }), true);
  assert.equal(channelUsesWarp({ source: 'htsport', useWarp: true }, cfg), false);
  assert.equal(channelUsesWarp({ group: 'HTSport', streamMode: 'ffmpeg_copy' }, cfg), false);
});

test('all HLS dependencies cross WARP, including audio, keys and initialization data', () => {
  const manifest = '#EXTM3U\r\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/list.m3u8"\r\n' +
    '#EXT-X-KEY:METHOD=AES-128,URI="/keys/live.key"\r\n#EXT-X-MAP:URI="../init.mp4"\r\n' +
    '#EXTINF:6,\r\nsegment.ts?sig=a%2Bb\r\n//other.example/segment.ts\r\n';
  const result = rewriteWarpPlaylist(manifest, 'https://cdn.example/live/main/list.m3u8', 'https://server.example', { referer: 'https://site.example', token: 'secret' });
  const urls = [...result.matchAll(/URI="([^"]+)"/g)].map(m => m[1]);
  urls.push(...result.split('\n').filter(line => line.startsWith('https://')));
  assert.equal(urls.length, 5);
  const targets = urls.map(url => {
    const proxy = new URL(url);
    assert.equal(proxy.origin, 'https://server.example');
    assert.equal(proxy.searchParams.get('warp'), '1');
    assert.equal(proxy.searchParams.get('token'), 'secret');
    assert.equal(proxy.searchParams.get('referer'), 'https://site.example');
    return proxy.searchParams.get('url');
  });
  assert.deepEqual(targets, [
    'https://cdn.example/live/main/audio/list.m3u8', 'https://cdn.example/keys/live.key',
    'https://cdn.example/live/init.mp4', 'https://cdn.example/live/main/segment.ts?sig=a%2Bb',
    'https://other.example/segment.ts'
  ]);
});
