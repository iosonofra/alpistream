# ⚡ MandraKodi Web Manager & IPTV Hub - Guida Installazione & Aggiornamento via Git

Questa guida illustra la procedura completa per l'**installazione da zero** e l'**aggiornamento rapido con Git** (`git clone` e `git pull`) di **MandraKodi Web Manager** (con supporto per Playlist M3U, Guida EPG XMLTV, Channel Editor, Palinsesto Eventi Sportivi Live e **Proxy HTTP Centralizzato per AceStream**).

---

## 🎯 Vantaggi del Metodo Git Pull
- ⚡ **Aggiornamenti in 1 secondo**: per aggiornare basta digitare `./alpine/update.sh` o `git pull`.
- 🛡️ **Zero conflitti**: i canali personalizzati, le credenziali e le impostazioni salvate (`data/config.json`, `data/custom_channels.json`) sono esclusi dal tracciamento Git (`.gitignore`).
- 🧹 **Zero residui**: nessun archivio ZIP da caricare via FTP o scompattare a mano.

---

## 0. 🐙 Pubblicazione su GitHub (Primo Passo)

Se non hai ancora caricato la Web App sul tuo repository GitHub personale:

1. **Crea un nuovo repository vuoto su GitHub** (es. `mandrakodi-web` o `mandrakodi-web-manager`).
2. **Dal tuo computer / cartella `web-app`, esegui**:
   ```sh
   cd web-app
   git init
   git add .
   git commit -m "feat: MandraKodi Web Manager with Centralized AceStream Proxy & Git updates"
   git branch -M main
   git remote add origin https://github.com/TUO_USERNAME/NOME_REPO.git
   git push -u origin main
   ```

---

## 1. 🚀 Installazione su Proxmox VE (Container LXC Alpine Linux)

Questa è l'installazione raccomandata per le massime prestazioni e il minimo consumo di risorse (meno di 30 MB di RAM per il server Web!).

### Requisiti del Container:
- **Template Proxmox**: `alpine-3.x-default_...tar.zst` (scaricabile da Proxmox -> local -> CT Templates)
- **RAM**: 256 MB (o 512 MB/1 GB se attivi anche Ace Stream Engine)
- **Disco**: 2 GB (o 4 GB con Ace Engine)
- **CPU**: 1 o 2 vCPU

### Procedura di Installazione da Zero via Git:
1. **Accedi alla console o SSH del container Alpine LXC**.
2. **Installa Git e clona il repository direttamente in `/opt/mandrakodi`**:
   ```sh
   apk update
   apk add --no-cache git
   git clone https://github.com/TUO_USERNAME/NOME_REPO.git /opt/mandrakodi
   cd /opt/mandrakodi
   ```
3. **Esegui lo script di installazione automatica**:
   ```sh
   chmod +x alpine/*.sh
   ./alpine/install.sh
   ```
   *Lo script configurerà Node.js, npm, le dipendenze, il demone di avvio automatico OpenRC `/etc/init.d/mandrakodi` e ti chiederà se desideri avviare anche Ace Stream Engine in automatico.*

4. **Fatto!** Il servizio è subito attivo e si avvierà automaticamente al riavvio del container:
   - **Dashboard Web**: `http://<IP_CONTAINER_ALPINE>:3000`
   - **Playlist M3U**: `http://<IP_CONTAINER_ALPINE>:3000/playlist.m3u`
   - **Guida EPG**: `http://<IP_CONTAINER_ALPINE>:3000/epg.xml`

---

## 2. 🔄 Procedura di Aggiornamento con 1 Singolo Comando (`git pull`)

Quando rilasci una nuova versione o applichi modifiche su GitHub, non devi fare alcuna reinstallazione né riconfigurazione.

### Metodo 1: Script Automatico di Aggiornamento
Collegati al container ed esegui:
```sh
cd /opt/mandrakodi
./alpine/update.sh
```

### Metodo 2: Comandi Manuali
```sh
cd /opt/mandrakodi
git pull
npm install --production --no-audit
rc-service mandrakodi restart
```

> [!NOTE]
> **Preservazione Totale dei Dati**: I file di cache, gli eventi salvati e le tue personalizzazioni (`data/config.json`, `data/custom_channels.json`, ecc.) rimangono al 100% intatti. Il comando `git pull` non genererà mai errori o conflitti di merge.

---

## 3. 🐳 Installazione e Aggiornamento via Docker / Docker Compose

Se preferisci usare Docker (su Ubuntu, Debian, Proxmox o NAS):

### Installazione Iniziale:
```sh
git clone https://github.com/TUO_USERNAME/NOME_REPO.git /opt/mandrakodi
cd /opt/mandrakodi
docker compose up -d
```
*Il `docker-compose.yml` avvia sia MandraKodi Web sia Ace Stream Engine già collegati tra loro.*

### Aggiornamento Docker con Git:
```sh
cd /opt/mandrakodi
git pull
docker compose up -d --build
```

---

## 4. 💻 Installazione Locale (Windows / Linux / macOS)

