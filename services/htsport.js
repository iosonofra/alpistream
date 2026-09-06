const axios = require('axios');
const http = require('http');
const https = require('https');

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 30 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 30, rejectUnauthorized: false });

const client = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 8000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  }
});

// Cache per token e manifest
const epiembedCache = new Map(); // slug -> { url, expires }
const tvnowCache = new Map();    // id -> { url, expires }
let channelListCache = null;
let lastChannelListTime = 0;

// Mappa statica TVNow Slug -> Channel ID
const TVNOW_SLUG_MAP = {
  'sky-sport-uno-italy': '461',
  'sky-sport-calcio': '870',
  'sky-sport-f1-italy': '577',
  'sky-sport-motogp-italy': '575',
  'sky-sport-max-italy': '460',
  'sky-sport-tennis-italy': '576',
  'sky-sport-arena-italy': '462',
  'sky-sport-basket': '875',
  'dazn-zona-italy': '877',
  'eurosport-1-italy': '878',
  'sky-sport-24': '869',
  'sky-sport-bundesliga-1': '551',
  'sky-sport-bundesliga-2': '552',
  'sky-sport-bundesliga-3': '553',
  'sky-sport-bundesliga-4': '554',
  'sky-sports-premier-league': '555',
  'sky-sport-nz-9': '569',
  '20-mediaset': '857',
  'sky-calcio-1': '871',
  'sky-calcio-2': '872',
  'sky-calcio-3': '873',
  'sky-calcio-4': '874'
};

// Loghi canali sportivi
const LOGO_MAP = {
  'dazn1': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/dazn1.png',
  'dazn': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/dazn1.png',
  'sport24': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/skysport24.png',
  'sportuno': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/skysportuno.png',
  'calcio': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/skysportcalcio.png',
  'f1': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/skysportf1.png',
  'moto': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/skysportmotogp.png',
  'max': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/skysportfootball.png',
  'tennis': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/skysporttennis.png',
  'arena': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/skysportarena.png',
  'basket': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/skysportnba.png',
  'e1': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/eurosport1.png',
  'rai1': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/rai1.png',
  'rai2': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/rai2.png',
  'rai3': 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/rai3.png'
};

function getLogoForChannel(name, href) {
  const lower = (name + ' ' + href).toLowerCase();
  for (const [key, logo] of Object.entries(LOGO_MAP)) {
    if (lower.includes(key)) return logo;
  }
  return 'https://raw.githubusercontent.com/Fazzani/IPTV-Logos/master/Channels/IT/dazn1.png';
}

function getTvgId(name, href) {
  const lower = (name + ' ' + href).toLowerCase();
  if (lower.includes('dazn 1') || lower.includes('dazn1')) return 'DAZN1.it';
  if (lower.includes('dazn')) return 'DAZN.it';
  if (lower.includes('sport 24') || lower.includes('sport24')) return 'SkySport24.it';
  if (lower.includes('sport 1') || lower.includes('sportuno') || lower.includes('sport uno')) return 'SkySportUno.it';
  if (lower.includes('calcio')) return 'SkySportCalcio.it';
  if (lower.includes('f1')) return 'SkySportF1.it';
  if (lower.includes('moto')) return 'SkySportMotoGP.it';
  if (lower.includes('max')) return 'SkySportMax.it';
  if (lower.includes('tennis')) return 'SkySportTennis.it';
  if (lower.includes('arena')) return 'SkySportArena.it';
  if (lower.includes('basket')) return 'SkySportBasket.it';
  if (lower.includes('eurosport 1') || lower.includes('e1hd')) return 'Eurosport1.it';
  if (lower.includes('rai 1') || lower.includes('rai1')) return 'Rai1.it';
  if (lower.includes('rai 2') || lower.includes('rai2')) return 'Rai2.it';
  if (lower.includes('rai 3') || lower.includes('rai3')) return 'Rai3.it';
  return '';
}

