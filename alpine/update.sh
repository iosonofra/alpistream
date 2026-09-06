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

# 1. Backup di sicurezza preventivo di tutti i dati e impostazioni utente
BACKUP_DATA_DIR="/tmp/mandrakodi_data_backup_$(date +%s)"
if [ -d "$INSTALL_DIR/data" ]; then
    echo "[+] Salvataggio preventivo impostazioni e liste utente in $BACKUP_DATA_DIR..."
    mkdir -p "$BACKUP_DATA_DIR"
    cp -a "$INSTALL_DIR/data/." "$BACKUP_DATA_DIR/" 2>/dev/null || true
fi

# 2. Scarica l'ultimo aggiornamento da GitHub (allineamento pulito)
echo "[+] Download aggiornamenti da Git..."
git fetch origin main
git reset --hard origin/main
chmod +x alpine/*.sh

# 3. Ripristino totale delle impostazioni, liste attive e canali salvati dall'utente
if [ -d "$BACKUP_DATA_DIR" ]; then
    echo "[+] Ripristino impostazioni, liste e canali personalizzati..."
    mkdir -p "$INSTALL_DIR/data"
    cp -a "$BACKUP_DATA_DIR/." "$INSTALL_DIR/data/" 2>/dev/null || true
    rm -rf "$BACKUP_DATA_DIR"
fi

# 4. Aggiorna dipendenze se necessario
echo "[+] Controllo dipendenze NPM..."
npm install --production --no-audit

# 5. Se warp-svc è installato, aggiorna servizio e riavvia
if [ -f "/etc/init.d/warp-svc" ]; then
    echo "[+] Rilevato servizio warp-svc: aggiornamento configurazione..."
    if [ -f "$INSTALL_DIR/alpine/warp-svc.initd" ]; then
        cp "$INSTALL_DIR/alpine/warp-svc.initd" /etc/init.d/warp-svc
        chmod +x /etc/init.d/warp-svc
    fi
    rc-service warp-svc zap 2>/dev/null || true
    rc-service warp-svc restart 2>/dev/null || true
fi

# 6. Riavvia il servizio OpenRC mandrakodi
echo "[+] Riavvio del servizio mandrakodi in corso..."
rc-service mandrakodi stop 2>/dev/null || true
killall node 2>/dev/null || true
sleep 1
rc-service mandrakodi zap 2>/dev/null || true
rc-service mandrakodi start

echo "======================================================="
echo "  AGGIORNAMENTO COMPLETATO CON SUCCESSO!               "
echo "======================================================="
