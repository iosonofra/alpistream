const fs = require('fs');
const path = require('path');
const storage = require('./storage');

class EventsManager {
  constructor() {
    this.events = [];
    this.lastUpdate = null;
  }

  detectSport(title, group = '') {
    const text = `${title} ${group}`.toLowerCase();

    if (text.match(/f1|formula\s*1|motogp|moto2|moto3|superbike|sbk|nascar|indycar|wrc|rally|gp\s*di/i)) {
      return 'motori';
    }
    if (text.match(/tennis|atp|wta|wimbledon|roland\s*garros|us\s*open|australian\s*open|sinner|alcaraz|djokovic/i)) {
      return 'tennis';
    }
    if (text.match(/nba|basket|baloncesto|euroleague|lba|olimpia|virtus|celtics|lakers|warriors|fiba/i)) {
      return 'basket';
    }
    if (text.match(/ufc|boxing|boxe|mma|wwe|fight|bellator/i)) {
      return 'combattimento';
    }
    if (text.match(/golf|pga|ryder/i)) {
      return 'golf';
    }
    if (text.match(/rugby|six\s*nations|sei\s*nazioni/i)) {
      return 'rugby';
    }
    if (text.match(/serie\s*a|serie\s*b|premier|laliga|la\s*liga|bundesliga|ligue\s*1|champions|europa\s*league|conference|coppa\s*italia|milan|inter|juve|juventus|napoli|roma|lazio|atalanta|fiorentina|bologna|torino|monza|verona|genoa|cagliari|parma|como|venezia|empoli|lecce|udinese|real\s*madrid|barcelona|atletico|liverpool|arsenal|manchester|chelsea|tottenham|bayern|psg|futbol|football|calcio/i)) {
      return 'calcio';
    }
    return 'calcio'; // Default per eventi sportivi
  }

