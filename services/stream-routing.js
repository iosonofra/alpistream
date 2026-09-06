// Match the WARP routing used by exported IPTV playlists without exposing server config.
function channelUsesWarp(ch, cfg = {}) {
  const groups = [ch.group, ch.customGroup].filter(Boolean);
  const url = ch.url || '';
  if (ch.source === 'htsport' || groups.some(g => /htsport/i.test(g)) || /htsport|tvnow/i.test(url)) return false;
  return ch.useWarp === true || ['warp_direct', 'ffmpeg_copy'].includes(ch.streamMode) ||
    /WARP/i.test(`${ch.title || ''} ${ch.customTitle || ''}`) || /asn(?:%3A|:)13335/i.test(url) ||
    !!(cfg.warpEnabled && Array.isArray(cfg.warpGroups) && groups.some(g =>
      cfg.warpGroups.some(w => w && w.trim().toLowerCase() === g.trim().toLowerCase())));
}

function rewriteWarpPlaylist(manifest, sourceUrl, proxyBase, headers = {}, useWarp = true) {
  const proxyUri = uri => {
    if (!uri || /^(data|skd):/i.test(uri)) return uri;
    const target = new URL(uri, sourceUrl);
    if (!['http:', 'https:'].includes(target.protocol)) return uri;
    const params = new URLSearchParams({ url: target.href });
    if (useWarp) params.set('warp', '1');
    for (const name of ['referer', 'origin', 'ua', 'token']) {
      if (headers[name]) params.set(name, headers[name]);
    }
    const endpoint = target.pathname.endsWith('.m3u8') ? '/api/stream/proxy.m3u8' : '/api/stream/proxy';
    return `${proxyBase}${endpoint}?${params}`;
  };
  return manifest.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    if (line.startsWith('#')) return line.replace(/\bURI="([^"]+)"/g, (_, uri) => `URI="${proxyUri(uri)}"`);
    return proxyUri(line.trim());
  }).join('\n');
}

module.exports = { channelUsesWarp, rewriteWarpPlaylist };
