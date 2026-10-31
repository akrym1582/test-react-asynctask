import { useState } from "react";
import { AfterTasksProvider, useAfterTasks } from "./AfterTasks";

/**
 * 通常のinputから非同期処理を登録する、中心ファイルだけの使用例です。
 * AfterTasksInputもuseAfterTasksFieldも必要ありません。
 * keyを省略した処理はすべて独立して待ちます。再編集時の古い結果も破棄したい場合は、
 * ExampleFormのuseAfterTasksField方式を使ってください。
 */
export function PlainBlurExample({
  normalize,
  save,
}: {
  normalize: (
    value: string,
    context: { signal: AbortSignal },
  ) => Promise<string>;
  save: (value: string) => Promise<void>;
}) {
  return (
    <AfterTasksProvider>
      <Fields normalize={normalize} save={save} />
    </AfterTasksProvider>
  );
}
function Fields({
  normalize,
  save,
}: {
  normalize: (
    value: string,
    context: { signal: AbortSignal },
  ) => Promise<string>;
  save: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const { registerAsyncTask, runAfterTasks, isRunning } = useAfterTasks(
    async () => {
      await save(value);
    },
    {
      // 自動blurは既定で有効です。beforeWaitでは画面の準備だけ行います。
      beforeWait: () => {
        setError("");
      },
      onError: (error) => setError(String(error)),
    },
  );
  return (
    <>
      <input
        value={value}
        readOnly={isRunning}
        onChange={(event) => setValue(event.currentTarget.value)}
        onBlur={(event) => {
          // SyntheticEventの値はawaitの前に読み取ります。
          const input = event.currentTarget.value;
          registerAsyncTask(({ signal }) => normalize(input, { signal }), {
            // このタスクが取消・期限切れになった場合は、このsetterを呼びません。
            onCommit: setValue,
          });
        }}
      />
      <button type="button" onClick={runAfterTasks} disabled={isRunning}>
        保存
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
