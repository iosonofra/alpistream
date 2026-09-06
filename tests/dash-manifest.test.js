const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser } = require('@xmldom/xmldom');
const { prepareDashManifest, resolveDashResource } = require('../services/dash-manifest');
const base = 'http://localhost/internal/dash-seg/test/';
function route(uri, session, vars = {}) {
  for (const [variable, value] of Object.entries(vars)) uri = uri.replaceAll(variable, value);
  return resolveDashResource(uri.slice(base.length), session);
}

test('nested track BaseURLs and inherited templates resolve to distinct CDN resources', () => {
  const session = {};
  const xml = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic"><BaseURL>../cdn/</BaseURL><Period>
    <BaseURL>event/</BaseURL><AdaptationSet><SegmentTemplate timescale="1000" media="$RepresentationID$-$Time$.m4s?sig=a%2Bb&amp;k=1" initialization="init.mp4"><SegmentTimeline><S t="9007199254740993" d="2000" r="3"/><S d="2100" r="-1"/></SegmentTimeline></SegmentTemplate>
    <Representation id="v"><BaseURL>video/</BaseURL></Representation>
    <Representation id="a"><BaseURL serviceLocation="audio">https://audio.example/live/</BaseURL></Representation>
    </AdaptationSet></Period></MPD>`;
  const result = prepareDashManifest(xml, 'https://cdn.example/manifests/live.mpd', session, base);
  const doc = new DOMParser().parseFromString(result, 'application/xml');
  const templates = Array.from(doc.getElementsByTagName('SegmentTemplate'));
  assert.equal(templates.length, 2);
  assert.equal(route(templates[0].getAttribute('media'), session, { '$RepresentationID$': 'v', '$Time$': '9007199254740993' }), 'https://cdn.example/cdn/event/video/v-9007199254740993.m4s?sig=a%2Bb&k=1');
  assert.equal(route(templates[1].getAttribute('initialization'), session), 'https://audio.example/live/init.mp4');
  for (const tpl of templates) {
    assert.equal(tpl.getElementsByTagName('S')[0].getAttribute('t'), '9007199254740993');
    assert.equal(tpl.getElementsByTagName('S')[1].getAttribute('r'), '-1');
  }
});

test('static type, Period durations, startNumber and presentationTimeOffset remain intact', () => {
  const session = {};
  const xml = '<MPD type="static" mediaPresentationDuration="PT60S"><Period duration="PT60S"><AdaptationSet><Representation id="v"><SegmentTemplate startNumber="42" presentationTimeOffset="10000" media="/$Number%05d$.m4s"><SegmentTimeline><S t="10000" d="2000" r="29"/></SegmentTimeline></SegmentTemplate></Representation></AdaptationSet></Period></MPD>';
  const result = prepareDashManifest(xml, 'https://cdn.example/live/mpd', session, base);
  const doc = new DOMParser().parseFromString(result, 'application/xml');
  assert.equal(doc.documentElement.getAttribute('type'), 'static');
  assert.equal(doc.getElementsByTagName('Period')[0].getAttribute('duration'), 'PT60S');
  const tpl = doc.getElementsByTagName('SegmentTemplate')[0];
  assert.equal(tpl.getAttribute('startNumber'), '42');
  assert.equal(tpl.getAttribute('presentationTimeOffset'), '10000');
  assert.equal(route(tpl.getAttribute('media'), session, { '$Number%05d$': '00042' }), 'https://cdn.example/00042.m4s');
});

test('SegmentList byte ranges and per-track initialization survive rewriting', () => {
  const session = {};
  const result = prepareDashManifest('<MPD><Period><AdaptationSet><Representation><SegmentList><Initialization sourceURL="init.mp4" range="0-99"/><SegmentURL media="seg.mp4" mediaRange="100-199"/></SegmentList></Representation></AdaptationSet></Period></MPD>', 'https://cdn.example/live/index.mpd', session, base);
  const doc = new DOMParser().parseFromString(result, 'application/xml');
  const segment = doc.getElementsByTagName('SegmentURL')[0];
  assert.equal(segment.getAttribute('mediaRange'), '100-199');
  assert.equal(route(segment.getAttribute('media'), session), 'https://cdn.example/live/seg.mp4');
});

test('manifest reload retains mappings needed by requests from the previous version', () => {
  const session = {};
  const manifest = n => `<MPD><Period><AdaptationSet><Representation><SegmentTemplate media="${n}.m4s"/></Representation></AdaptationSet></Period></MPD>`;
  const first = prepareDashManifest(manifest(1), 'https://cdn.example/mpd', session, base);
  const uri = new DOMParser().parseFromString(first, 'application/xml').getElementsByTagName('SegmentTemplate')[0].getAttribute('media');
  prepareDashManifest(manifest(2), 'https://cdn.example/mpd', session, base);
  assert.equal(route(uri, session), 'https://cdn.example/1.m4s');
});

test('mixed self-closing representations remain valid and FFmpeg selection is bounded to HD', () => {
  const result = prepareDashManifest('<MPD><Period><AdaptationSet contentType="video"><SegmentTemplate media="$Number$.m4s"/><Representation id="4k" height="2160" bandwidth="20000000"/><Representation id="hd" height="1080" bandwidth="5000000"></Representation><Representation id="sd" height="360" bandwidth="1000000"/></AdaptationSet></Period></MPD>', 'https://cdn.example/mpd', {}, base, true);
  const reps = new DOMParser().parseFromString(result, 'application/xml').getElementsByTagName('Representation');
  assert.equal(reps.length, 1);
  assert.equal(reps[0].getAttribute('id'), 'hd');
});
