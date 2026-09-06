const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');
const CUSTOM_CHANNELS_FILE = path.join(DATA_DIR, 'custom_channels.json');

const DEFAULT_CONFIG = {
  port: 3000,
  authToken: '', // Optional token for URL access
  adminPassword: '', // Optional password for Web UI
  aceStreamHost: '127.0.0.1:6878', // Host/Port di Ace Stream Engine
  aceStreamProxyEnabled: true, // Riscrittura automatica link AceStream tramite proxy MandraKodi
  mpdProxyEnabled: true, // Riscrittura automatica canali MPD ClearKey tramite proxy FFmpeg MandraKodi
  cronSchedule: '0 */4 * * *', // Default every 4 hours
  cronEnabled: true,
  maxWorkers: 25,
  defaultUserAgent: 'MandraKodi2@@2.2.1@@MandraKodi3@@MKD123',
  activeSources: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '14', '15'],
  epgSources: [
    {
      id: 'epgshare-it',
      name: 'EPGShare Italia (Sky, DAZN, Cinema, Sport, DTT)',
      url: 'https://epgshare01.online/epgshare01/epg_ripper_IT1.xml.gz',
      enabled: true
    },
    {
      id: 'epgshare-uk',
      name: 'EPGShare United Kingdom (Sky UK, TNT Sports, BBC)',
      url: 'https://epgshare01.online/epgshare01/epg_ripper_UK1.xml.gz',
      enabled: false
    },
    {
      id: 'epgshare-us',
      name: 'EPGShare USA Sports & Networks',
      url: 'https://epgshare01.online/epgshare01/epg_ripper_US2.xml.gz',
      enabled: false
    },
    {
      id: 'epgshare-es',
      name: 'EPGShare Spagna (Movistar+, DAZN ES)',
      url: 'https://epgshare01.online/epgshare01/epg_ripper_ES1.xml.gz',
      enabled: false
    },
    {
      id: 'epgshare-de',
      name: 'EPGShare Germania (Sky DE, DAZN DE)',
      url: 'https://epgshare01.online/epgshare01/epg_ripper_DE1.xml.gz',
      enabled: false
    },
    {
      id: 'epg-ita-tivu',
      name: 'IPTV-Org Italia (Tivù / Mediaset)',
      url: 'https://iptv-org.github.io/epg/guides/it/tivu.tv.epg.xml',
      enabled: false
    }
  ],
  warpEnabled: false,
  warpHost: '127.0.0.1:40000',
  warpLicenseKey: '',
  warpGroups: [],
  groupOrder: [],
  channelLcnMap: {}
};

function readJsonFile(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8');
      return defaultValue;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`[Storage] Error reading ${filePath}:`, err.message);
    return defaultValue;
  }
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`[Storage] Error writing ${filePath}:`, err.message);
    return false;
  }
}

function getGroupOrder() {
  const cfg = readJsonFile(CONFIG_FILE, DEFAULT_CONFIG);
  return Array.isArray(cfg.groupOrder) ? cfg.groupOrder : [];
}

function saveGroupOrder(orderList) {
  const cfg = readJsonFile(CONFIG_FILE, DEFAULT_CONFIG);
  cfg.groupOrder = Array.isArray(orderList) ? orderList : [];
  return writeJsonFile(CONFIG_FILE, cfg);
}

function getChannelLcnMap() {
  const cfg = readJsonFile(CONFIG_FILE, DEFAULT_CONFIG);
  return (cfg.channelLcnMap && typeof cfg.channelLcnMap === 'object') ? cfg.channelLcnMap : {};
}

function saveChannelLcnMap(map) {
  const cfg = readJsonFile(CONFIG_FILE, DEFAULT_CONFIG);
  cfg.channelLcnMap = (map && typeof map === 'object') ? map : {};
  return writeJsonFile(CONFIG_FILE, cfg);
}

function renameGroup(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return false;

  // 1. Aggiorna canali estratti
  const channels = readJsonFile(CHANNELS_FILE, []);
  let updatedChannelsCount = 0;
  channels.forEach(ch => {
    if (ch.group === oldName || ch.customGroup === oldName) {
      ch.group = newName;
      if (ch.customGroup === oldName) ch.customGroup = newName;
      updatedChannelsCount++;
    }
  });
  if (updatedChannelsCount > 0) {
    writeJsonFile(CHANNELS_FILE, channels);
  }

  // 2. Aggiorna canali custom
  const custom = readJsonFile(CUSTOM_CHANNELS_FILE, []);
  let updatedCustomCount = 0;
  custom.forEach(ch => {
    if (ch.group === oldName) {
      ch.group = newName;
      updatedCustomCount++;
    }
  });
  if (updatedCustomCount > 0) {
    writeJsonFile(CUSTOM_CHANNELS_FILE, custom);
  }

  // 3. Aggiorna groupOrder in config
  const cfg = readJsonFile(CONFIG_FILE, DEFAULT_CONFIG);
  if (Array.isArray(cfg.groupOrder)) {
    cfg.groupOrder = cfg.groupOrder.map(g => g === oldName ? newName : g);
    writeJsonFile(CONFIG_FILE, cfg);
  }

  return { success: true, updatedCount: updatedChannelsCount + updatedCustomCount };
}

module.exports = {
  DATA_DIR,
  getConfig: () => {
    const loaded = readJsonFile(CONFIG_FILE, DEFAULT_CONFIG);
    const merged = { ...DEFAULT_CONFIG, ...loaded };
    if (merged.mpdProxyEnabled === undefined) merged.mpdProxyEnabled = true;
    return merged;
  },
  saveConfig: (cfg) => {
    const current = readJsonFile(CONFIG_FILE, DEFAULT_CONFIG);
    const toSave = { ...DEFAULT_CONFIG, ...current, ...cfg };
    return writeJsonFile(CONFIG_FILE, toSave);
  },
  getChannels: () => readJsonFile(CHANNELS_FILE, []),
  saveChannels: (channels) => writeJsonFile(CHANNELS_FILE, channels),
  getCustomChannels: () => readJsonFile(CUSTOM_CHANNELS_FILE, []),
  saveCustomChannels: (channels) => writeJsonFile(CUSTOM_CHANNELS_FILE, channels),
  getGroupOrder,
  saveGroupOrder,
  getChannelLcnMap,
  saveChannelLcnMap,
  renameGroup
};
