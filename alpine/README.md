# Guida Installazione MandraKodi Web Manager su Proxmox (Alpine LXC)

Questa guida illustra come installare e far girare **MandraKodi Web Manager** come servizio sempre attivo e leggero all'interno di un container LXC Alpine Linux su Proxmox VE.

---

## 🚀 Requisiti Minimi del Container Alpine LXC
- **Template Proxmox**: `alpine-3.x-default_...tar.zst`
- **RAM**: 128 MB o 256 MB (l'app consuma meno di 30 MB di RAM!)
- **Disco**: 1 GB o 2 GB
- **CPU**: 1 Core

---

## 📥 Metodo 1: Installazione Diretta con lo Script

1. **Accedi alla console del container Alpine LXC** su Proxmox.
2. **Crea la directory e copia i file del progetto**:
   ```sh
   mkdir -p /opt/mandrakodi
   ```
   *(Puoi trasferire la cartella `web-app` tramite SCP, SFTP o Git)*.

3. **Esegui lo script di installazione**:
   ```sh
   cd /opt/mandrakodi
   chmod +x alpine/install.sh
   ./alpine/install.sh
   ```

---

## 🛠️ Metodo 2: Installazione Manuale Passo-Passo

Se preferisci eseguire i passaggi a mano:

1. **Installa Node.js e le utility**:
   ```sh
   apk update
   apk add nodejs npm curl tzdata
   ```

2. **Posizionati nella cartella e installa le dipendenze**:
   ```sh
   cd /opt/mandrakodi
   npm install --production --no-audit
   ```

3. **Configura il servizio OpenRC**:
   ```sh
   cp alpine/mandrakodi.initd /etc/init.d/mandrakodi
   chmod +x /etc/init.d/mandrakodi
   ```

4. **Avvia e abilita il servizio all'avvio del sistema**:
   ```sh
   rc-update add mandrakodi default
   rc-service mandrakodi start
   ```

---

## 🕹️ Gestione del Servizio OpenRC
- **Stato del servizio**: `rc-service mandrakodi status`
- **Riavvio**: `rc-service mandrakodi restart`
- **Stop**: `rc-service mandrakodi stop`
- **Visualizza i log**: `tail -f /var/log/mandrakodi.log`

---

## 📺 Link di Streaming per i tuoi Client IPTV
Una volta avviato, l'applicazione sarà accessibile dal tuo browser e dai tuoi dispositivi:
- **Dashboard Web**: `http://<IP_CONTAINER_ALPINE>:3000`
- **Playlist M3U Remota**: `http://<IP_CONTAINER_ALPINE>:3000/playlist.m3u`
- **Guida Programmi EPG**: `http://<IP_CONTAINER_ALPINE>:3000/epg.xml`

---

## ⚡ Ace Stream Engine Centralizzato (Zero Engine sui Client)

MandraKodi Web Manager include un **Proxy HTTP Centralizzato per AceStream**:
Tutti i canali e le partite AceStream (Serie A, Champions, Tennis, ecc.) vengono convertiti in normali stream HTTP MPEG-TS (`/stream/ace/<hash>`).
In questo modo **i tuoi client (Smart TV con TiviMate, Kodi, VLC, smartphone) NON necessitano di installare alcun Ace Engine**.

### 1. Come avviare Ace Stream Engine su Proxmox / Home Server
Puoi eseguire Ace Stream Engine in un container Docker leggero su Proxmox o su qualsiasi macchina della tua rete locale:

```sh
# Esempio Docker container (leggero e affidabile)
docker run -d \
  --name acestream-engine \
  --restart unless-stopped \
  -p 6878:6878 \
  magnetikonline/acestream-server
```

### 2. Collegamento con MandraKodi
1. Accedi alla Dashboard Web di MandraKodi (`http://<IP>:3000`).
2. Vai nel tab **⚙️ Impostazioni**.
3. Nella sezione **⚡ Proxy AceStream Centralizzato**, inserisci l'indirizzo del tuo Ace Engine (es. `127.0.0.1:6878` se gira sulla stessa macchina/container, oppure `192.168.1.X:6878` se su un altro host).
4. Clicca su **🔍 Testa Connessione** per verificare il collegamento.
5. Clicca su **💾 Salva Impostazioni**.

Tutti i dispositivi che usano la playlist `http://<IP_MANDRAKODI>:3000/playlist.m3u` riprodurranno istantaneamente qualsiasi canale AceStream senza configurazioni aggiuntive!

