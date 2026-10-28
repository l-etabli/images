#!/bin/sh
# shellcheck shell=busybox
# PostgreSQL backup (pg-backup/README.md): a custom-format pg_dump, encrypted
# on the fly to the age public key, then uploaded to the daily bucket, plus the
# weekly one on Sundays and the monthly one on the 1st. Each bucket's retention
# does the rest.
#
# The job's key may only write: nothing uploaded can be read, listed or
# deleted from here. Decrypting takes the private key, kept offline.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?}" "${BACKUP_AGE_RECIPIENT:?}" "${BACKUP_S3_BUCKET_PREFIX:?}"
: "${RCLONE_S3_ENDPOINT:?}" "${RCLONE_S3_ACCESS_KEY_ID:?}" "${RCLONE_S3_SECRET_ACCESS_KEY:?}"

# Day and weekday in local time (TZ, set by the CronJob), file name in UTC.
# BACKUP_TIERS forces the buckets, to catch up on a missed Sunday or 1st of
# the month.
if [ -n "${BACKUP_TIERS:-}" ]; then
  tiers=$BACKUP_TIERS
  for tier in $tiers; do
    case $tier in
      daily | weekly | monthly) ;;
      *) echo "BACKUP_TIERS: unknown tier '$tier'." >&2 && exit 1 ;;
    esac
  done
else
  tiers=daily
  if [ "$(date +%u)" = 7 ]; then tiers="$tiers weekly"; fi
  if [ "$(date +%d)" = 01 ]; then tiers="$tiers monthly"; fi
fi
name="$(date -u +%Y-%m-%dT%H%M%SZ).dump.age"

# Only the ciphertext touches the disk. Going through a file rather than
# streaming to the bucket: an interrupted dump is never uploaded, the known
# size spares rclone from reading the object back (which the key may not do),
# and the same file goes to each of the day's buckets.
file="${TMPDIR:-/tmp}/$name"
trap 'rm -f "$file"' EXIT
pg_dump --format=custom --dbname="$BACKUP_DATABASE_URL" \
  | age --recipient "$BACKUP_AGE_RECIPIENT" >"$file"
echo "Encrypted dump: $(du -h "$file" | cut -f1)"

for tier in $tiers; do
  target="$BACKUP_S3_BUCKET_PREFIX-$tier/$name"
  rclone copyto --no-check-dest "$file" ":s3:$target"
  echo "Uploaded: $target"
done
