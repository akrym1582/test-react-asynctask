// 配布先に必要なファイルだけをコピーし、実際の利用コードと一緒に型チェックします。
// node_modulesは親から解決します。任意ファイルをコピーし忘れた依存も検出します。
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const variants = [
  {
    name: "core",
    files: ["AsyncTasks.tsx"],
    usage: `
import { useAsyncTasks } from "./AsyncTasks";
// @ts-expect-error 分離されていた旧Hookは公開しない
import { useAfterTasks } from "./AsyncTasks";
// @ts-expect-error 入力Hookは中心ファイルから再exportしない
import { useAsyncField } from "./AsyncTasks";
// @ts-expect-error 入力の購読Hookも任意ファイルに置く
import { useTaskField } from "./AsyncTasks";
// @ts-expect-error formイベント補助も任意ファイルに置く
import { useAsyncSubmit } from "./AsyncTasks";
function Example() {
  const tasks = useAsyncTasks();
  const registeredTasksAreRunning: boolean = tasks.taskBusy;
  tasks.registerAsyncTask(async () => "ok", {
    timeoutMs: null, onCommit: value => { const text: string = value; },
  });
  tasks.registerAsyncTask(async () => "ok");
  tasks.registerAsyncTask(async () => "ok", { key: "name" });
  // @ts-expect-error keyを第1引数にする旧形式は提供しない
  tasks.registerAsyncTask("name", async () => "ok");
  // @ts-expect-error 開始済みPromiseを直接渡す旧形式は提供しない
  tasks.registerAsyncTask(Promise.resolve(), "name");
  // @ts-expect-error 旧名の別名は提供しない
  tasks.track("name", () => "ok");
  // @ts-expect-error registerという汎用名も提供しない
  tasks.register(Promise.resolve());
  const { runAfterTasks, busy, taskBusy } = useAsyncTasks(() => {}, { onError: console.error });
  // @ts-expect-error 登録だけの呼び出しには実行操作を公開しない
  tasks.runAfterTasks();
  const executor = useAsyncTasks(() => {}, { onError: console.error });
  const pendingTasks: boolean = executor.taskBusy;
  // @ts-expect-error 旧名は提供しない
  executor.run();
  // @ts-expect-error 旧状態名は提供しない
  executor.blocked;
  return <button onClick={runAfterTasks} disabled={busy}>save</button>;
}`,
  },
  {
    name: "fields",
    files: ["AsyncTasks.tsx", "useAsyncField.ts"],
    usage: `
import { useAsyncField, useTaskField } from "./useAsyncField";
function Example() {
  const field = useAsyncField({ taskKey: "name", value: "", normalize: v => v.trim(), onCommit: () => {} });
  const snapshot = useTaskField("name");
  // @ts-expect-error 互換モード用のnull設定は提供しない
  useAsyncField(null);
  return <input onBlur={field.commit} aria-invalid={snapshot.phase === "error"} />;
}`,
  },
  {
    name: "input",
    files: ["AsyncTasks.tsx", "useAsyncField.ts", "TrackedInput.tsx"],
    usage: `
import { TrackedInput } from "./TrackedInput";
const input = <TrackedInput taskKey="name" value="" normalize={v => v} onCommit={() => {}} />;
// @ts-expect-error async onBlurの互換形式は提供しない
const oldInput = <TrackedInput taskKey="name" onBlur={async () => {}} />;
// @ts-expect-error 現行形式にonBlurを混在させない
const mixedInput = <TrackedInput taskKey="name" value="" normalize={v => v} onCommit={() => {}} onBlur={() => {}} />;
`,
  },
  {
    name: "submit",
    files: ["AsyncTasks.tsx", "useAsyncSubmit.ts"],
    usage: `
import { useAsyncTasks } from "./AsyncTasks";
import { useAsyncSubmit } from "./useAsyncSubmit";
function Example() {
  const { runAfterTasks } = useAsyncTasks(() => {}, { onError: console.error });
  return <form {...useAsyncSubmit(runAfterTasks)}><button>save</button></form>;
}`,
  },
];

for (const variant of variants) {
  const temporary = mkdtempSync(join(process.cwd(), ".copy-check-"));
  try {
    for (const file of variant.files)
      copyFileSync(resolve("src", file), join(temporary, file));
    writeFileSync(join(temporary, "usage.tsx"), variant.usage);
    writeFileSync(
      join(temporary, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM"],
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["*.ts", "*.tsx"],
      }),
    );
    console.log(`Copy check: ${variant.name}`);
    const check = spawnSync(
      process.execPath,
      [resolve("node_modules/typescript/bin/tsc"), "-p", temporary],
      { stdio: "inherit" },
    );
    if (check.status !== 0) process.exitCode = check.status ?? 1;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
