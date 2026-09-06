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
    this.sessionId = 0;
    this.recoveryCount = 0;
    this.stableSeconds = 0;
    this.lastVideoFrames = null;
    this.videoFrozenSeconds = 0;
    this.started = false;
    this.lastMediaRecovery = 0;
  }

  init(videoEl, serverBaseUrl, onStatusChange) {
    this.video = videoEl;
    this.serverBase = (serverBaseUrl || window.location.origin).replace(/\/$/, '');
    this.onStatusChange = onStatusChange || (() => {});

    // Eventi video nativi
    this.markPlaying = () => {
      if (!this.currentChannel) return;
      this.onStatusChange('playing', { channel: this.currentChannel });
    };

    this.video.addEventListener('playing', () => this.markPlaying());

    this.video.addEventListener('waiting', () => {
      if (this.video && !this.video.paused) {
        this.onStatusChange('buffering', { channel: this.currentChannel });
      }
    });

    this.video.addEventListener('error', (e) => {
      if (!this.currentChannel || this.switchingEngine || !this.video.error || this.hlsInstance) return;
      console.warn('[TvPlayer] Errore elemento video nativo:', e);
      this.handlePlaybackError('Errore di decodifica video');
    });

  }

  startWatchdog() {
    if (this.stallCheckTimer) clearInterval(this.stallCheckTimer);
    this.stallCheckTimer = setInterval(() => this.checkPlayback(), 1000);
  }

  checkPlayback() {
    if (!this.video || !this.currentChannel) return;
    // A user pause must not restart the channel; initial buffering is still monitored.
    if (this.started && this.video.paused && !this.video.error) return;
    const curr = this.video.currentTime;
    const advancing = this.lastPlaybackTime !== null && curr > this.lastPlaybackTime + 0.05;
    this.lastPlaybackTime = curr;
    let frames = null;
    if (typeof this.video.getVideoPlaybackQuality === 'function') {
      const quality = this.video.getVideoPlaybackQuality();
      if (quality && typeof quality.totalVideoFrames === 'number' && quality.totalVideoFrames > 0) {
        frames = quality.totalVideoFrames - quality.droppedVideoFrames;
      }
    } else if (typeof this.video.webkitDecodedFrameCount === 'number' && this.video.webkitDecodedFrameCount > 0) {
      frames = this.video.webkitDecodedFrameCount;
    }
    // currentTime can keep advancing with audio while the video decoder is stuck.
    const videoStuck = this.video.videoWidth > 0 && frames !== null &&
      this.lastVideoFrames !== null && this.lastVideoFrames > 0 && frames === this.lastVideoFrames;
    this.lastVideoFrames = frames;
    this.videoFrozenSeconds = videoStuck ? this.videoFrozenSeconds + 1 : 0;
    this.frozenSeconds = advancing ? 0 : this.frozenSeconds + 1;
    if (advancing && !videoStuck) {
      this.started = true;
      this.stableSeconds++;
      this.markPlaying();
      if (this.stableSeconds >= 30) {
        this.retryCount = 0;
        this.recoveryCount = 0;
      }
    } else {
      this.stableSeconds = 0;
    }
    const stalled = Math.max(this.frozenSeconds, this.videoFrozenSeconds);
    if (stalled === 3) this.onStatusChange('buffering', { channel: this.currentChannel });
    if (stalled >= (this.started ? 12 : 45)) {
      this.restartPlayback('Flusso bloccato: nessun avanzamento audio/video');
    }
  }

  restartPlayback(msg) {
    if (!this.currentChannel) return;
    if (this.recoveryCount >= this.maxRetries) {
      this.failPlayback(msg);
      return;
    }
    this.recoveryCount++;
    console.warn('[TvPlayer] Recupero completo audio/video:', msg);
    this.play(this.currentChannel, true);
  }

  failPlayback(msg) {
    const channel = this.currentChannel;
    this.stop();
    this.onStatusChange('error', { error: msg, channel });
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

  stop() {
    this.sessionId++;
    this.currentChannel = null;
    if (this.stallCheckTimer) {
      clearInterval(this.stallCheckTimer);
      this.stallCheckTimer = null;
    }
    this.lastPlaybackTime = null;
    this.frozenSeconds = 0;
    this.lastVideoFrames = null;
    this.videoFrozenSeconds = 0;
    this.stableSeconds = 0;
    this.started = false;
    this.destroyEngines();

    if (this.video) {
      try {
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
      } catch (e) {}
    }
    this.fallbackTriggered = false;
  }

  destroyEngines() {
    // Invalidate callbacks before destroying either MediaSource owner.
    this.sessionId++;
    this.switchingEngine = true;
    this.hideAutoplayPrompt();
    if (this.hlsInstance) {
      try { this.hlsInstance.destroy(); } catch (e) {}
      this.hlsInstance = null;
    }
    if (this.mpegInstance) {
      const engine = this.mpegInstance;
      this.mpegInstance = null;
      ['pause', 'unload', 'detachMediaElement', 'destroy'].forEach(method => {
        try { engine[method](); } catch (e) {}
      });
    }
    this.switchingEngine = false;
  }

  attemptPlay(playPromise, context = '') {
    if (!playPromise || typeof playPromise.catch !== 'function') {
      return Promise.resolve();
    }
    return playPromise.catch(err => {
      console.warn(`[TvPlayer] Autoplay ${context} bloccato:`, err);
      // Fallback per policy del browser (audio non consentito prima di interazione utente):
      // Avvia con volume azzerato (consentito da tutti i browser) e mostra prompt di sblocco
      if (this.video && !this.video.muted) {
        console.log(`[TvPlayer] Attivazione riproduzione silenziosa di sicurezza (muted autoplay)...`);
        this.video.muted = true;
        this.showAutoplayPrompt();
        const retry = (this.mpegInstance && typeof this.mpegInstance.play === 'function')
          ? this.mpegInstance.play()
          : this.video.play();
        if (retry && typeof retry.catch === 'function') {
          retry.catch(e2 => {
            console.warn('[TvPlayer] Muted autoplay fallito:', e2);
          });
        }
      }
    });
  }

  showAutoplayPrompt() {
    if (typeof document === 'undefined') return;
    let prompt = document.getElementById('autoplay-unmute-prompt');
    if (!prompt) {
      prompt = document.createElement('div');
      prompt.id = 'autoplay-unmute-prompt';
      prompt.className = 'autoplay-unmute-pill';
      prompt.innerHTML = '🔊 <span>Audio disattivato dal browser. Clicca o premi un tasto per attivarlo</span>';
      document.body.appendChild(prompt);
    }
    prompt.classList.remove('hidden');

    const unlock = () => {
      if (this.video) {
        this.video.muted = false;
      }
      this.hideAutoplayPrompt();
      if (typeof window !== 'undefined') {
        window.removeEventListener('click', unlock, true);
        window.removeEventListener('keydown', unlock, true);
        window.removeEventListener('touchstart', unlock, true);
      }
    };
    prompt.onclick = unlock;
    if (typeof window !== 'undefined') {
      window.addEventListener('click', unlock, true);
      window.addEventListener('keydown', unlock, true);
      window.addEventListener('touchstart', unlock, true);
    }
  }

  hideAutoplayPrompt() {
    if (typeof document === 'undefined') return;
    const prompt = document.getElementById('autoplay-unmute-prompt');
    if (prompt) {
      prompt.classList.add('hidden');
    }
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

  usesWarp(channel) {
    const url = channel.url || '';
    if (channel.source === 'htsport' || /htsport/i.test(`${channel.group || ''} ${channel.customGroup || ''}`) ||
        /htsport|tvnow/i.test(url)) return false;
    return channel.useWarp === true || ['warp_direct', 'ffmpeg_copy'].includes(channel.streamMode) ||
      /WARP/i.test(`${channel.title || ''} ${channel.customTitle || ''}`) || /asn(?:%3A|:)13335/i.test(url);
  }

  ffmpegUrl(channel) {
    const params = new URLSearchParams();
    if (this.authToken) params.set('token', this.authToken);
    if (this.usesWarp(channel)) params.set('warp', '1');
    let path = '/stream/mpd';
    if (channel.id) {
      path += `/${encodeURIComponent(channel.id)}.ts`;
    } else {
      params.set('url', (channel.url || '').split('|')[0]);
      const key = channel.clearkey || (channel.kodi_props || {})['inputstream.adaptive.license_key'];
      if (key) params.set('key', key);
      if (channel.headers) params.set('headers', channel.headers);
    }
    return `${this.serverBase}${path}${params.toString() ? '?' + params.toString() : ''}`;
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

    // Catalog entries contain source manifests, unlike the already routed M3U export.
    const props = channel.kodi_props || {};
    const key = channel.clearkey || props['inputstream.adaptive.license_key'];
    const isDash = /\.mpd(?:[?#|]|$)/i.test(url) || props['inputstream.adaptive.manifest_type'] === 'mpd' ||
      (key && !['0000', '0:0', '0'].includes(String(key).trim()));
    if (channel.streamMode === 'ffmpeg_copy' || channel.mpdProxy === true ||
        (channel.id && channel.id.endsWith('_ffmpeg')) || isDash) {
      return this.ffmpegUrl(channel);
    }

    if (this.usesWarp(channel) && !url.startsWith('/stream/') && !url.includes('/api/stream/proxy')) {
      const parts = url.split('|');
      const params = new URLSearchParams({ url: parts[0], warp: '1' });
      if (this.authToken) params.set('token', this.authToken);
      // The TV cannot set these CDN request headers on a native video element.
      const sourceHeaders = channel.headers || parts[1] || '';
      const headers = typeof sourceHeaders === 'string' ? new URLSearchParams(sourceHeaders) : sourceHeaders;
      const addHeader = (value, name) => {
        const target = { referer: 'referer', origin: 'origin', 'user-agent': 'ua' }[name.toLowerCase()];
        if (target) params.set(target, value);
      };
      if (headers instanceof URLSearchParams) headers.forEach(addHeader);
      else Object.keys(headers).forEach(name => addHeader(headers[name], name));
      const isHls = /\.m3u8(?:[?#]|$)/i.test(parts[0]) || props['inputstream.adaptive.manifest_type'] === 'hls';
      return `${this.serverBase}/api/stream/proxy${isHls ? '.m3u8' : ''}?${params}`;
    }

    // Se l'URL è relativo (/stream/...), risolvilo rispetto all'indirizzo server iosonofratv
    if (url.startsWith('/')) {
      return `${this.serverBase}${url}${auth ? (url.includes('?') ? '&' + auth.slice(1) : auth) : ''}`;
    }
    return url;
  }

  async play(channel, recovering = false) {
    this.stop();
    this.currentChannel = channel;
    this.fallbackTriggered = false;
    this.retryCount = 0;
    this.lastMediaRecovery = 0;
    if (!recovering) this.recoveryCount = 0;

    const streamUrl = this.resolveUrl(channel);
    if (!streamUrl) {
      this.onStatusChange('error', { error: 'URL canale vuoto o non valido' });
      return;
    }

    this.onStatusChange('loading', { channel, url: streamUrl });
    this.startWatchdog();

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
      /\.ts(?:[?#|]|$)/i.test(channel.url || '') ||
      /\.ts(?:[?#]|$)/i.test(streamUrl) ||
      streamUrl.startsWith(`${this.serverBase}/stream/mpd?`);

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
      const fallbackUrl = this.ffmpegUrl(channel);
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
    this.destroyEngines();
    const session = this.sessionId;
    console.log('[TvPlayer] Avvio riproduzione AceStream:', aceHash, streamUrl);

    if (streamUrl.includes('manifest.m3u8')) {
      this.fallbackAceToHls(aceHash);
      return;
    }

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
                    liveBufferLatencyChasing: false, // Disabilitato: inseguimento via seek provoca salto indietro al keyframe precedente e desync A/V
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 60, // Limita memoria occupata sulla TV
          autoCleanupMinBackwardDuration: 15, // Preserva i keyframe recenti
          fixAudioTimestampGap: true // Sincronizza i timestamp audio se c'è un gap
        });

        this.mpegInstance.on(mpegts.Events.ERROR, (type, detail, info) => {
          if (session !== this.sessionId) return;
          console.warn('[TvPlayer] Errore mpegts.js AceStream:', type, detail, info);
          const isFatal = /network/i.test(String(type)) || /network/i.test(String(detail)) || (info && info.fatal);
          if (isFatal) {
            this.fallbackAceToHls(aceHash);
          }
        });

        this.mpegInstance.attachMediaElement(this.video);
        this.mpegInstance.load();
        this.attemptPlay(this.mpegInstance.play(), 'AceStream');
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

    this.playHls(hlsUrl);
  }

  playMpegTs(url) {
    this.destroyEngines();
    const session = this.sessionId;
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
          liveBufferLatencyChasing: false, // Disabilitato: inseguimento via seek provoca salto indietro al keyframe precedente e desync A/V
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 60, // Limita memoria occupata sulla TV
          autoCleanupMinBackwardDuration: 15, // Preserva i keyframe recenti
          fixAudioTimestampGap: true // Sincronizza i timestamp audio se c'è un gap
        });

        this.mpegInstance.on(mpegts.Events.ERROR, (type, detail, info) => {
          if (session !== this.sessionId) return;
          console.warn('[TvPlayer] Errore mpegts.js:', type, detail, info);
          const isFatal = /network/i.test(String(type)) || /network/i.test(String(detail)) || (info && info.fatal);
          if (isFatal) {
            this.handlePlaybackError('Errore flusso MPEG-TS');
          }
        });

        this.mpegInstance.attachMediaElement(this.video);
        this.mpegInstance.load();
        this.attemptPlay(this.mpegInstance.play(), 'MPEG-TS');
        return;
      } catch (e) {
        console.warn('[TvPlayer] Fallito avvio mpegts.js, tento con tag video nativo:', e);
      }
    }

    // Fallback nativo webOS (alcune Smart TV LG decodificano il mime video/mp2t nativamente)
    this.playNative(url);
  }

  playHls(url) {
    this.destroyEngines();
    const session = this.sessionId;
    console.log('[TvPlayer] Avvio riproduzione HLS:', url);

    // Priorità: Hls.js con buffer controllato
    if (window.Hls && Hls.isSupported()) {
      try {
        this.hlsInstance = new Hls({
          maxBufferLength: 20,
          maxMaxBufferLength: 30,
          backBufferLength: 30,
          maxBufferSize: 30 * 1000 * 1000,
          lowLatencyMode: false,
          liveSyncDurationCount: 3,
          enableWorker: false // Massima stabilità su TV LG
        });

        this.hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          if (session !== this.sessionId) return;
          this.attemptPlay(this.video.play(), 'HLS');
        });

        this.hlsInstance.on(Hls.Events.ERROR, (event, data) => {
          if (session !== this.sessionId) return;
          if (data.fatal) {
            this.stableSeconds = 0;
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
                if (this.retryCount < this.maxRetries &&
                    (!this.lastMediaRecovery || Date.now() - this.lastMediaRecovery >= 5000)) {
                  this.retryCount++;
                  this.lastMediaRecovery = Date.now();
                  this.hlsInstance.recoverMediaError();
                } else {
                  this.restartPlayback('Errore persistente di decodifica HLS');
                }
                break;
              default:
                this.handlePlaybackError('Errore decodifica HLS');
                break;
            }
          }
        });
        this.hlsInstance.loadSource(url);
        this.hlsInstance.attachMedia(this.video);
        return;
      } catch (e) {
        console.warn('[TvPlayer] Fallito avvio Hls.js, passo a tag nativo:', e);
      }
    }

    // Fallback HLS Nativo (webOS lo supporta egregiamente nei tag video standard)
    this.playNative(url);
  }

  playNative(url) {
    this.destroyEngines();
    console.log('[TvPlayer] Avvio riproduzione nativa:', url);
    this.video.src = url;
    this.attemptPlay(this.video.play(), 'Native');
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

      const isDash = hasClearKey || ch.mpdProxy === true ||
        (ch.url && /\.mpd(?:[?#]|$)/i.test(ch.url)) ||
        (ch.kodi_props && ch.kodi_props['inputstream.adaptive.manifest_type'] === 'mpd');
      if (isDash && ch.streamMode !== 'ffmpeg_copy' && ch.id && !ch.id.endsWith('_ffmpeg')) {
        const fallbackUrl = this.ffmpegUrl(ch);
        console.log('[TvPlayer] Auto-Fallback attivo verso FFmpeg Stream Copy centralizzato:', fallbackUrl);
        this.onStatusChange('loading', { channel: ch, fallback: true });
        this.playMpegTs(fallbackUrl);
        return;
      }
    }

    this.restartPlayback(msg);
  }
}

// Esporta istanza singleton globale
window.tvPlayer = new TvPlayer();
