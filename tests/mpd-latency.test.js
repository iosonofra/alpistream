const test = require('node:test');
const assert = require('node:assert/strict');
const { ExtractorEngine } = require('../services/extractor');

test('generateM3U emits inputstream.adaptive.live_delay=10 for MPD streams in Kodi', () => {
  const engine = new ExtractorEngine();
  const channels = [
    {
      id: 'test_mpd',
      title: 'Test MPD Channel',
      url: 'https://example.com/live/manifest.mpd',
      group: 'TEST',
      enabled: true,
      clearkey: '11112222333344445555666677778888:aaaabbbbccccddddeeeeffff00001111',
      kodi_props: {
        'inputstream': 'inputstream.adaptive',
        'inputstream.adaptive.manifest_type': 'mpd'
      }
    }
  ];

  const m3u = engine.generateM3U(channels, 'http://127.0.0.1:3000');
  assert.match(m3u, /#KODIPROP:inputstream\.adaptive\.live_delay=10/);
});
