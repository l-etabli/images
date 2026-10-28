import { defineConfig } from "vitest/config";

// The tests spawn real scripts against fake CLIs, under spawn timeouts of
// 10 s: past Vitest's 5 s default on a busy machine.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    include: ["*/*.unit.test.ts"],
  },
});