class HTSportService {
  /**
   * Risolve l'URL m3u8 dinamico da epiembeds.online deoffuscando lo script JS
   */
  static async resolveEpiEmbeds(slug) {
    const cleanSlug = (slug || '').trim().toLowerCase();
    const now = Date.now();
    const cached = epiembedCache.get(cleanSlug);
    if (cached && now < cached.expires) {
      return cached.url;
    }

    const embedUrl = `https://epiembeds.online/embed/${cleanSlug}`;
    const res = await client.get(embedUrl, {
      headers: {
        'Referer': 'https://www.htsport.org/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      }
    });

    const html = res.data;
    // Regex per l'array cifrato e le chiavi numeriche: var _var1=[...],_var2=num,_var3=num
    const match = html.match(/var\s+([a-zA-Z0-9_]+)=\[([0-9,\s]+)\],\s*([a-zA-Z0-9_]+)=(\d+),\s*([a-zA-Z0-9_]+)=(\d+)/);
    if (!match) {
      throw new Error(`Obfuscated array non trovato per slug "${cleanSlug}"`);
    }

    const arr = JSON.parse('[' + match[2] + ']');
    const k1 = parseInt(match[4], 10);
    const k2 = parseInt(match[6], 10);

    let decoded = '';
    for (let i = 0; i < arr.length; i++) {
      decoded += String.fromCharCode(((arr[i] ^ k1) - k2 + 256) & 255);
    }

    const m3uMatch = decoded.match(/url\s*=\s*"([^"]+)"/);
    if (!m3uMatch || !m3uMatch[1]) {
      throw new Error(`Stream URL non estratto per slug "${cleanSlug}"`);
    }

    const streamUrl = m3uMatch[1];
    // Cache per 2 minuti (i token durano ore, ma un refresh frequente previene errori a metà sessione)
    epiembedCache.set(cleanSlug, {
      url: streamUrl,
      expires: now + 120000
    });

    return streamUrl;
  }

