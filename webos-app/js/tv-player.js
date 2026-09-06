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
    this.stallCheckTimer = null;
    this.lastPlaybackTime = null;
    this.frozenSeconds = 0;
  }

  init(videoEl, serverBaseUrl, onStatusChange) {
    this.video = videoEl;
    this.serverBase = (serverBaseUrl || window.location.origin).replace(/\/$/, '');
    this.onStatusChange = onStatusChange || (() => {});

    // Eventi video nativi
    this.markPlaying = () => {
      this.retryCount = 0;
      this.frozenSeconds = 0;
      this.onStatusChange('playing', { channel: this.currentChannel });
    };

    this.video.addEventListener('playing', () => this.markPlaying());
    this.video.addEventListener('canplay', () => this.markPlaying());
    this.video.addEventListener('loadeddata', () => this.markPlaying());
    this.video.addEventListener('timeupdate', () => {
      if (this.video && !this.video.paused) {
        this.markPlaying();
      }
    });

    this.video.addEventListener('waiting', () => {
      if (this.video && !this.video.paused) {
        this.onStatusChange('buffering', { channel: this.currentChannel });
      }
    });

    this.video.addEventListener('error', (e) => {
      console.warn('[TvPlayer] Errore elemento video nativo:', e);
      this.handlePlaybackError('Errore di decodifica video');
    });

    // Watchdog anti-blocco e anti-desync A/V (attivo ogni secondo durante la riproduzione)
    if (this.stallCheckTimer) clearInterval(this.stallCheckTimer);
    this.stallCheckTimer = setInterval(() => {
      if (!this.video || this.video.paused || this.video.readyState < 2) return;

      const curr = this.video.currentTime;
      if (this.lastPlaybackTime !== null && Math.abs(this.lastPlaybackTime - curr) < 0.05) {
        this.frozenSeconds = (this.frozenSeconds || 0) + 1;
        // Se il tempo è bloccato da oltre 3 secondi ma il buffer è andato avanti (MSE gap)
        if (this.frozenSeconds >= 3) {
          if (this.video.buffered && this.video.buffered.length > 0) {
            const bufEnd = this.video.buffered.end(this.video.buffered.length - 1);
            if (bufEnd > curr + 0.6) {
              console.warn(`[TvPlayer Watchdog] Rilevato blocco buffer MSE (currentTime: ${curr.toFixed(2)}, bufEnd: ${bufEnd.toFixed(2)}), sblocco istantaneo verso la diretta.`);
              this.video.currentTime = Math.max(0, bufEnd - 0.3);
              this.frozenSeconds = 0;
              return;
            }
          }
          console.warn('[TvPlayer Watchdog] Riproduzione bloccata, notifica buffering per recovery.');
          this.onStatusChange('buffering', { channel: this.currentChannel });
        }
      } else {
        this.lastPlaybackTime = curr;
        this.frozenSeconds = 0;
      }
    }, 1000);
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
    if (this.stallCheckTimer) {
      clearInterval(this.stallCheckTimer);
      this.stallCheckTimer = null;
    }
    this.lastPlaybackTime = null;
    this.frozenSeconds = 0;

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

    // 2. Riconoscimento stream MPEG-TS Server Copy o canali MPD/ClearKey
    const isMpegTs = channel.streamMode === 'ffmpeg_copy' ||
      channel.mpdProxy === true ||
      (channel.id && channel.id.endsWith('_ffmpeg')) ||
      streamUrl.includes('/stream/mpd/') ||
      streamUrl.endsWith('.ts');

    const isMpdOrDrm = !isMpegTs && (
      streamUrl.includes('.mpd') ||
      streamUrl.includes('/mpd') ||
      (channel.kodi_props && channel.kodi_props['inputstream.adaptive.manifest_type'] === 'mpd') ||
      (channel.clearkey && !['0000', '0:0', '0'].includes(String(channel.clearkey).trim()))
    );

    if (isMpegTs) {
      this.playMpegTs(streamUrl);
      return;
    }

    if (isMpdOrDrm) {
      const auth = this.getAuthParam();
      const fallbackUrl = `${this.serverBase}/stream/mpd/${channel.id}.ts${auth}`;
      console.log('[TvPlayer] Canale MPD/DRM rilevato, avvio diretto FFmpeg stream copy:', fallbackUrl);
      this.playMpegTs(fallbackUrl);
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
          lazyLoad: false, // Disabilitato per streaming live continuo (evita caduta socket e buffer gap)
          lazyLoadMaxDuration: 0,
          seekType: 'param', // Stream live continuo senza Range headers
          liveBufferLatencyChasing: true, // Insegui la diretta per prevenire accumulo di buffer e desync A/V
          liveBufferLatencyMaxLatency: 3.5,
          liveBufferLatencyMinRemain: 1.0,
          liveBufferLatencyChasingOnPaused: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 60, // Mantieni 60s di storico
          autoCleanupMinBackwardDuration: 30, // MAI eliminare i blocchi recenti dietro la testina (evita loop-back!)
          fixAudioTimestampGap: true // Sincronizza i timestamp audio se c'è un gap
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

        if (mpegts.Events.STATISTICS_INFO) {
          this.mpegInstance.on(mpegts.Events.STATISTICS_INFO, (stat) => {
            if (stat && (stat.decodedFrames > 0 || stat.speed > 0)) {
              this.markPlaying();
            }
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

    if (this.video) {
      try {
        this.video.removeAttribute('src');
        this.video.load();
      } catch (e) {}
    }

    // Se mpegts.js è supportato (MSE)
    if (window.mpegts && mpegts.isSupported()) {
      try {
        this.mpegInstance = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: url
        }, {
          enableWorker: false, // Disabilitato per compatibilità con browser webOS più vecchi
          lazyLoad: false, // Disabilitato per streaming live continuo (evita caduta socket e buffer gap)
          lazyLoadMaxDuration: 0,
          seekType: 'param', // Stream live continuo senza Range headers
          liveBufferLatencyChasing: true, // Insegui la diretta per prevenire accumulo di buffer e desync A/V
          liveBufferLatencyMaxLatency: 3.5,
          liveBufferLatencyMinRemain: 1.0,
          liveBufferLatencyChasingOnPaused: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 60, // Mantieni 60s di storico
          autoCleanupMinBackwardDuration: 30, // MAI eliminare i blocchi recenti dietro la testina (evita loop-back!)
          fixAudioTimestampGap: true // Sincronizza i timestamp audio se c'è un gap
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

        if (mpegts.Events.STATISTICS_INFO) {
          this.mpegInstance.on(mpegts.Events.STATISTICS_INFO, (stat) => {
            if (stat && (stat.decodedFrames > 0 || stat.speed > 0)) {
              if (this.markPlaying) this.markPlaying();
            }
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

        this.hlsInstance.on(Hls.Events.FRAG_PARSED, () => {
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
