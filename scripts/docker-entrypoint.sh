#!/bin/sh
# Container entrypoint: make sure the writable directories exist and that a
# database encryption key exists, then hand off to the Next.js server.
set -e

mkdir -p /app/data \
         /app/public/uploads \
         /app/public/generated \
         /app/public/generated-audio \
         /app/logs

KEY_FILE=/app/data/.db-key

# An explicit DB_ENCRYPTION_KEY always wins. Otherwise reuse the key stored in
# the data volume, or mint one on first boot so `docker compose up` is the whole
# install. The database is encrypted at rest with this key and there is no
# recovery path without it.
if [ -z "$DB_ENCRYPTION_KEY" ]; then
  if [ -f "$KEY_FILE" ]; then
    DB_ENCRYPTION_KEY=$(cat "$KEY_FILE")
  else
    DB_ENCRYPTION_KEY=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
    printf '%s' "$DB_ENCRYPTION_KEY" > "$KEY_FILE"
    chmod 600 "$KEY_FILE"
    echo ""
    echo "!! ==============================================================="
    echo "!!  No DB_ENCRYPTION_KEY was set, so one has been generated."
    echo "!!  It is stored at $KEY_FILE, inside the data volume."
    echo "!!"
    echo "!!  BACK THIS UP. Losing it destroys every campaign, character and"
    echo "!!  message in the database. There is no way to recover them."
    echo "!!"
    echo "!!  $DB_ENCRYPTION_KEY"
    echo "!! ==============================================================="
    echo ""
  fi
  export DB_ENCRYPTION_KEY
fi

exec "$@"
