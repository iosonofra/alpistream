#!/bin/sh
# Script di installazione automatica MandraKodi Web Manager su Proxmox Alpine LXC
# Esegui come root all'interno del container Alpine

set -e

echo "======================================================="
echo "  Installazione MandraKodi Web Manager su Alpine Linux "
echo "======================================================="

# 1. Aggiorna pacchetti e installa Node.js & npm
echo "[+] Aggiornamento repository APK e installazione Node.js..."
apk update
apk add --no-cache nodejs npm curl tzdata

# 2. Crea directory applicazione e gestisci backup configurazione per aggiornamenti puliti
INSTALL_DIR="/opt/mandrakodi"
echo "[+] Configurazione directory di installazione in $INSTALL_DIR..."

if [ -f "$INSTALL_DIR/data/config.json" ]; then
    echo "[*] Trovata configurazione esistente: backup temporaneo dei dati utente..."
    mkdir -p /tmp/mandrakodi_backup
    cp "$INSTALL_DIR/data/config.json" /tmp/mandrakodi_backup/ 2>/dev/null || true
    if [ -f "$INSTALL_DIR/data/custom_channels.json" ]; then
        cp "$INSTALL_DIR/data/custom_channels.json" /tmp/mandrakodi_backup/ 2>/dev/null || true
    fi
fi

mkdir -p "$INSTALL_DIR"

# 3. Copia file applicazione (se eseguito dalla cartella del progetto estratto)
if [ -f "package.json" ]; then
    cp -r * "$INSTALL_DIR/"
else
    echo "[!] Assicurati di copiare i file del progetto in $INSTALL_DIR"
fi

# Ripristina configurazione e canali personalizzati
if [ -d "/tmp/mandrakodi_backup" ]; then
    echo "[+] Ripristino configurazione utente esistente..."
    cp -f /tmp/mandrakodi_backup/* "$INSTALL_DIR/data/" 2>/dev/null || true
    rm -rf /tmp/mandrakodi_backup
fi

cd "$INSTALL_DIR"

# 4. Installazione dipendenze Node in produzione (zero build tools)
echo "[+] Installazione dipendenze NPM..."
npm install --production --no-audit

# 5. Configurazione Servizio OpenRC
echo "[+] Registrazione servizio OpenRC /etc/init.d/mandrakodi..."
if [ -f "alpine/mandrakodi.initd" ]; then
    cp alpine/mandrakodi.initd /etc/init.d/mandrakodi
else
    cat << 'EOF' > /etc/init.d/mandrakodi
#!/sbin/openrc-run
name="mandrakodi"
description="MandraKodi Web Manager"
command="/usr/bin/node"
command_args="server.js"
command_background="yes"
directory="/opt/mandrakodi"
pidfile="/run/mandrakodi.pid"
output_log="/var/log/mandrakodi.log"
error_log="/var/log/mandrakodi.err"

depend() {
    need net
    after firewall
}

start_pre() {
    checkpath -f -m 0644 -o root:root "$output_log" "$error_log"
}
EOF
fi

chmod +x /etc/init.d/mandrakodi

# 6. Abilita e avvia (o riavvia in caso di aggiornamento)
if rc-service mandrakodi status >/dev/null 2>&1; then
    echo "[+] Riavvio del servizio mandrakodi in corso..."
    rc-service mandrakodi restart
else
    echo "[+] Abilitazione servizio al boot e avvio..."
    rc-update add mandrakodi default
    rc-service mandrakodi start
fi

# 7. Opzionale: Installazione automatica Ace Stream Engine
echo ""
echo "-------------------------------------------------------"
echo "  Configurazione Ace Stream Engine (Opzionale)        "
echo "-------------------------------------------------------"

INSTALL_ACE="no"
if [ "$1" = "--with-acestream" ]; then
    INSTALL_ACE="yes"
elif [ -t 0 ] && [ "$1" != "--no-acestream" ]; then
    printf "[?] Vuoi installare automaticamente anche Ace Stream Engine su questo container? [s/N]: "
    read -r resp
    case "$resp" in
        [sS][iI]|[sS]|[yY][eE][sS]|[yY]) INSTALL_ACE="yes" ;;
        *) INSTALL_ACE="no" ;;
    esac
fi

if [ "$INSTALL_ACE" = "yes" ]; then
    echo "[+] Installazione Docker e avvio container Ace Stream Engine..."
    apk add --no-cache docker
    rc-update add docker default
    rc-service docker start || true
    if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q '^acestream-engine$'; then
        echo "[+] Riavvio container acestream-engine esistente..."
        docker restart acestream-engine || true
    else
        echo "[+] Avvio container acestream-engine su porta 6878..."
        docker run -d \
          --name acestream-engine \
          --restart unless-stopped \
          -p 6878:6878 \
          -p 6878:6878/udp \
          magnetikonline/acestream-server || true
    fi
    echo "[+] Ace Stream Engine attivo su porta 6878!"
else
    echo "[*] Ace Stream Engine saltato. Potrai collegarne uno esterno o eseguirlo separatamente."
fi

IP_ADDR=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' || hostname -i)

echo "======================================================="
echo "  INSTALLAZIONE COMPLETATA CON SUCCESSO! "
echo "======================================================="
echo "  Dashboard Web: http://${IP_ADDR}:3000"
echo "  Playlist M3U:  http://${IP_ADDR}:3000/playlist.m3u"
echo "  Guida EPG:     http://${IP_ADDR}:3000/epg.xml"
echo "======================================================="
