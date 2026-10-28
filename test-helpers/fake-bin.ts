import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// Returns a directory of fake executables, to prepend to PATH. Drive each
// fake through env vars and keep per-test state (call logs, fixtures) in a
// per-test directory.
//
// Written once and reused across test runs, keyed by content: macOS scans
// every freshly written executable on its first exec — ~150ms each,
// serialized machine-wide by a system daemon — and remembers the verdict
// until the file changes. Fakes rewritten for every test made the script
// suite crawl and time out on a loaded machine; now only the first run
// after a fake changes pays the scan.
export const fakeBin = (fakes: Readonly<Record<string, string>>) => {
  const key = createHash("sha256").update(JSON.stringify(fakes)).digest("hex").slice(0, 16);
  const directory = resolve(tmpdir(), `fake-bin-${key}`);
  if (isIntact({ directory, fakes })) return directory;

  // Temp cleaners purge old files one by one and can leave the directory
  // behind. Never reuse a partial set: a missing fake would fall through PATH
  // to the real binary.
  discard(directory);
  build({ directory, fakes });
  return directory;
};

const isIntact = ({ directory, fakes }: { readonly directory: string; readonly fakes: Readonly<Record<string, string>> }) =>
  Object.entries(fakes).every(([name, content]) => {
    const path = resolve(directory, name);
    try {
      accessSync(path, constants.X_OK);
      return readFileSync(path, "utf8") === content;
    } catch {
      return false;
    }
  });

const discard = (directory: string) => {
  if (!existsSync(directory)) return;
  // Move aside first so a concurrent run never builds into a half-deleted set.
  // A failed move (a concurrent run got there first) is harmless: build()
  // then fails to rename unless an intact set is in place.
  const doomed = `${directory}-stale-${process.pid}-${Date.now()}`;
  try {
    renameSync(directory, doomed);
  } catch {
    return;
  }
  rmSync(doomed, { recursive: true, force: true });
};

// Build aside then rename, so a concurrent run never sees a partial set.
const build = ({ directory, fakes }: { readonly directory: string; readonly fakes: Readonly<Record<string, string>> }) => {
  const staging = mkdtempSync(resolve(tmpdir(), "fake-bin-staging-"));
  try {
    for (const [name, content] of Object.entries(fakes)) {
      writeFileSync(resolve(staging, name), content, { mode: 0o755 });
    }
    renameSync(staging, directory);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    // Only losing the race to a concurrent run with identical content is fine.
    if (!isIntact({ directory, fakes })) throw error;
  }
};
