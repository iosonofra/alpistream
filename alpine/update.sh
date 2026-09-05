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
echo "[+] Download degli ultimi aggiornamenti dal repository Git..."
git pull

# 2. Aggiorna dipendenze se necessario
echo "[+] Controllo dipendenze NPM..."
npm install --production --no-audit

# 3. Riavvia il servizio OpenRC
echo "[+] Riavvio del servizio mandrakodi in corso..."
if rc-service mandrakodi status >/dev/null 2>&1; then
    rc-service mandrakodi restart
else
    rc-service mandrakodi start
fi

echo "======================================================="
echo "  AGGIORNAMENTO COMPLETATO CON SUCCESSO!               "
echo "======================================================="
