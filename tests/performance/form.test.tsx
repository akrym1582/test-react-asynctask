// @vitest-environment jsdom
import { expect, it } from "vitest";
import { measureForm, type Scenario } from "../../benchmarks/form";

// 確認する状況: 項目数を10/100/500に増やし、登録・blur・保存・state更新を実行します。
// 期待する結果: 保存は確定後のstateを参照し、1項目のstate変更で他項目をcommitしません。
// 時間はホスト依存のため合否条件にせず、JSONへ全試行を記録します。jsdomは実ブラウザーではありません。
it.each([10, 100, 500])(
  "%i項目で確定後の保存と再描画範囲を維持する",
  async (size) => {
    for (const scenario of [
      "register",
      "blur-all",
      "blur-one",
      "save-dirty",
      "state-one",
    ] as Scenario[]) {
      const result = await measureForm(size, scenario);
      expect(result.savedLatest).toBe(true);
      if (scenario === "blur-one") {
        expect(result.fieldCommits.slice(1).every((count) => count === 0)).toBe(
          true,
        );
      }
      expect(result.notifications).toBeLessThanOrEqual(5 * size + 30);
      if (scenario === "state-one") {
        expect(result.fieldCommits.slice(1).every((count) => count === 0)).toBe(
          true,
        );
        expect(result.fieldCommits[0]).toBeGreaterThan(0);
        // 1件の編集でnotifyを項目数回繰り返す退行を検出します。
        expect(result.notifications).toBeLessThanOrEqual(2 * size + 2);
      }
    }
  },
  30000,
);
