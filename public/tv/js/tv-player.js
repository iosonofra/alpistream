/**
 * iosonofratv - Hybrid Video Player Engine
 * Supporto per HLS (Hls.js & Native webOS), AceStream (mpegts.js + HLS fallback), MPEG-TS Stream Copy e Auto-Recovery
 */

class TvPlayer {
  constructor() {
    this.video = null;
    this.hlsInstance = null;
    this.mpegInstance = null;
    this.currentChannel = null;
    this.serverBase = '';
    this.authToken = '';
    this.onStatusChange = null;
    this.retryCount = 0;
    this.maxRetries = 2;
    this.fallbackTriggered = false;
  }

  init(videoEl, serverBaseUrl, onStatusChange) {
    this.video = videoEl;
    this.serverBase = (serverBaseUrl || window.location.origin).replace(/\/$/, '');
    this.onStatusChange = onStatusChange || (() => {});

    // Eventi video nativi
    this.markPlaying = () => {
      this.retryCount = 0;
      this.onStatusChange('playing', { channel: this.currentChannel });
    };

    this.video.addEventListener('playing', () => this.markPlaying());
    this.video.addEventListener('canplay', () => this.markPlaying());
    this.video.addEventListener('timeupdate', () => {
      if (this.video && this.video.currentTime > 0 && !this.video.paused) {
        this.markPlaying();
      }
    });

    this.video.addEventListener('waiting', () => {
      this.onStatusChange('buffering', { channel: this.currentChannel });
    });

    this.video.addEventListener('error', (e) => {
      console.warn('[TvPlayer] Errore elemento video nativo:', e);
      this.handlePlaybackError('Errore di decodifica video');
    });
  }

  setServerBase(url) {
    this.serverBase = (url || window.location.origin).replace(/\/$/, '');
  }

  setAuthToken(token) {
    this.authToken = (token || '').trim();
  }

  getAuthParam() {
    return this.authToken ? `?token=${encodeURIComponent(this.authToken)}` : '';
  }

  async stop() {
    if (this.hlsInstance) {
      try { this.hlsInstance.destroy(); } catch (e) {}
      this.hlsInstance = null;
    }
    if (this.mpegInstance) {
      try {
        this.mpegInstance.pause();
        this.mpegInstance.unload();
        this.mpegInstance.detachMediaElement();
        this.mpegInstance.destroy();
      } catch (e) {}
      this.mpegInstance = null;
    }
    if (this.video) {
      try {
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
      } catch (e) {}
    }
    this.currentChannel = null;
    this.fallbackTriggered = false;
  }

