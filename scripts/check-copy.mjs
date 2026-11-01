// 配布先に必要なファイルだけをコピーし、実際の利用コードと一緒に型チェックします。
// node_modulesは親から解決します。任意ファイルをコピーし忘れた依存も検出します。
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const variants = [
  {
    name: "core",
    files: ["AfterTasks.tsx"],
    usage: `
import { useAfterTasks } from "./AfterTasks";
// @ts-expect-error 旧Hook名の互換exportは提供しない
import { useAsyncTasks } from "./AfterTasks";
// @ts-expect-error 旧Provider名の互換exportは提供しない
import { AsyncTasksProvider } from "./AfterTasks";
// @ts-expect-error 保存結果を分類する専用例外は共通部品から削除
import { UncertainActionError } from "./AfterTasks";
// @ts-expect-error 入力Hookは中心ファイルから再exportしない
import { useAfterTasksField } from "./AfterTasks";
// @ts-expect-error 入力の購読Hookも任意ファイルに置く
import { useAfterTasksFieldState } from "./AfterTasks";
// @ts-expect-error formイベント補助も任意ファイルに置く
import { useAfterTasksSubmit } from "./AfterTasks";
// @ts-expect-error 最新値getterも任意ファイルに置く
import { useLatestCommitted } from "./AfterTasks";
import type {
  AfterTasksConfig, AfterTasksRunOptions, AfterTasksOptions,
  AfterTasksSnapshot, AfterTasksExecution, AfterTasksContext, AfterTasksPhase,
  AfterTasksStore, AfterTasksHandle, AfterTasksResult, AfterTasksStatus,
  AfterTasksErrorKind, AfterTasksTimeout, AfterTasksParticipant,
} from "./AfterTasks";
import { AfterTasksProvider, createAfterTasksStore, AfterTasksError } from "./AfterTasks";
// @ts-expect-error 旧型名の互換exportは提供しない
import type { TaskOptions } from "./AfterTasks";
function Example() {
  const tasks = useAfterTasks();
  const registeredTasksAreRunning: boolean = tasks.hasPendingTasks;
  // @ts-expect-error 任意の入力管理本体を中心ファイルに戻さない
  tasks.mountField("name", "", () => ({}));
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
  const { runAfterTasks, isRunning, hasPendingTasks } = useAfterTasks(() => {}, { onError: console.error });
  // @ts-expect-error 登録だけの呼び出しには実行操作を公開しない
  tasks.runAfterTasks();
  const executor = useAfterTasks(() => {}, { onError: console.error });
  const pendingTasks: boolean = executor.hasPendingTasks;
  // @ts-expect-error 旧名は提供しない
  executor.run();
  // @ts-expect-error 旧状態名は提供しない
  executor.blocked;
  // @ts-expect-error 旧状態名busyは提供しない
  executor.busy;
  // @ts-expect-error 旧状態名taskBusyは提供しない
  executor.taskBusy;
  // @ts-expect-error 結果不明フラグはAPI呼び出し側で管理する
  executor.isResultUnknown;
  // @ts-expect-error 結果照会はAPI呼び出し側で行う
  executor.reconcile("id", async () => "saved");
  return <button onClick={runAfterTasks} disabled={isRunning}>save</button>;
}`,
  },
  {
    name: "fields",
    files: ["AfterTasks.tsx", "useLatestCommitted.ts", "useAfterTasksField.ts"],
    usage: `
import { useAfterTasksField } from "./useAfterTasksField";

function Example() {
  const field = useAfterTasksField({ taskKey: "name", value: "", normalize: v => v.trim(), onCommit: () => {} });

  // @ts-expect-error 互換モード用のnull設定は提供しない
  useAfterTasksField(null);
  return <input onBlur={field.commit} aria-invalid={field.phase === "error"} />;
}`,
  },
  {
    name: "field-state",
    files: [
      "AfterTasks.tsx",
      "useLatestCommitted.ts",
      "useAfterTasksField.ts",
      "useAfterTasksFieldState.ts",
    ],
    usage: `
import { useAfterTasksField } from "./useAfterTasksField";
import { useAfterTasksFieldState } from "./useAfterTasksFieldState";
function Example() {
  const field = useAfterTasksField({ taskKey: "name", value: "", normalize: v => v.trim(), onCommit: () => {} });
  const snapshot = useAfterTasksFieldState("name");
  // @ts-expect-error 互換モード用のnull設定は提供しない
  useAfterTasksField(null);
  return <input onBlur={field.commit} aria-invalid={snapshot.phase === "error"} />;
}`,
  },
  {
    name: "input",
    files: [
      "AfterTasks.tsx",
      "useLatestCommitted.ts",
      "useAfterTasksField.ts",
      "AfterTasksInput.tsx",
    ],
    usage: `
import { AfterTasksInput } from "./AfterTasksInput";
const input = <AfterTasksInput taskKey="name" value="" normalize={v => v} onCommit={() => {}} />;
// @ts-expect-error async onBlurの互換形式は提供しない
const oldInput = <AfterTasksInput taskKey="name" onBlur={async () => {}} />;
// @ts-expect-error 現行形式にonBlurを混在させない
const mixedInput = <AfterTasksInput taskKey="name" value="" normalize={v => v} onCommit={() => {}} onBlur={() => {}} />;
`,
  },
  {
    name: "latest-value",
    files: ["useLatestCommitted.ts"],
    usage: `
import { useLatestCommitted } from "./useLatestCommitted";
function Example() {
  const getValue = useLatestCommitted("value");
  return <span>{getValue()}</span>;
}`,
  },
  {
    name: "submit",
    files: ["AfterTasks.tsx", "useAfterTasksSubmit.ts"],
    usage: `
import { useAfterTasks } from "./AfterTasks";
import { useAfterTasksSubmit } from "./useAfterTasksSubmit";
function Example() {
  const { runAfterTasks } = useAfterTasks(() => {}, { onError: console.error });
  return <form {...useAfterTasksSubmit(runAfterTasks)}><button>save</button></form>;
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
