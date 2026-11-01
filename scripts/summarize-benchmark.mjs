import { readFileSync } from "node:fs";

// 各JSONの全試行から再集計します。時間の閾値による合否判定はしません。
const files = process.argv.slice(2);
if (!files.length)
  throw new Error("比較するbenchmark JSONのパスを指定してください");
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const p95 = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
};
console.log(
  "# フォーム性能の実測結果\n\n各条件2回warmup・7回測定。時間はms、中央値（totalのみP95も併記）。P95は7試行では最大値です。通知は公開subscribeコールバックへの配信合計、commitはmountを除く入力コンポーネントのlayout effect回数です。\n",
);
for (const file of files) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  console.log(
    `## ${data.environment.label ?? data.environment.browser}\n\n環境: ${JSON.stringify(data.environment)}\n`,
  );
  console.log(
    "| 項目数 | 条件 | 登録 | 編集/state | blur/保存開始 | 待機 | 全体 | 全体P95 | 通知配信 | 入力commit |\n|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const size of [10, 100, 500]) {
    for (const scenario of [
      "register",
      "blur-all",
      "blur-one",
      "save-dirty",
      "state-one",
    ]) {
      const rows = data.samples.filter(
        (row) => row.size === size && row.scenario === scenario,
      );
      const value = (key) => median(rows.map((row) => row[key])).toFixed(3);
      console.log(
        `| ${size} | ${scenario} | ${value("registerMs")} | ${value("editMs")} | ${value("blurMs")} | ${value("waitMs")} | ${value("totalMs")} | ${p95(rows.map((r) => r.totalMs)).toFixed(3)} | ${value("notifications")} | ${median(rows.map((r) => r.fieldCommits.reduce((a, b) => a + b, 0)))} |`,
      );
    }
  }
  if (data.storeSamples) {
    console.log(
      "\n背景タスクだけを残した独立storeの測定（React/DOMなし）:\n\n| タスク数 | 登録ms | hasPending 10,000回ms | wait ms |\n|---:|---:|---:|---:|",
    );
    for (const size of [10, 100, 500]) {
      const rows = data.storeSamples.filter((r) => r.size === size);
      console.log(
        `| ${size} | ${median(rows.map((r) => r.registerMs)).toFixed(3)} | ${median(rows.map((r) => r.checkMs)).toFixed(3)} | ${median(rows.map((r) => r.waitMs)).toFixed(3)} |`,
      );
    }
  }
  console.log("");
}