  extractAceHash(channel) {
    if (!channel) return null;
    if (channel.aceHash && /^[a-f0-9]{40}$/i.test(channel.aceHash.trim())) {
      return channel.aceHash.trim();
    }
    const candidates = [channel.url, channel.rawUrl, channel.cleanUrl];
    for (const u of candidates) {
      if (!u || typeof u !== 'string') continue;
      const str = u.trim();
      if (str.startsWith('acestream://')) {
        const h = str.replace('acestream://', '').split(/[?#|&/]/)[0].trim();
        if (/^[a-f0-9]{40}$/i.test(h)) return h;
      }
      const matchId = str.match(/[?&]id=([a-f0-9]{40})/i);
      if (matchId) return matchId[1];
      const matchPath = str.match(/\/stream\/ace\/([a-f0-9]{40})/i);
      if (matchPath) return matchPath[1];
      if (/^[a-f0-9]{40}$/i.test(str)) return str;
    }
    return null;
  }

  resolveUrl(channel) {
    const aceHash = this.extractAceHash(channel);
    const auth = this.getAuthParam();
    if (aceHash) {
      const isHls = channel.url && channel.url.includes('manifest.m3u8');
      const streamPath = isHls ? `/stream/ace/${aceHash}/manifest.m3u8` : `/stream/ace/${aceHash}.ts`;
      return `${this.serverBase}${streamPath}${auth ? (streamPath.includes('?') ? '&' + auth.slice(1) : auth) : ''}`;
    }

    let url = (channel.url || '').trim();
    if (!url) return '';

    // Se l'URL è relativo (/stream/...), risolvilo rispetto all'indirizzo server iosonofratv
    if (url.startsWith('/')) {
      return `${this.serverBase}${url}${auth ? (url.includes('?') ? '&' + auth.slice(1) : auth) : ''}`;
    }
    return url;
  }

  async play(channel) {
    await this.stop();
    this.currentChannel = channel;
    this.fallbackTriggered = false;
    this.retryCount = 0;

    const streamUrl = this.resolveUrl(channel);
    if (!streamUrl) {
      this.onStatusChange('error', { error: 'URL canale vuoto o non valido' });
      return;
    }

    this.onStatusChange('loading', { channel, url: streamUrl });

    // 1. Riconoscimento prioritario canali AceStream
    const aceHash = this.extractAceHash(channel);
    if (aceHash || channel.source === 'acestream' || streamUrl.includes('/stream/ace/')) {
      this.playAceStream(aceHash, streamUrl, channel);
      return;
    }

    // 2. Riconoscimento stream MPEG-TS Server Copy (FFmpeg MPD o ClearKey proxy)
    const isMpegTs = channel.streamMode === 'ffmpeg_copy' ||
      channel.mpdProxy === true ||
      (channel.id && channel.id.endsWith('_ffmpeg')) ||
      streamUrl.includes('/stream/mpd/') ||
      streamUrl.endsWith('.ts');

    if (isMpegTs) {
      this.playMpegTs(streamUrl);
      return;
    }

    // 3. Riconoscimento stream HLS (HTSport, TVNow, m3u8 standard)
    const isHls = streamUrl.includes('.m3u8') ||
      streamUrl.includes('chunk.tvnow247.today') ||
      (channel.kodi_props && channel.kodi_props['inputstream.adaptive.manifest_type'] === 'hls');

    if (isHls) {
      this.playHls(streamUrl);
      return;
    }

    // 4. Fallback Diretto HTML5
    this.playNative(streamUrl);
  }

  playAceStream(aceHash, streamUrl, channel) {
    console.log('[TvPlayer] Avvio riproduzione AceStream:', aceHash, streamUrl);

    // Tentativo 1: mpegts.js con type: 'mpegts' forzato (MSE ad alte prestazioni)
    if (window.mpegts && mpegts.isSupported()) {
      try {
        this.mpegInstance = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: streamUrl
        }, {
          enableWorker: false, // Disabilitato per compatibilità con browser webOS
          lazyLoadMaxDuration: 3 * 60,
          seekType: 'range',
          liveBufferLatencyChasing: false,
          liveBufferLatencyMaxLatency: 6,
          liveBufferLatencyMinRemain: 2,
          autoCleanupSourceBuffer: true
        });

        this.mpegInstance.on(mpegts.Events.ERROR, (type, detail, info) => {
          console.warn('[TvPlayer] Errore mpegts.js AceStream:', type, detail, info);
          this.fallbackAceToHls(aceHash);
        });

        if (mpegts.Events.MEDIA_INFO) {
          this.mpegInstance.on(mpegts.Events.MEDIA_INFO, () => {
            this.markPlaying();
          });
        }

        this.mpegInstance.attachMediaElement(this.video);
        this.mpegInstance.load();
        this.mpegInstance.play().catch(err => {
          console.warn('[TvPlayer] Autoplay AceStream bloccato:', err);
        });
        return;
      } catch (e) {
        console.warn('[TvPlayer] Fallito avvio mpegts.js per AceStream, passo a HLS:', e);
      }
    }

    // Tentativo 2: Fallback HLS AceStream tramite Hls.js
    this.fallbackAceToHls(aceHash);
  }

  fallbackAceToHls(aceHash) {
    if (this.fallbackTriggered) return;
    this.fallbackTriggered = true;

    const auth = this.getAuthParam();
    const hlsUrl = `${this.serverBase}/stream/ace/${aceHash || ''}/manifest.m3u8${auth}`;
    console.log('[TvPlayer] Passaggio a fallback AceStream HLS:', hlsUrl);
    this.onStatusChange('loading', { channel: this.currentChannel, fallback: true });

    if (this.mpegInstance) {
      try {
        this.mpegInstance.pause();
        this.mpegInstance.unload();
        this.mpegInstance.detachMediaElement();
        this.mpegInstance.destroy();
      } catch (e) {}
      this.mpegInstance = null;
    }

    this.playHls(hlsUrl);
  }

