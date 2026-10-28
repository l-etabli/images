import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBin } from "../test-helpers/fake-bin.ts";

const script = fileURLToPath(new URL("./dump.sh", import.meta.url));

// pg_dump and rclone log their calls to $CALLS. date answers the local weekday and day
// of month from FAKE_WEEKDAY / FAKE_DAY, and a fixed UTC timestamp.
const fakes = fakeBin({
  date: `#!/usr/bin/env bash
case "$*" in
  "+%u") echo "$FAKE_WEEKDAY" ;;
  "+%d") echo "$FAKE_DAY" ;;
  "-u +%Y-%m-%dT%H%M%SZ") echo 2026-11-01T010203Z ;;
  *) echo "unexpected date $*" >&2; exit 1 ;;
esac
`,
  pg_dump: `#!/usr/bin/env bash
echo "pg_dump $*" >> "$CALLS"
echo -n "plain-dump"
if [ -n "\${PG_DUMP_FAILS:-}" ]; then exit 1; fi
`,
  // Not logged: it runs concurrently with pg_dump, so the call order would
  // be racy. Its arguments show in the uploaded content instead.
  age: `#!/usr/bin/env bash
echo -n "age $*($(cat))"
`,
  rclone: `#!/usr/bin/env bash
echo "rclone $1 $2 \${3##*/} $4 <- $(cat "$3")" >> "$CALLS"
`,
});

let directory: string;
let temporaryDirectory: string;

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), "backup-dump-"));
  temporaryDirectory = resolve(directory, "tmp");
  mkdirSync(temporaryDirectory);
  writeFileSync(resolve(directory, "calls"), "");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const runDump = ({
  weekday = "3",
  day = "15",
  env = {},
}: {
  weekday?: string;
  day?: string;
  env?: Readonly<Record<string, string | undefined>>;
} = {}) => {
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    timeout: 10_000,
    env: {
      PATH: `${fakes}:${process.env.PATH}`,
      CALLS: resolve(directory, "calls"),
      TMPDIR: temporaryDirectory,
      FAKE_WEEKDAY: weekday,
      FAKE_DAY: day,
      BACKUP_DATABASE_URL: "postgresql://backup_reader:secret@db.example.com:5432/app",
      BACKUP_AGE_RECIPIENT: "age1recipient",
      BACKUP_S3_BUCKET_PREFIX: "acme-dumps",
      RCLONE_S3_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
      RCLONE_S3_ACCESS_KEY_ID: "key-id",
      RCLONE_S3_SECRET_ACCESS_KEY: "key",
      ...env,
    },
  });
  const calls = readFileSync(resolve(directory, "calls"), "utf8").trim().split("\n").filter(Boolean);
  return { result, calls, uploads: calls.filter((call) => call.startsWith("rclone ")) };
};

const upload = (tier: string) =>
  `rclone copyto --no-check-dest 2026-11-01T010203Z.dump.age :s3:acme-dumps-${tier}/2026-11-01T010203Z.dump.age <- age --recipient age1recipient(plain-dump)`;

describe("dump.sh", () => {
  it("encrypts a custom-format dump to the age recipient and uploads only the ciphertext to the daily bucket", () => {
    const { result, calls } = runDump();

    expect(result.status, result.stderr).toBe(0);
    expect(calls).toEqual([
      "pg_dump --format=custom --dbname=postgresql://backup_reader:secret@db.example.com:5432/app",
      upload("daily"),
    ]);
    expect(result.stdout).toContain("Uploaded: acme-dumps-daily/2026-11-01T010203Z.dump.age");
  });

  it.each([
    { when: "a weekday", weekday: "3", day: "15", tiers: ["daily"] },
    { when: "a Sunday", weekday: "7", day: "15", tiers: ["daily", "weekly"] },
    { when: "the 1st of the month", weekday: "3", day: "01", tiers: ["daily", "monthly"] },
    { when: "a Sunday the 1st", weekday: "7", day: "01", tiers: ["daily", "weekly", "monthly"] },
  ])("uploads the same file to $tiers on $when", ({ weekday, day, tiers }) => {
    const { result, uploads } = runDump({ weekday, day });

    expect(result.status, result.stderr).toBe(0);
    expect(uploads).toEqual(tiers.map(upload));
  });

  it("uploads to the BACKUP_TIERS buckets whatever the date, to catch up on a missed Sunday or 1st", () => {
    const { result, uploads } = runDump({ weekday: "7", day: "01", env: { BACKUP_TIERS: "daily monthly" } });

    expect(result.status, result.stderr).toBe(0);
    expect(uploads).toEqual([upload("daily"), upload("monthly")]);
  });

  it("refuses an unknown BACKUP_TIERS tier before dumping anything", () => {
    const { result, calls } = runDump({ env: { BACKUP_TIERS: "daily yearly" } });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("BACKUP_TIERS: unknown tier 'yearly'.");
    expect(calls).toEqual([]);
  });

  it("uploads nothing when pg_dump fails midway, and removes the partial file", () => {
    const { result, uploads } = runDump({ env: { PG_DUMP_FAILS: "1" } });

    expect(result.status).not.toBe(0);
    expect(uploads).toEqual([]);
    expect(readdirSync(temporaryDirectory)).toEqual([]);
  });

  it("removes the encrypted file once uploaded", () => {
    const { result } = runDump();

    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(temporaryDirectory)).toEqual([]);
  });

  it.each([
    "BACKUP_DATABASE_URL",
    "BACKUP_AGE_RECIPIENT",
    "BACKUP_S3_BUCKET_PREFIX",
    "RCLONE_S3_ENDPOINT",
    "RCLONE_S3_ACCESS_KEY_ID",
    "RCLONE_S3_SECRET_ACCESS_KEY",
  ])("fails before dumping when %s is missing", (variable) => {
    const { result, calls } = runDump({ env: { [variable]: undefined } });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(variable);
    expect(calls).toEqual([]);
  });
});
