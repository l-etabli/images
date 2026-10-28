# PostgreSQL backup image (README.md): the PostgreSQL client, age to encrypt,
# rclone to upload to S3 storage, sentry-cli for Sentry Crons. pg_dump refuses
# a server newer than itself: this major version is the one in the image tag
# (pg17-…) and must stay at or above the backed-up database's. Bump sentry-cli
# by hand, checking the `sentry-cli monitors run` options.
FROM getsentry/sentry-cli:3.8.2 AS sentry-cli

# The client is enough for extensions too: pg_dump does not need PostGIS, the
# restore recreates it with CREATE EXTENSION.
FROM postgres:17-alpine
RUN apk add --no-cache age rclone tzdata
COPY --from=sentry-cli /bin/sentry-cli /usr/local/bin/sentry-cli
COPY dump.sh /usr/local/bin/dump.sh
# The job's key may only write: it can neither check the bucket nor read the
# object back to compare its checksum. A restore check does that.
# rclone is configured through the environment only.
# TZ comes from the CronJob; tzdata lets date read it.
ENV RCLONE_CONFIG=/dev/null \
    RCLONE_S3_PROVIDER=Other \
    RCLONE_S3_NO_CHECK_BUCKET=true \
    RCLONE_S3_NO_HEAD=true \
    RCLONE_IGNORE_CHECKSUM=true
ENTRYPOINT []
CMD ["dump.sh"]