  playMpegTs(url) {
    console.log('[TvPlayer] Avvio riproduzione MPEG-TS:', url);

    // Se mpegts.js è supportato (MSE)
    if (window.mpegts && mpegts.isSupported()) {
      try {
        this.mpegInstance = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: url
        }, {
          enableWorker: false, // Disabilitato per compatibilità con browser webOS più vecchi
          lazyLoadMaxDuration: 3 * 60,
          seekType: 'range',
          liveBufferLatencyChasing: false,
          liveBufferLatencyMaxLatency: 6,
          liveBufferLatencyMinRemain: 2,
          autoCleanupSourceBuffer: true
        });

        this.mpegInstance.on(mpegts.Events.ERROR, (type, detail, info) => {
          console.warn('[TvPlayer] Errore mpegts.js:', type, detail, info);
          this.handlePlaybackError('Errore flusso MPEG-TS');
        });

        if (mpegts.Events.MEDIA_INFO) {
          this.mpegInstance.on(mpegts.Events.MEDIA_INFO, () => {
            if (this.markPlaying) this.markPlaying();
          });
        }

        this.mpegInstance.attachMediaElement(this.video);
        this.mpegInstance.load();
        this.mpegInstance.play().catch(err => {
          console.warn('[TvPlayer] Autoplay mpegts bloccato:', err);
        });
        return;
      } catch (e) {
        console.warn('[TvPlayer] Fallito avvio mpegts.js, tento con tag video nativo:', e);
      }
    }

    // Fallback nativo webOS (alcune Smart TV LG decodificano il mime video/mp2t nativamente)
    this.playNative(url);
  }

  playHls(url) {
    console.log('[TvPlayer] Avvio riproduzione HLS:', url);

    // Priorità: Hls.js con buffer controllato
    if (window.Hls && Hls.isSupported()) {
      try {
        this.hlsInstance = new Hls({
          maxBufferLength: 8,
          maxMaxBufferLength: 20,
          liveSyncDurationCount: 3,
          enableWorker: false // Massima stabilità su TV LG
        });

        this.hlsInstance.loadSource(url);
        this.hlsInstance.attachMedia(this.video);

        this.hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          this.video.play().catch(() => {});
        });

        this.hlsInstance.on(Hls.Events.FRAG_LOADED, () => {
          if (this.markPlaying) this.markPlaying();
        });

        this.hlsInstance.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.warn('[TvPlayer] Errore fatale Hls.js:', data.type, data.details);
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                if (this.retryCount < this.maxRetries) {
                  this.retryCount++;
                  this.hlsInstance.startLoad();
                } else {
                  this.handlePlaybackError('Errore di rete sorgente');
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                this.hlsInstance.recoverMediaError();
                break;
              default:
                this.handlePlaybackError('Errore decodifica HLS');
                break;
            }
          }
        });
        return;
      } catch (e) {
        console.warn('[TvPlayer] Fallito avvio Hls.js, passo a tag nativo:', e);
      }
    }

    // Fallback HLS Nativo (webOS lo supporta egregiamente nei tag video standard)
    this.playNative(url);
  }

  playNative(url) {
    console.log('[TvPlayer] Avvio riproduzione nativa:', url);
    this.video.src = url;
    this.video.play().catch(e => {
      console.warn('[TvPlayer] Autoplay nativo rifiutato o fallito:', e);
    });
  }

  handlePlaybackError(msg) {
    if (!this.fallbackTriggered && this.currentChannel) {
      const ch = this.currentChannel;
      const aceHash = this.extractAceHash(ch);
      if (aceHash) {
        this.fallbackAceToHls(aceHash);
        return;
      }

      this.fallbackTriggered = true;
      const hasClearKey = ch.clearkey && !['0000', '0:0', '0'].includes(String(ch.clearkey).trim());

      if (hasClearKey || (ch.id && !ch.id.endsWith('_ffmpeg'))) {
        const auth = this.getAuthParam();
        const fallbackUrl = `${this.serverBase}/stream/mpd/${ch.id}.ts${auth}`;
        console.log('[TvPlayer] Auto-Fallback attivo verso FFmpeg Stream Copy centralizzato:', fallbackUrl);
        this.onStatusChange('loading', { channel: ch, fallback: true });
        this.playMpegTs(fallbackUrl);
        return;
      }
    }

    this.onStatusChange('error', { error: msg, channel: this.currentChannel });
  }
}

// Esporta istanza singleton globale
window.tvPlayer = new TvPlayer();
