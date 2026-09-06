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

  assert.match(result, /suggestedPresentationDelay="PT10S"/);
  assert.match(result, /timeShiftBufferDepth="PT120S"/);
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

  assert.match(result, /suggestedPresentationDelay="PT10S"/);
  assert.match(result, /timeShiftBufferDepth="PT120S"/);
  assert.match(result, /r="4"/);
  // t updated: 85857663573120 + ((31 - 4) * 184320) = 85857668549760
  assert.match(result, /t="85857668549760"/);
});

test('trimSegmentTimelineInManifest correctly trims multi-tag timelines (e.g. DAZN/Sky) without dropping base timestamp', () => {
  const sample = `<MPD type="dynamic" availabilityStartTime="1970-01-01T00:00:00Z">
    <SegmentTemplate timescale="600" media="avc_dash_global-$RepresentationID$-$Time$.dash" initialization="avc_dash_global-$RepresentationID$.dash">
      <SegmentTimeline>
        <S t="1073229780000" d="1200" r="10" />
        <S d="1200" r="5" />
        <S d="1200" r="4" />
      </SegmentTimeline>
    </SegmentTemplate>
  </MPD>`;

  // Total segments: 11 + 6 + 5 = 22. Target keep: 5 (5 + 1 = 6 kept).
  // Segments to skip: 16.
  // First tag has 11 segments (skips all 11).
  // Second tag has 6 segments: skips 5 (16 - 11), remaining 1.
  // Start timestamp of second tag: 1073229780000 + (11 * 1200) = 1073229793200.
  // Kept portion of second tag starts at: 1073229793200 + (5 * 1200) = 1073229799200.
  // Third tag has 5 segments (all kept).
  const result = trimSegmentTimelineInManifest(sample, 5);

  assert.match(result, /suggestedPresentationDelay="PT10S"/);
  assert.match(result, /<S t="1073229799200" d="1200"\s*\/>/);
  assert.match(result, /<S d="1200" r="4"\s*\/>/);
  // The first tag should not be present
  assert.doesNotMatch(result, /t="1073229780000"/);
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

test('trimSegmentTimelineInManifest converts static live manifest to dynamic and removes mediaPresentationDuration', () => {
  const sample = `<MPD type="static" mediaPresentationDuration="PT60.000S" profiles="urn:mpeg:dash:profile:isoff-live:2011">
    <Period id="0" duration="PT60.000S">
      <SegmentTemplate timescale="25000" startNumber="35000">
        <SegmentTimeline>
          <S t="100000" d="50000" r="29" />
        </SegmentTimeline>
      </SegmentTemplate>
    </Period>
  </MPD>`;

  const result = trimSegmentTimelineInManifest(sample, 12);
  assert.match(result, /type="dynamic"/);
  assert.match(result, /minimumUpdatePeriod="PT2S"/);
  assert.doesNotMatch(result, /mediaPresentationDuration=/);
  assert.doesNotMatch(result, /<Period\b[^>]*\bduration=/);
});

