# Guida Installazione MandraKodi Web Manager su Proxmox (Alpine LXC)

Questa guida illustra come installare e far girare **MandraKodi Web Manager** come servizio sempre attivo e leggero all'interno di un container LXC Alpine Linux su Proxmox VE.

---

## 🚀 Requisiti Minimi del Container Alpine LXC
- **Template Proxmox**: `alpine-3.x-default_...tar.zst`
- **RAM**: 128 MB o 256 MB (l'app consuma meno di 30 MB di RAM!)
- **Disco**: 1 GB o 2 GB
- **CPU**: 1 Core

---

## 📥 Installazione Iniziale via Git (Consigliata)

1. **Accedi alla console o SSH del container Alpine LXC** su Proxmox.
2. **Installa Git e clona il repository in `/opt/mandrakodi`**:
   ```sh
   apk update
   apk add --no-cache git
   git clone https://github.com/TUO_USERNAME/NOME_REPO.git /opt/mandrakodi
   cd /opt/mandrakodi
   ```
3. **Esegui lo script di configurazione automatica**:
   ```sh
   chmod +x alpine/*.sh
   ./alpine/install.sh
   ```
   *Lo script installerà Node.js, npm, curl, tzdata, le dipendenze npm di produzione, configurerà il servizio OpenRC `/etc/init.d/mandrakodi` e ti chiederà se desideri avviare anche Ace Stream Engine in automatico.*

---

## 🔄 Aggiornamento Pulito con 1 Singolo Comando (Git Pull)

Ogni volta che rilasci una nuova versione o modifichi il codice su GitHub, puoi aggiornare il container istantaneamente senza dover trasferire file zip:

```sh
cd /opt/mandrakodi
./alpine/update.sh
```

Oppure manualmente:
```sh
cd /opt/mandrakodi
git pull
npm install --production --no-audit
rc-service mandrakodi restart
```

> [!NOTE]
> Le impostazioni salvate (`config.json`), i canali personalizzati (`custom_channels.json`) e le preferenze dei gruppi **vengono preservate al 100%** e non andranno mai in conflitto con `git pull`.

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

---

## 🔐 Proxy MPD ClearKey Centralizzato (FFmpeg Stream Copy)

MandraKodi Web Manager include un secondo proxy centralizzato per i canali **MPEG-DASH protetti da ClearKey DRM (KID:KEY)**:
I segmenti `.m4s` cifrati vengono decifrati al volo sul server tramite **FFmpeg in modalità stream copy** (`-c copy`) e incapsulati in normale streaming HTTP MPEG-TS (`/stream/mpd/:channelId`).
In questo modo anche **VLC**, **Smart TV Samsung/LG**, **Apple TV** e box IPTV privi di supporto DRM possono riprodurre i canali Sky, Sport e Cinema presenti nella playlist!

### Requisiti sul Container Alpine:
Installa FFmpeg sul container LXC con:
```sh
apk add --no-cache ffmpeg
```
Poi nella dashboard web (**⚙️ Impostazioni -> Proxy MPD ClearKey**) spunta la casella di abilitazione e salva.

---

## 🏎️ Impostazioni Consigliate su Proxmox VE per Massime Prestazioni

Per garantire uno streaming IPTV fluido, reattivo e a zero lag verso tutti i tuoi dispositivi (Smart TV, Kodi, VLC, smartphone), ecco la configurazione consigliata per il container LXC Alpine Linux su Proxmox VE:

### 1. Risorse Hardware (CPU & RAM)
| Risorsa | Solo MandraKodi | MandraKodi + Ace Engine | Note |
|---|---|---|---|
| **CPU Cores** | **1 vCPU** | **2 vCPU** | 2 core garantiscono che la transcodifica/buffer P2P non rallenti il server Web. |
| **CPU Units** | 1024 | 1024 (o 2048) | Aumenta a 2048 se vuoi dare priorità allo streaming rispetto ad altri container. |
| **RAM** | **256 MB** | **512 MB - 1024 MB** | Ace Engine alloca un buffer in RAM per i chunk scaricati dai peer. |
| **Swap** | 256 MB | 512 MB | Protegge dal superamento improvviso della RAM durante estrazioni massive. |

---

### 2. Funzionalità del Container (*Opzioni -> Features*)
- **Nesting**: **Abilitato (`features: nesting=1`)**
  - *Fondamentale se installi Docker / Ace Stream Engine all'interno del container.*
- **Keyctl**: **Abilitato (`features: keyctl=1`)**
  - *Raccomandato per container unprivileged su Proxmox 7/8.*
- **Unprivileged Container**: **Sì (`unprivileged: 1`)**
  - *Sicuro e pienamente supportato.*

---

### 3. Disco & I/O (*Risorse -> Root Disk*)
- **Dimensione Disco**:
  - **2 GB**: sufficienti se installi solo MandraKodi.
  - **4 GB - 6 GB**: consigliati se installi anche Docker e l'immagine AceStream.
- **Opzione `noatime` (Zero scritture inutili su SSD)**:
  - Per evitare continue scritture su SSD dei timestamp di lettura file durante lo streaming di flussi video continui, aggiungi `mountoptions=noatime` nella configurazione del container `/etc/pve/lxc/<CTID>.conf` dell'host Proxmox:
    ```
    rootfs: local-lvm:subvol-XXX-disk-0,size=4G,mountoptions=noatime
    ```

---

### 4. Rete (*Network*)
- **Bridge**: `vmbr0` (interfaccia di rete bridged).
- **Firewall Proxmox**: **Disabilitato (`firewall=0`)** sull'interfaccia del container se ti trovi all'interno della rete locale fidata. Questo rimuove l'overhead di filtraggio `iptables` sul traffico streaming.

---

### 5. Ottimizzazioni Sistema Operativo (Alpine Linux)
AceStream e Node.js aprono decine di socket TCP simultanei verso i peer BitTorrent e i client IPTV. All'interno della console di Alpine, puoi impostare questi parametri per la massima fluidità:

Crea o modifica il file `/etc/sysctl.d/99-streaming.conf`:
```ini
# Aumenta il limite di file/socket aperti contemporaneamente
fs.file-max = 2097152
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096

# Favorisci la RAM prima di ricorrere allo swap
vm.swappiness = 10
```
Applica subito con:
```sh
sysctl --system
```
