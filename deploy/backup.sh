#!/usr/bin/env bash
# Off-box backup of the bot database and reports. Schedule with cron, e.g.:
#   15 0 * * * /home/bot/BNB-Sniping-Bot/deploy/backup.sh >> /home/bot/backup.log 2>&1
# Copies the newest in-container backup (made daily by the bot via VACUUM INTO) plus reports
# to BACKUP_DEST (any rsync/scp target or a mounted folder). Never backs up secrets/.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${BACKUP_DEST:-$HOME/bot-backups}"
mkdir -p "$DEST"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
# consistent snapshot even if the bot has not made one yet
sqlite3 data/bot.db ".backup '$DEST/bot-$STAMP.db'"
tar czf "$DEST/reports-$STAMP.tgz" reports
# keep 30 days locally
find "$DEST" -name 'bot-*.db' -mtime +30 -delete
find "$DEST" -name 'reports-*.tgz' -mtime +30 -delete
echo "backup ok $STAMP -> $DEST"
