#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
STAMP="$(date '+%Y%m%d_%H%M%S')"
BACKUP_FILE="$BACKUP_DIR/fourhigh_${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_PASSWORD" mysqldump --single-transaction --routines --triggers -u"$MYSQL_USER" "$MYSQL_DATABASE"' \
  | gzip > "$BACKUP_FILE"
find "$BACKUP_DIR" -type f -name 'fourhigh_*.sql.gz' -mtime +30 -delete
printf 'Database backup created: %s\n' "$BACKUP_FILE"
