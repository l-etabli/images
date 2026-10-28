# pg-backup

`ghcr.io/l-etabli/pg-backup`: a nightly PostgreSQL backup for a Kubernetes
CronJob. `dump.sh` takes a custom-format `pg_dump`, encrypts it on the fly to
an [age](https://age-encryption.org) public key, and uploads the ciphertext
with rclone to S3-compatible storage:

- `<prefix>-daily` every run,
- `<prefix>-weekly` on Sundays,
- `<prefix>-monthly` on the 1st,

in the local time zone (`TZ`). Each bucket's own lifecycle rule handles
retention; the image never lists or deletes anything.

The image ships `pg_dump`, `age`, `rclone`, `tzdata` and `sentry-cli`, so the
CronJob can wrap the dump in `sentry-cli monitors run` for Sentry Crons.

## Tags

`pg<major>-<semver>`, e.g. `pg17-1.0.0`. The major is the PostgreSQL client's:
`pg_dump` refuses a server newer than itself, so pick a major at or above the
backed-up database's. Published tags never change; there is no `latest`.

## Environment

| Variable | Required | Description |
|---|---|---|
| `BACKUP_DATABASE_URL` | yes | `postgresql://…` of a read-only role |
| `BACKUP_AGE_RECIPIENT` | yes | age public key `age1…`; the private key stays offline |
| `BACKUP_S3_BUCKET_PREFIX` | yes | e.g. `acme-dumps` for `acme-dumps-daily`, `-weekly`, `-monthly` |
| `RCLONE_S3_ENDPOINT` | yes | e.g. `https://s3.eu-central-003.backblazeb2.com` |
| `RCLONE_S3_REGION` | depends on the provider | e.g. `eu-central-003` |
| `RCLONE_S3_ACCESS_KEY_ID` | yes | key ID of a write-only key |
| `RCLONE_S3_SECRET_ACCESS_KEY` | yes | secret of the same key |
| `TZ` | no | time zone deciding Sundays and the 1st; set it to the CronJob's `timeZone` |
| `TMPDIR` | no | where the encrypted dump lands before upload (`/tmp` by default) |
| `BACKUP_TIERS` | no | forces the buckets, e.g. `daily monthly`, to catch up on a missed Sunday or 1st |
| `SENTRY_DSN` | with `sentry-cli monitors run` | DSN of the project holding the monitor |

The key may only write: rclone is configured not to check the bucket nor read
the object back (`RCLONE_S3_NO_CHECK_BUCKET`, `RCLONE_S3_NO_HEAD`,
`RCLONE_IGNORE_CHECKSUM`). Check the dumps with a separate read key, by
restoring one.

Only the ciphertext touches the disk, and an interrupted dump is never
uploaded: mount a writable `TMPDIR` large enough for one encrypted dump.

## CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: acme-backup
spec:
  schedule: "0 2 * * *"
  timeZone: Europe/Paris
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 1800
  jobTemplate:
    spec:
      backoffLimit: 0
      activeDeadlineSeconds: 3600
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: backup
              image: ghcr.io/l-etabli/pg-backup:pg17-1.0.0
              # Reports start, end and exit code to Sentry Crons, which also
              # alerts on a missed night.
              command:
                - sentry-cli
                - monitors
                - run
                - --schedule
                - "0 2 * * *"
                - --timezone
                - Europe/Paris
                - --check-in-margin
                - "30"
                - --max-runtime
                - "60"
                - database-backup
                - --
                - dump.sh
              env:
                - name: HOME
                  value: /tmp
                - name: TMPDIR
                  value: /tmp
                - name: TZ
                  value: Europe/Paris
                - name: BACKUP_AGE_RECIPIENT
                  value: age1…
                - name: BACKUP_S3_BUCKET_PREFIX
                  value: acme-dumps
                - name: RCLONE_S3_ENDPOINT
                  value: https://s3.eu-central-003.backblazeb2.com
                - name: RCLONE_S3_REGION
                  value: eu-central-003
              envFrom:
                # BACKUP_DATABASE_URL, RCLONE_S3_ACCESS_KEY_ID,
                # RCLONE_S3_SECRET_ACCESS_KEY, SENTRY_DSN
                - secretRef:
                    name: acme-backup
              volumeMounts:
                - name: tmp
                  mountPath: /tmp
          volumes:
            - name: tmp
              emptyDir:
                sizeLimit: 2Gi
```

Without Sentry, run `dump.sh` directly (the image's default command).

## Restore

```sh
age -d -i backup.key -o <file>.dump <file>.dump.age \
  && pg_restore --no-owner --no-privileges --exit-on-error \
       --dbname="postgresql://restorer@…/empty_database" <file>.dump
```

- **Through a file, never a pipe.** age rejects a truncated or altered file
  only when it reaches the damaged part, after writing everything before it:
  `age -d … | pg_restore` would load the start of a damaged dump.
- **Never as a superuser.** A dump runs with the rights of whoever loads it,
  and anyone can forge one encrypted to the public key. Load it as the owner
  of an empty database (created from `template0`) that is not a superuser;
  create the dump's extensions beforehand (`pg_restore --list` shows them).
  PostGIS needs a server that has it.
- Restore into a throwaway database first, and delete the clear dump and the
  key file after use.

## Upgrades

- **PostgreSQL major**: change `FROM postgres:<major>-alpine` and release
  `pg-backup/pg<major>-v…`. Release it before upgrading the databases it backs
  up.
- **sentry-cli**: bump `getsentry/sentry-cli:<version>` by hand, checking the
  `sentry-cli monitors run` options, and release a new version.
- **Alpine packages** (age, rclone): rebuilt with each release.
