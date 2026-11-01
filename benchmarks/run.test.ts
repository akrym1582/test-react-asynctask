// @vitest-environment jsdom
import { mkdirSync, writeFileSync } from "node:fs";
import { measureStore } from "./store";
import { it, expect } from "vitest";
import { measureForm, type Measurement, type Scenario } from "./form";

// 確認する状況: 同一プロセスで2回warmupし、各条件を7回測定します。
// 期待する結果: 全保存が最新stateを参照し、生の時間・通知・commit回数を再集計できます。
it("大量入力フォームの全試行をJSONに記録する", async () => {
  const samples: Measurement[] = [];
  for (const size of [10, 100, 500]) {
    for (const scenario of [
      "register",
      "blur-all",
      "blur-one",
      "save-dirty",
      "state-one",
    ] as Scenario[]) {
      for (let trial = -2; trial < 7; trial++) {
        const result = await measureForm(size, scenario);
        expect(result.savedLatest).toBe(true);
        if (trial >= 0) samples.push(result);
      }
    }
  }
  const storeSamples = [];
  for (const size of [10, 100, 500]) {
    for (let trial = -2; trial < 7; trial++) {
      const result = await measureStore(size);
      expect(result.pendingChecks).toBe(0);
      if (trial >= 0) storeSamples.push(result);
    }
  }
  mkdirSync("benchmark-results", { recursive: true });
  writeFileSync(
    `benchmark-results/${process.env.BENCH_LABEL ?? "current"}-jsdom.json`,
    JSON.stringify(
      {
        environment: {
          node: process.version,
          platform: process.platform,
          mode: "React development / jsdom / no StrictMode",
          label: process.env.BENCH_LABEL ?? "current",
        },
        samples,
        storeSamples,
      },
      null,
      2,
    ),
  );
}, 180000);
