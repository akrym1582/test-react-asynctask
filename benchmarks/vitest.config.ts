import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["benchmarks/run.test.ts"], fileParallelism: false },
});
