import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.integration.test.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
          sequence: { concurrent: false },
        },
      },
      {
        test: {
          name: "live",
          include: ["tests/live/**/*.live.test.ts"],
          fileParallelism: false,
          testTimeout: 240_000,
          hookTimeout: 240_000,
          sequence: { concurrent: false },
        },
      },
    ],
  },
});
