const cron = require('node-cron');
const { getConfig, getChannels, saveChannels } = require('./storage');
const { ExtractorEngine } = require('./extractor');
const epgManager = require('./epg');
const eventsManager = require('./events');

class Scheduler {
  constructor() {
    this.task = null;
    this.eventsTask = null;
    this.isExtracting = false;
    this.lastExtractionTime = null;
    this.extractor = new ExtractorEngine({ concurrency: 25 });
  }

  init() {
    const config = getConfig();
    if (config.cronEnabled && config.cronSchedule) {
      this.startCron(config.cronSchedule);
    }
  }

  startCron(schedule) {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    if (this.eventsTask) {
      this.eventsTask.stop();
      this.eventsTask = null;
    }

    if (!cron.validate(schedule)) {
      console.error(`[Scheduler] Cron expression non valida: "${schedule}". Uso default: "0 */4 * * *"`);
      schedule = '0 */4 * * *';
    }

    console.log(`[Scheduler] Avviato timer cron di aggiornamento con schedule: "${schedule}"`);
    this.task = cron.schedule(schedule, async () => {
      console.log('[Scheduler] Esecuzione trigger automatico di estrazione playlist ed EPG...');
      await this.triggerExtraction();
    });

    // Cron ogni 30 minuti per ricalcolo eventi sportivi live
    this.eventsTask = cron.schedule('*/30 * * * *', () => {
      console.log('[Scheduler] Aggiornamento palinsesto eventi sportivi live...');
      eventsManager.refreshEvents();
    });
  }

  async triggerExtraction() {
    if (this.isExtracting) {
      return { success: false, message: 'Estrazione già in corso' };
    }

    this.isExtracting = true;
    try {
      const config = getConfig();
      const activeSourceIds = config.activeSources || [];

      // 1. Esegui estrazione canali
      const extractedChannels = await this.extractor.runExtraction(activeSourceIds);

      // 2. Preserva modifiche personalizzate (enabled, custom name, custom group, tvgId)
      const existingChannels = getChannels();
      const existingMap = new Map();
      existingChannels.forEach(ch => {
        if (ch.id) existingMap.set(ch.id, ch);
        if (ch.title) existingMap.set(ch.title, ch);
      });

      const updatedChannels = extractedChannels.map(ch => {
        const existing = existingMap.get(ch.id) || existingMap.get(ch.title);
        const autoTvgId = epgManager.getAutoTvgId(ch.title);

        if (existing) {
          return {
            ...ch,
            title: existing.customTitle || ch.title,
            originalTitle: ch.title,
            group: existing.customGroup || ch.group,
            originalGroup: ch.group,
            logo: existing.customLogo || ch.logo,
            tvgId: existing.tvgId || autoTvgId,
            enabled: existing.enabled !== undefined ? existing.enabled : true
          };
        }

        return {
          ...ch,
          tvgId: autoTvgId,
          enabled: true
        };
      });

      saveChannels(updatedChannels);
      this.lastExtractionTime = new Date();

      // 3. Trigger aggiornamento EPG ed Eventi in background
      eventsManager.refreshEvents();
      epgManager.updateEPG().catch(err => console.error('[Scheduler] Errore update EPG:', err.message));

      this.isExtracting = false;
      return {
        success: true,
        count: updatedChannels.length,
        time: this.lastExtractionTime
      };
    } catch (err) {
      this.isExtracting = false;
      console.error('[Scheduler] Errore durante l\'estrazione:', err.message);
      return { success: false, error: err.message };
    }
  }

  getStatus() {
    return {
      isExtracting: this.isExtracting,
      lastExtractionTime: this.lastExtractionTime,
      logs: this.extractor.logs
    };
  }
}

module.exports = new Scheduler();
