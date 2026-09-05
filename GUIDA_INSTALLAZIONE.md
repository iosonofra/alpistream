# ⚡ MandraKodi Web Manager & IPTV Hub - Guida Installazione & Aggiornamento Pulito

Questa guida illustra la procedura completa per l'**installazione da zero** e l'**aggiornamento pulito** di **MandraKodi Web Manager** (con supporto per Playlist M3U, Guida EPG XMLTV, Channel Editor, Palinsesto Eventi Sportivi Live e **Proxy HTTP Centralizzato per AceStream**).

---

## 📦 Pacchetto ZIP Pronto all'Uso

Il pacchetto pulito della Web App è pronto per il download e il trasferimento:
- **File ZIP**: **[`mandrakodi-web-app.zip`](file:///c:/Users/franc/.gemini/antigravity/scratch/plugin.video.mandrakodi/mandrakodi-web-app.zip)** *(disponibile nella root del progetto e in `dist/`)*
- **Caratteristiche**: Include tutto il backend Express, il frontend web player (`mpegts.js`), i servizi di estrazione, gli script OpenRC/Alpine e Docker, **senza** `node_modules` o dump pesanti, per un peso di soli ~1.8 MB.

---

## 1. 🚀 Installazione su Proxmox VE (Container LXC Alpine Linux)

Questa è l'installazione consigliata per le massime prestazioni e il minimo consumo di risorse (meno di 30 MB di RAM!).

### Requisiti del Container:
- **Template Proxmox**: `alpine-3.x-default_...tar.zst`
- **RAM**: 128 MB o 256 MB
- **Disco**: 1 GB o 2 GB
- **CPU**: 1 Core

### Procedura:
1. **Accedi alla console o SSH del container Alpine LXC**.
2. **Estrai il pacchetto ZIP in `/opt/mandrakodi`**:
   ```sh
   mkdir -p /opt/mandrakodi
   # Trasferisci ed estrai il file mandrakodi-web-app.zip in /opt/mandrakodi
   unzip -o mandrakodi-web-app.zip -d /opt/mandrakodi
   cd /opt/mandrakodi
   ```
3. **Esegui lo script di installazione automatica**:
   ```sh
   chmod +x alpine/install.sh
   ./alpine/install.sh
   ```
4. **Fatto!** Il servizio viene abilitato al boot del container e avviato automaticamente:
   - **Dashboard Web**: `http://<IP_CONTAINER_ALPINE>:3000`
   - **Playlist M3U**: `http://<IP_CONTAINER_ALPINE>:3000/playlist.m3u`
   - **Guida EPG**: `http://<IP_CONTAINER_ALPINE>:3000/epg.xml`

---

## 2. 🔄 Procedura di Aggiornamento Pulito (Clean Update) su Proxmox / Alpine

Lo script `install.sh` include la **protezione automatica della configurazione**: se hai già canali personalizzati o credenziali configurate, non andranno perse!

### Come aggiornare un'istanza esistente:
1. Scarica la nuova versione di `mandrakodi-web-app.zip`.
2. Trasferisci il file zip sul container (ad esempio in `/tmp`).
3. Estrai i file sopra l'installazione precedente:
   ```sh
   cd /opt/mandrakodi
   unzip -o /tmp/mandrakodi-web-app.zip -d /tmp/mandra_update
   cp -r /tmp/mandra_update/* /opt/mandrakodi/
   rm -rf /tmp/mandra_update
   ```
4. Esegui nuovamente l'installer:
   ```sh
   chmod +x alpine/install.sh
   ./alpine/install.sh
   ```
   *L'installer riconoscerà la presenza dei file utente `config.json` e `custom_channels.json`, ne effettuerà il backup temporaneo, installerà le eventuali nuove dipendenze NPM, ripristinerà la tua configurazione e riavvierà il servizio OpenRC senza alcun downtime prolungato.*

---

## 3. 🐳 Installazione tramite Docker / Docker Compose

Se preferisci eseguire l'applicazione tramite Docker:

1. Estrai `mandrakodi-web-app.zip`.
2. Nella cartella estratta è già presente il `Dockerfile` e `docker-compose.yml`.
3. Avvia il container:
   ```sh
   docker compose up -d
   ```
4. La cartella `./data` viene montata come volume persistente, garantendo che le modifiche ai canali e alle impostazioni rimangano salvate anche al riavvio o all'aggiornamento del container.

---

## 4. 💻 Installazione Locale (Windows / Linux / Mac)

1. Assicurati di avere **Node.js** (versione 18, 20 o 22) installato.
2. Estrai `mandrakodi-web-app.zip` in una cartella a piacere.
3. Apri il terminale (o PowerShell) nella cartella ed esegui:
   ```sh
   npm install --production
   npm start
   ```
4. Apri il browser su `http://localhost:3000`.

---

## 5. ⚡ Configurazione AceStream Proxy Centralizzato (Zero Engine sui Client)

MandraKodi Web Manager consente a qualsiasi Smart TV, Fire Stick, smartphone o TV box di riprodurre i canali AceStream (es. Last Minute, Serie A, Sport) **senza che il dispositivo client debba installare alcun software P2P**.

### A. Avvio di Ace Stream Engine sul Server:
Puoi eseguire Ace Stream Engine sulla stessa macchina o su un server locale tramite Docker:
```sh
docker run -d \
  --name acestream-engine \
  --restart unless-stopped \
  -p 6878:6878 \
  magnetikonline/acestream-server
```

### B. Collegamento nella Dashboard:
1. Accedi alla Dashboard Web (`http://<IP_SERVER>:3000`).
2. Apri la scheda **⚙️ Impostazioni**.
3. Nella sezione **⚡ Proxy AceStream Centralizzato**:
   - Assicurati che **Abilita riscrittura automatica canali AceStream tramite Proxy Centralizzato** sia spuntato.
   - Inserisci l'host del motore (es. `127.0.0.1:6878` se locale, oppure `IP_SERVER:6878` se remoto).
   - Clicca su **🔍 Testa Connessione**: comparirà il badge verde di conferma `✅ Ace Engine Online!`.
   - Clicca su **💾 Salva Impostazioni**.

---

## 6. 📺 Utilizzo della Playlist su Client IPTV

Tutti i dispositivi (TiviMate, Smart TV, VLC, Kodi Simple IPTV) necessitano unicamente dei due link generati dal server:

- **Playlist M3U**: `http://<IP_DEL_SERVER>:3000/playlist.m3u`
- **Guida EPG**: `http://<IP_DEL_SERVER>:3000/epg.xml`

Tutti i canali AceStream inclusi nella playlist verranno richiesti all'endpoint `http://<IP_DEL_SERVER>:3000/stream/ace/<hash>`, che farà da proxy HTTP MPEG-TS trasparente.

---

## 7. 🐙 Caricamento del Progetto su GitHub

Se desideri pubblicare la Web App su un tuo repository GitHub dedicato:

1. **Crea un nuovo repository vuoto su GitHub** (es. `mandrakodi-web-manager` o `mandrakodi-web-app`).
2. **Dalla cartella `web-app`, esegui**:
   ```sh
   cd web-app
   git init
   git add .
   git commit -m "MandraKodi Web Manager v1.1.0: Centralized AceStream Proxy, Live TV Player & IPTV Hub"
   git branch -M main
   git remote add origin https://github.com/TUO_USERNAME/NOME_REPO.git
   git push -u origin main
   ```