  /**
   * Risolve l'URL m3u8 dinamico da TVNow tramite API resolve-dlstream
   */
  static async resolveTvNow(channelId) {
    const cid = String(channelId).trim();
    const now = Date.now();
    const cached = tvnowCache.get(cid);
    if (cached && now < cached.expires) {
      return cached.url;
    }

    const apiUrl = `https://chat.cfbu247.sbs/api/resolve-dlstream/${cid}`;
    const res = await client.get(apiUrl, {
      headers: {
        'Referer': 'https://tvnow247.top/',
        'Origin': 'https://tvnow247.top',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const streamUrl = res.data.m3u8 || res.data.proxyPlaylistUrl;
    if (!streamUrl) {
      throw new Error(`Stream offline per TVNow Channel ID ${cid}`);
    }

    tvnowCache.set(cid, {
      url: streamUrl,
      expires: now + 120000
    });

    return streamUrl;
  }

  /**
   * Scansiona https://www.htsport.org/ ed estrae tutti i canali attivi
   */
  static async scrapeChannels(baseUrl = '', tokenParam = '') {
    const now = Date.now();
    if (channelListCache && (now - lastChannelListTime < 600000)) { // 10 minuti di cache
      return this.formatChannelsWithBaseUrl(channelListCache, baseUrl, tokenParam);
    }

    console.log('[HTSport] Avvio scansione canali da https://www.htsport.org/...');
    const res = await client.get('https://www.htsport.org/', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const html = res.data;
    const linkRegex = /<a\s+[^>]*href=["']([^"']+\.htm[l]?)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch;
    const rawLinks = new Map();

    while ((linkMatch = linkRegex.exec(html)) !== null) {
      const href = linkMatch[1].trim();
      const rawText = linkMatch[2].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
      if (href && href !== 'index.htm' && !rawLinks.has(href)) {
        rawLinks.set(href, rawText);
      }
    }

    const channels = [];
    const entries = Array.from(rawLinks.entries());

    // Analizza le singole pagine embed con concorrenza controllata
    const batchSize = 10;
    for (let i = 0; i < entries.length; i += batchSize) {
      const chunk = entries.slice(i, i + batchSize);
      await Promise.all(chunk.map(async ([href, rawTitle]) => {
        try {
          const pageRes = await client.get(`https://www.htsport.org/${href}`, {
            timeout: 4500,
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          const iframeMatch = pageRes.data.match(/<iframe[^>]*src=["']([^"']+)["']/i);
          if (!iframeMatch) return;

          const iframeUrl = iframeMatch[1].replace(/\\/g, '');
          const cleanTitle = rawTitle.replace(/[🇮🇹🇩🇪🇪🇸🇵🇹]/g, '').trim();

          let provider = 'unknown';
          let providerParam = '';

          if (iframeUrl.includes('epiembeds.online/embed/')) {
            provider = 'epiembeds';
            providerParam = iframeUrl.split('epiembeds.online/embed/')[1].split(/[?#/]/)[0].trim();
          } else if (iframeUrl.includes('tvnow247.top/embed/')) {
            provider = 'tvnow';
            const slug = iframeUrl.split('tvnow247.top/embed/')[1].split(/[?#/]/)[0].trim();
            providerParam = TVNOW_SLUG_MAP[slug] || slug;
          } else if (iframeUrl.includes('freeshot.live/embed/')) {
            provider = 'freeshot';
            providerParam = iframeUrl.split('freeshot.live/embed/')[1].replace('.php', '').split(/[?#/]/)[0].trim();
          } else if (iframeUrl.includes('apexstreams.cfd/live/stream-')) {
            provider = 'daddy';
            const matchDaddy = iframeUrl.match(/stream-(\d+)\.php/);
            providerParam = matchDaddy ? matchDaddy[1] : '';
          }

          if (provider !== 'unknown' && providerParam) {
            channels.push({
              href,
              title: cleanTitle,
              rawTitle,
              provider,
              providerParam,
              logo: getLogoForChannel(cleanTitle, href),
              tvgId: getTvgId(cleanTitle, href),
              group: 'SPORT - HTSport'
            });
          }
        } catch (e) {
          // Salta canali con timeout
        }
      }));
    }

    console.log(`[HTSport] Scansione completata: ${channels.length} canali estratti con successo.`);
    channelListCache = channels;
    lastChannelListTime = now;

    return this.formatChannelsWithBaseUrl(channels, baseUrl, tokenParam);
  }

  /**
   * Converte la lista grezza di canali HTSport negli oggetti Channel MandraKodi con URL proxy
   */
  static formatChannelsWithBaseUrl(channels, baseUrl = '', tokenParam = '') {
    const formatted = [];
    const resolvedBase = baseUrl ? baseUrl.replace(/\/$/, '') : '';

    for (const ch of channels) {
      let playUrl = '';
      const kodiProps = {};

      if (ch.provider === 'epiembeds') {
        // Embed diretto epiembeds senza proxy
        playUrl = `https://epiembeds.online/embed/${ch.providerParam}`;
      } else if (ch.provider === 'tvnow') {
        // Flusso HLS CDN diretto TVNow senza proxy locale nè WARP (zero carico server in produzione)
        const token = Buffer.from(JSON.stringify({ channelId: ch.providerParam, ts: Date.now() })).toString('base64');
        playUrl = `https://chunk.tvnow247.today/api/proxy/playlist?token=${token}`;
        kodiProps['inputstream'] = 'inputstream.adaptive';
        kodiProps['inputstream.adaptive.manifest_type'] = 'hls';
      } else if (ch.provider === 'freeshot') {
        playUrl = `https://wideiptv.top/player/${ch.providerParam}`;
      } else if (ch.provider === 'daddy') {
        playUrl = `https://dlhd.st/stream/stream-${ch.providerParam}.php`;
      }

      formatted.push({
        id: `htsport_${Buffer.from(ch.href + ch.provider + ch.providerParam).toString('base64').substring(0, 16)}`,
        title: `[HT] ${ch.title}`,
        url: playUrl,
        logo: ch.logo,
        tvgId: ch.tvgId,
        group: ch.group || 'SPORT - HTSport',
        kodi_props: kodiProps,
        headers: 'User-Agent=Mozilla/5.0',
        enabled: true,
        source: 'htsport'
      });
    }

    return formatted;
  }
}

module.exports = HTSportService;
