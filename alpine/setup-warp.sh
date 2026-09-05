#!/bin/sh
# Script di installazione automatica Cloudflare WARP Userspace (SOCKS5) su Alpine Linux (LXC Proxmox)
# Esegui come root all'interno del container Alpine

set -e

# Determina directory assoluta dello script prima di qualsiasi cambio directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "======================================================="
echo "  Installazione Cloudflare WARP SOCKS5 su Alpine Linux "
echo "======================================================="

# 1. Installa dipendenze essenziali (curl, unzip)
echo "[+] Controllo e installazione pacchetti (curl, unzip)..."
apk add --no-cache curl unzip

# 2. Rileva architettura di sistema
ARCH_RAW="$(uname -m)"
case "$ARCH_RAW" in
    x86_64)
        WARP_ARCH="linux-amd64"
        ;;
    aarch64|arm64)
        WARP_ARCH="linux-arm64"
        ;;
    armv7l|armhf)
        WARP_ARCH="linux-arm7"
        ;;
    *)
        echo "[!] Architettura $ARCH_RAW non supportata direttamente."
        exit 1
        ;;
esac

echo "[+] Rilevata architettura di sistema: $WARP_ARCH"

# 3. Scarica il binario standalone userspace warp-plus
WARP_VERSION="v1.2.6"
DOWNLOAD_URL="https://github.com/bepass-org/warp-plus/releases/download/${WARP_VERSION}/warp-plus_${WARP_ARCH}.zip"
TMP_DIR="/tmp/warp_install"

mkdir -p "$TMP_DIR"
cd "$TMP_DIR"

echo "[+] Download warp-plus (${WARP_VERSION}) da GitHub..."
curl -fsSL "$DOWNLOAD_URL" -o warp-plus.zip

echo "[+] Estrazione binario..."
unzip -o warp-plus.zip
chmod +x warp-plus
mv warp-plus /usr/local/bin/warp-plus

# Pulizia temporanei
cd /
rm -rf "$TMP_DIR"

# 4. Configurazione servizio OpenRC
echo "[+] Registrazione servizio OpenRC /etc/init.d/warp-svc..."

if [ -f "$SCRIPT_DIR/warp-svc.initd" ]; then
    cp "$SCRIPT_DIR/warp-svc.initd" /etc/init.d/warp-svc
elif [ -f "/opt/mandrakodi/alpine/warp-svc.initd" ]; then
    cp "/opt/mandrakodi/alpine/warp-svc.initd" /etc/init.d/warp-svc
else
    cat << 'EOF' > /etc/init.d/warp-svc
#!/sbin/openrc-run
name="warp-svc"
description="Cloudflare WARP Userspace SOCKS5 Service"
command="/usr/local/bin/warp-plus"
command_args="${command_args:--b 127.0.0.1:40000 -4 --cache-dir /var/lib/warp-plus}"
command_background="yes"
directory="/var/lib/warp-plus"
pidfile="/run/warp-svc.pid"
output_log="/var/log/warp-svc.log"
error_log="/var/log/warp-svc.err"

depend() {
    need net
    after firewall
}

start_pre() {
    checkpath -d -m 0755 -o root:root /var/lib/warp-plus
    checkpath -f -m 0644 -o root:root "$output_log" "$error_log"
}
EOF
fi

chmod +x /etc/init.d/warp-svc
mkdir -p /var/lib/warp-plus

# 5. File di configurazione parametri (se non esiste già)
if [ ! -f "/etc/conf.d/warp-svc" ]; then
    cat << 'EOF' > /etc/conf.d/warp-svc
# Configurazione Cloudflare WARP Userspace SOCKS5 Service
command_args="-b 127.0.0.1:40000 -4 --cache-dir /var/lib/warp-plus"
EOF
fi

# 6. Abilitazione all'avvio e avvio immediato del servizio
echo "[+] Configurazione avvio automatico (OpenRC)..."
rc-update add warp-svc default 2>/dev/null || true

echo "[+] Avvio servizio warp-svc..."
rc-service warp-svc zap 2>/dev/null || true
rc-service warp-svc restart

# 7. Test diagnostico
echo "[+] Attesa avvio socket proxy (4 secondi)..."
sleep 4

echo "[+] Test connessione Cloudflare WARP via SOCKS5..."
if curl -s --socks5-hostname 127.0.0.1:40000 -m 8 https://www.cloudflare.com/cdn-cgi/trace | grep -q "warp=on"; then
    echo "======================================================="
    echo "  CLOUDFLARE WARP INSTALLATO E ATTIVO CON SUCCESSO!    "
    echo "  Proxy SOCKS5 in ascolto su: 127.0.0.1:40000          "
    echo "  Stato WARP: ON                                       "
    echo "======================================================="
else
    echo "======================================================="
    echo "  Controllo stato e log di warp-svc:                  "
    rc-service warp-svc status || true
    if [ -f "/var/log/warp-svc.err" ]; then
        echo "--- Log errori (/var/log/warp-svc.err) ---"
        tail -n 15 /var/log/warp-svc.err
    fi
    if [ -f "/var/log/warp-svc.log" ]; then
        echo "--- Log output (/var/log/warp-svc.log) ---"
        tail -n 15 /var/log/warp-svc.log
    fi
    echo "======================================================="
fi

# 8. Aggiornamento dipendenze NPM e riavvio MandraKodi Web Manager
INSTALL_DIR="/opt/mandrakodi"
if [ -d "$INSTALL_DIR" ]; then
    cd "$INSTALL_DIR"
    if [ -f "package.json" ]; then
        echo "[+] Controllo dipendenze NPM..."
        npm install --production --no-audit
    fi
fi

if rc-service mandrakodi status >/dev/null 2>&1; then
    echo "[+] Riavvio del servizio mandrakodi in corso..."
    rc-service mandrakodi restart
fi
