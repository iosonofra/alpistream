#!/bin/sh
# Script di aggiornamento rapido MandraKodi Web Manager tramite Git Pull
set -e

INSTALL_DIR="/opt/mandrakodi"
echo "======================================================="
echo "  Aggiornamento MandraKodi Web Manager (Git Pull)      "
echo "======================================================="

if [ -d "$INSTALL_DIR" ]; then
    cd "$INSTALL_DIR"
elif [ -d ".git" ]; then
    INSTALL_DIR="$(pwd)"
else
    echo "[!] Directory /opt/mandrakodi o repository Git non trovato!"
    exit 1
fi

# 1. Scarica l'ultimo aggiornamento da GitHub
echo "[+] Download aggiornamenti da Git (allineamento forzato pulito)..."
git fetch origin main
git reset --hard origin/main
chmod +x alpine/*.sh

# 2. Aggiorna dipendenze se necessario
echo "[+] Controllo dipendenze NPM..."
npm install --production --no-audit

# 3. Se warp-svc è installato, aggiorna servizio e riavvia
if [ -f "/etc/init.d/warp-svc" ]; then
    echo "[+] Rilevato servizio warp-svc: aggiornamento configurazione..."
    if [ -f "$INSTALL_DIR/alpine/warp-svc.initd" ]; then
        cp "$INSTALL_DIR/alpine/warp-svc.initd" /etc/init.d/warp-svc
        chmod +x /etc/init.d/warp-svc
    fi
    rc-service warp-svc zap 2>/dev/null || true
    rc-service warp-svc restart 2>/dev/null || true
fi

# 4. Riavvia il servizio OpenRC mandrakodi
echo "[+] Riavvio del servizio mandrakodi in corso..."
rc-service mandrakodi stop 2>/dev/null || true
killall node 2>/dev/null || true
sleep 1
rc-service mandrakodi zap 2>/dev/null || true
rc-service mandrakodi start

echo "======================================================="
echo "  AGGIORNAMENTO COMPLETATO CON SUCCESSO!               "
echo "======================================================="
