const test = require('node:test');
const assert = require('node:assert/strict');
const { ExtractorEngine } = require('../services/extractor');

// Extract trimSegmentTimelineInManifest from server.js for unit testing
const fs = require('fs');
const path = require('path');
const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf-8');
const trimFuncMatch = serverCode.match(/function trimSegmentTimelineInManifest[\s\S]*?\n\}/);
if (!trimFuncMatch) {
  throw new Error('trimSegmentTimelineInManifest not found in server.js');
}
// Evaluate the function in this scope
const trimSegmentTimelineInManifest = new Function('manifest', 'keepCount = 5', `${trimFuncMatch[0]}; return trimSegmentTimelineInManifest(manifest, keepCount);`);

test('trimSegmentTimelineInManifest trims large 2-hour timeline and updates startNumber and timestamps', () => {
  const sample = `<MPD type="dynamic" availabilityStartTime="2026-05-21T03:18:32Z" timeShiftBufferDepth="PT2H">
    <SegmentTemplate timescale="10000000" presentationTimeOffset="17361487122997" media="$RepresentationID$_Segment-$Number$.m4v" initialization="$RepresentationID$_init.m4i" startNumber="2437677">
      <SegmentTimeline>
        <S t="93606607122997" d="38400000" r="1874"></S>
      </SegmentTimeline>
    </SegmentTemplate>
  </MPD>`;

  const result = trimSegmentTimelineInManifest(sample, 4);

  assert.match(result, /suggestedPresentationDelay="PT8S"/);
  assert.match(result, /timeShiftBufferDepth="PT60S"/);
  assert.match(result, /r="4"/);
  assert.match(result, /startNumber="2439547"/);
  // Timestamp t was updated from 93606607122997 to 93606607122997 + (1870 * 38400000) = 93678415122997
  assert.match(result, /t="93678415122997"/);
});

test('trimSegmentTimelineInManifest handles $Time$ templates without startNumber (e.g. Mediaset)', () => {
  const sample = `<MPD type="dynamic" availabilityStartTime="1970-01-01T00:00:00Z" timeShiftBufferDepth="PT2M">
    <SegmentTemplate timescale="48000" media="i1-clr-$RepresentationID$-$Time$.dash">
      <SegmentTimeline>
        <S t="85857663573120" d="184320" r="31" />
      </SegmentTimeline>
    </SegmentTemplate>
  </MPD>`;

  const result = trimSegmentTimelineInManifest(sample, 4);

  assert.match(result, /suggestedPresentationDelay="PT8S"/);
  assert.match(result, /timeShiftBufferDepth="PT60S"/);
  assert.match(result, /r="4"/);
  // t updated: 85857663573120 + ((31 - 4) * 184320) = 85857668549760
  assert.match(result, /t="85857668549760"/);
});

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