### Installazione Iniziale:
1. Installa [Node.js](https://nodejs.org/) (v18, v20 o v22) e [Git](https://git-scm.com/).
2. Apri il terminale (o PowerShell) e clona il repository:
   ```sh
   git clone https://github.com/TUO_USERNAME/NOME_REPO.git
   cd NOME_REPO
   npm install --production
   npm start
   ```
3. Apri il browser all'indirizzo `http://localhost:3000`.

### Aggiornamento Locale:
```sh
git pull
npm install --production
npm start
```

---

## 5. ⚡ AceStream Proxy Centralizzato (Zero Engine sui Client)

MandraKodi Web Manager converte automaticamente tutti i flussi P2P AceStream in **stream HTTP MPEG-TS standard** (`http://<IP_SERVER>:3000/stream/ace/<hash>`).

### A cosa serve?
Qualsiasi dispositivo nella tua rete (Smart TV, Fire TV Stick con TiviMate, Apple TV, VLC, Kodi, smartphone) riprodurrà i canali sportivi e le dirette AceStream **senza installare alcuna app Ace Stream, senza registrazioni e senza consumo di batteria/CPU sui dispositivi mobili**.

### Configurazione nella Dashboard Web:
1. Accedi alla Dashboard Web (`http://<IP_SERVER>:3000`).
2. Apri la scheda **⚙️ Impostazioni**.
3. Nella sezione **⚡ Proxy AceStream Centralizzato**:
   - Assicurati che **Abilita riscrittura automatica canali AceStream tramite Proxy Centralizzato** sia spuntato.
   - Inserisci l'host del motore Ace Stream (es. `127.0.0.1:6878` se gira sullo stesso server/container, oppure l'IP dell'host dove gira Docker).
   - Clicca su **🔍 Testa Connessione**: comparirà il messaggio di conferma `✅ Ace Engine Online!`.
   - Clicca su **💾 Salva Impostazioni**.

---

## 6. 🔐 Proxy MPD ClearKey Centralizzato (Zero DRM sui Client)

MandraKodi Web Manager include anche un **Proxy HTTP Centralizzato per canali MPEG-DASH (MPD) protetti da ClearKey DRM** (oltre 250 canali Sky, Sport, Cinema e Intrattenimento):

### A cosa serve?
Nativamente, i canali MPD con ClearKey funzionano solo su Kodi o browser con modulo EME. La quasi totalità delle **Smart TV (Samsung Tizen, LG webOS)**, **Apple TV**, **VLC** e box IPTV non supportano ClearKey e non riescono a riprodurre questi canali.
Attivando il proxy, il server MandraKodi **decifra al volo i segmenti protetti con FFmpeg** e li ritrasmette come flusso continuo MPEG-TS (`http://<IP_SERVER>:3000/stream/mpd/<channel_id>`) con **zero transcodifica (stream copy a carico CPU quasi nullo)**.

### Requisiti sul Server:
Assicurati che `ffmpeg` sia installato (l'installer `install.sh` lo include già):
```sh
apk add --no-cache ffmpeg
```

### Attivazione nella Dashboard:
1. Apri la Dashboard Web -> **⚙️ Impostazioni**.
2. Nella sezione **🔐 Proxy MPD ClearKey Centralizzato**:
   - Spunta **Abilita decodifica centralizzata canali MPD ClearKey tramite FFmpeg**.
   - Clicca su **🔍 Testa FFmpeg** per verificare la presenza del binario sul server.
   - Clicca su **💾 Salva Impostazioni**.
3. Da questo momento, qualsiasi Smart TV o VLC che apre la playlist `http://<IP_SERVER>:3000/playlist.m3u` riprodurrà all'istante anche i canali MPD ClearKey!

---

## 7. 📺 Come Inserire la Playlist sui Tuoi Dispositivi IPTV

Configura il tuo client preferito (TiviMate, IPTV Smarters, Kodi PVR IPTV Simple Client, VLC):

- **URL Playlist M3U**:
  ```
  http://<IP_DEL_SERVER>:3000/playlist.m3u
  ```
- **URL Guida EPG (XMLTV)**:
  ```
  http://<IP_DEL_SERVER>:3000/epg.xml
  ```

Tutti i canali AceStream e MPD ClearKey inclusi nella playlist verranno automaticamente instradati dal server locale verso il player video in formato MPEG-TS universale, garantendo visione istantanea su qualunque dispositivo.

---

## 8. 🕹️ Comandi Utili per il Container Alpine (OpenRC)

- **Stato del servizio**: `rc-service mandrakodi status`
- **Riavvia l'applicazione**: `rc-service mandrakodi restart`
- **Ferma l'applicazione**: `rc-service mandrakodi stop`
- **Visualizza i log in tempo reale**:
  ```sh
  tail -f /var/log/mandrakodi.log
  ```
- **Visualizza eventuali errori**:
  ```sh
  tail -f /var/log/mandrakodi.err
  ```

---

## 📦 Alternativa Offline (Archivio ZIP)
Se operi su una macchina o server senza connettività a GitHub per il comando `git clone`, è comunque disponibile l'archivio ZIP pronto all'uso `mandrakodi-web-app.zip` (pesa ~1.8 MB, privo di `node_modules` e file non necessari) nella root del progetto e in `dist/`.