  parseTimeFromTitle(title) {
    // Cerca pattern orario: 18:30, 20.45, 15:00, etc.
    const match = title.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      return {
        timeStr: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
        hours,
        minutes
      };
    }
    return null;
  }

  calculateStatus(hours, minutes) {
    if (hours === null || hours === undefined) return 'UPCOMING';

    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();

    const eventTotalMinutes = hours * 60 + minutes;
    const currentTotalMinutes = currentHours * 60 + currentMinutes;

    // Durata media match sportivo: 2 ore e 15 minuti (135 min)
    if (currentTotalMinutes >= eventTotalMinutes && currentTotalMinutes <= eventTotalMinutes + 135) {
      return 'LIVE_NOW';
    } else if (currentTotalMinutes < eventTotalMinutes) {
      return 'UPCOMING';
    } else {
      return 'FINISHED';
    }
  }

  cleanMatchTitle(rawTitle) {
    let clean = rawTitle;

    // 1. Rimuovi tag tecnici o linguistici completi tra parentesi (es. (ITA - MPD), (720p), (SPA - ACE), [HD], [4K])
    clean = clean.replace(/[\(\[]\s*(?:[A-Z]{2,3}\s*-\s*[A-Z0-9\s]+|ITA|ENG|SPA|GER|FRA|POL|PT|RU|GR|NL|MULTI|HD|FHD|4K|SD|720p|1080p|MPD|M3U8|ACE|WARP|HLS|Opz\.\s*[0-9]+|online|backup)\s*[\)\]]/gi, '');

    // 2. Rimuovi orari ovunque siano inseriti (es. "19:00 ", "21:00")
    clean = clean.replace(/(?:^|\s)[0-2]?[0-9][:.][0-5][0-9](?:\s|$)/g, ' ');

    // 3. Se alla fine del match c'è il nome canale tra parentesi (es. "Qatar vs Switzerland (BEIN SPORTS 1)"), rimuovilo dal titolo match
    clean = clean.replace(/\s*\([^)]*(?:sport|dazn|sky|bein|eurosport|stream|canal|match|tnt|ziggo|optus|espn)[^)]*\)\s*$/i, '');

    // 4. Se rimangono quadre informative (es. [DAZN F] o [ACI SPORT]), togli solo i delimitatori lasciando il nome
    clean = clean.replace(/\[([^\]]+)\]/g, ' $1 ');
    clean = clean.replace(/\(([^)]+)\)/g, ' $1 ');

    // 5. Pulisci spazi e trattini
    clean = clean.replace(/\s+/g, ' ').replace(/^[-–—\s|:]+|[-–—\s|:]+$/g, '').trim();

    return clean || rawTitle;
  }

  extractTournament(title, group) {
    const text = `${title} ${group}`.toLowerCase();
    if (text.includes('serie a')) return 'Serie A Enilive';
    if (text.includes('serie b')) return 'Serie BKT';
    if (text.includes('champions')) return 'UEFA Champions League';
    if (text.includes('europa league')) return 'UEFA Europa League';
    if (text.includes('conference')) return 'UEFA Conference League';
    if (text.includes('premier')) return 'Premier League';
    if (text.includes('laliga') || text.includes('la liga')) return 'LaLiga EA Sports';
    if (text.includes('bundesliga')) return 'Bundesliga';
    if (text.includes('ligue 1')) return 'Ligue 1 McDonald\'s';
    if (text.includes('f1') || text.includes('formula 1')) return 'Formula 1';
    if (text.includes('motogp')) return 'MotoGP World Championship';
    if (text.includes('nba')) return 'NBA Basketball';
    if (text.includes('baloncesto')) return 'Liga ACB Baloncesto';
    if (text.includes('atp') || text.includes('wta') || text.includes('tennis')) return 'Tennis Tour';
    if (text.includes('golf')) return 'Golf PGA Tour';
    if (text.includes('rally')) return 'World Rally Championship';
    if (text.includes('ufc')) return 'UFC Fight Night';
    if (text.includes('coppa italia')) return 'Coppa Italia Frecciarossa';
    return group.replace('SPORT - Last Minute - ', '').replace('SPORT - ', '').replace('CANALI - ', '') || 'Evento Sportivo';
  }

  refreshEvents() {
    const allChannels = storage.getChannels();
    const eventMap = new Map();

    // 1. Trova tutti i canali lineari (Sky Sport, DAZN, Eurosport, TNT) per abbinamenti
    const linearChannels = allChannels.filter(c => {
      const g = (c.group || '').toLowerCase();
      const t = (c.title || '').toLowerCase();
      return (
        g.includes('sky sport') ||
        g.includes('sky 2') ||
        g.includes('mediahosting') ||
        t.includes('dazn') ||
        t.includes('eurosport') ||
        t.includes('sport uno') ||
        t.includes('sport calcio')
      );
    });

    // 2. Raccogli tutti i canali/stream che rappresentano eventi
    allChannels.forEach(ch => {
      const title = ch.title || '';
      const group = ch.group || '';
      const timeInfo = this.parseTimeFromTitle(title);

      // È un evento se ha un orario nel titolo OPPURE se fa parte di sezioni eventi
      const isEventSection = group.includes('Last Minute') || group.includes('Liste Eventi') || group.includes('Socceron') || group.includes('Daddy');
      if (!timeInfo && !isEventSection) return;

      const cleanTitle = this.cleanMatchTitle(title);
      if (cleanTitle.length < 3) return;

      const sport = this.detectSport(cleanTitle, group);
      const tournament = this.extractTournament(cleanTitle, group);
      const timeStr = timeInfo ? timeInfo.timeStr : 'Oggi';
      const hours = timeInfo ? timeInfo.hours : null;
      const minutes = timeInfo ? timeInfo.minutes : null;
      const status = this.calculateStatus(hours, minutes);

      // Se è un match (ha squadre tipo "X - Y" o "X vs Y" o orario), aggrega per match
      // Se è un canale sportivo dedicato continuo, mantieni chiave univoca per non collassare canali diversi
      const hasMatchSeparator = cleanTitle.includes(' - ') || cleanTitle.toLowerCase().includes(' vs ');
      const isEventMatch = Boolean(timeInfo || hasMatchSeparator);
      const eventKey = isEventMatch
        ? `${timeStr}_${cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '')}`
        : `ch_${ch.id}`;

      if (!eventMap.has(eventKey)) {
        eventMap.set(eventKey, {
          id: `ev_${Buffer.from(eventKey).toString('base64').substring(0, 16)}`,
          title: cleanTitle,
          rawTitle: title,
          time: timeStr,
          hours,
          minutes,
          sport,
          tournament,
          status,
          officialChannels: [],
          directStreams: []
        });
      }


      const ev = eventMap.get(eventKey);

      // Aggiungi stream diretto
      ev.directStreams.push({
        id: ch.id,
        title: ch.title,
        group: ch.group,
        customGroup: ch.customGroup,
        useWarp: ch.useWarp,
        mpdProxy: ch.mpdProxy,
        streamMode: ch.streamMode,
        logo: ch.logo,
        url: ch.url,
        clearkey: ch.clearkey,
        headers: ch.headers,
        kodi_props: ch.kodi_props
      });
    });

    // 3. Abbina canali TV lineari ufficiali in base a squadre o competizione
    const eventList = Array.from(eventMap.values());
    eventList.forEach(ev => {
      const lowerTitle = ev.title.toLowerCase();

      linearChannels.forEach(lch => {
        const lTitle = (lch.title || '').toLowerCase();
        let matched = false;

        // Se il match è F1 o MotoGP
        if (ev.sport === 'motori') {
          if (lowerTitle.includes('f1') && lTitle.includes('f1')) matched = true;
          if (lowerTitle.includes('motogp') && lTitle.includes('motogp')) matched = true;
        }

        // Se il match è Calcio italiano
        if (ev.sport === 'calcio') {
          if (ev.tournament.includes('Serie A') || ev.tournament.includes('Champions') || ev.tournament.includes('Europa')) {
            if (lTitle.includes('sport calcio') || lTitle.includes('sport uno') || lTitle.includes('sport 24') || lTitle.includes('dazn')) {
              matched = true;
            }
          }
        }

        // Se il match è Tennis
        if (ev.sport === 'tennis' && (lTitle.includes('tennis') || lTitle.includes('eurosport') || lTitle.includes('sport uno'))) {
          matched = true;
        }

        // Se il match è Basket
        if (ev.sport === 'basket' && (lTitle.includes('nba') || lTitle.includes('basket') || lTitle.includes('eurosport'))) {
          matched = true;
        }

        if (matched && !ev.officialChannels.some(c => c.id === lch.id)) {
          ev.officialChannels.push({
            id: lch.id,
            title: lch.title,
            group: lch.group,
            customGroup: lch.customGroup,
            useWarp: lch.useWarp,
            mpdProxy: lch.mpdProxy,
            streamMode: lch.streamMode,
            logo: lch.logo,
            url: lch.url,
            clearkey: lch.clearkey,
            headers: lch.headers,
            kodi_props: lch.kodi_props
          });
        }
      });
    });

    // Ordina eventi: prima i LIVE_NOW, poi per orario crescente
    eventList.sort((a, b) => {
      if (a.status === 'LIVE_NOW' && b.status !== 'LIVE_NOW') return -1;
      if (b.status === 'LIVE_NOW' && a.status !== 'LIVE_NOW') return 1;
      const timeA = (a.hours || 0) * 60 + (a.minutes || 0);
      const timeB = (b.hours || 0) * 60 + (b.minutes || 0);
      return timeA - timeB;
    });

    this.events = eventList;
    this.lastUpdate = new Date().toISOString();

    // Salva cache su disco
    const cacheFile = path.join(__dirname, '..', 'data', 'events.json');
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(this.events, null, 2), 'utf-8');
    } catch (e) {}

    return this.events;
  }

  getEvents(filters = {}) {
    if (this.events.length === 0) {
      this.refreshEvents();
    }

    let list = [...this.events];

    // Aggiorna lo stato LIVE_NOW in tempo reale
    list = list.map(ev => ({
      ...ev,
      status: this.calculateStatus(ev.hours, ev.minutes)
    }));

    if (filters.sport && filters.sport !== 'all') {
      list = list.filter(e => e.sport === filters.sport);
    }

    if (filters.status && filters.status !== 'all') {
      list = list.filter(e => e.status === filters.status);
    }

    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(e =>
        e.title.toLowerCase().includes(q) ||
        e.tournament.toLowerCase().includes(q) ||
        e.time.toLowerCase().includes(q)
      );
    }

    return {
      total: list.length,
      lastUpdate: this.lastUpdate,
      liveCount: list.filter(e => e.status === 'LIVE_NOW').length,
      events: list
    };
  }
}

const eventsManager = new EventsManager();
module.exports = eventsManager;
