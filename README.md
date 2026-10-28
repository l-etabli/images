# images

Generic container images shared by l-etabli projects, published to
`ghcr.io/l-etabli/<image>`.

| Image | Purpose |
|---|---|
| [`pg-backup`](pg-backup/README.md) | nightly PostgreSQL dump, age-encrypted, uploaded to S3 |

## Rules

- **Generic only.** No project-specific value in an image, its examples or its
  tests: no real bucket, endpoint, key, DSN or domain. Projects configure an
  image through its environment.
- **One directory per image**, with its Dockerfile, scripts, tests, README and
  workflow `.github/workflows/<image>.yml`.
- **Readable, immutable tags.** A release is a git tag
  `<image>/<variant>-v<semver>` (e.g. `pg-backup/pg17-v1.0.0`), published as
  `ghcr.io/l-etabli/<image>:<variant>-<semver>` (`pg17-1.0.0`). A published tag
  is never overwritten; there is no `latest`.
- **Base images by readable tag** (`postgres:17-alpine`), never by digest.
- Built on GitHub-hosted runners, amd64 only.

## Release

```sh
git tag pg-backup/pg17-v1.0.0
git push origin pg-backup/pg17-v1.0.0
```

The package must be public (GitHub → package settings → visibility) for
projects to pull it without credentials.

## Development

```sh
pnpm install
pnpm test
```
