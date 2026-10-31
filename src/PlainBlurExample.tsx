import { useRef, useState } from "react";
import { AsyncTasksProvider, useAsyncTasks } from "./AsyncTasks";

/**
 * 通常のinputから非同期処理を登録する、中心ファイルだけの使用例です。
 * TrackedInputもuseAsyncFieldも必要ありません。
 * 同じkeyで再登録すると古い結果を破棄します。blur前の再編集にも対応したい場合は、
 * ExampleFormのuseAsyncField方式を使ってください。
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
    <AsyncTasksProvider
      taskTimeoutMs={null}
      waitTimeoutMs={null}
      actionTimeoutMs={null}
    >
      <Fields normalize={normalize} save={save} />
    </AsyncTasksProvider>
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
  const inputRef = useRef<HTMLInputElement>(null);
  const { registerAsyncTask, runAfterTasks, busy, isResultUnknown } =
    useAsyncTasks(
      async () => {
        await save(value);
      },
      {
        // フォーカスが残っている場合も、blurを発生させてから登録済みタスクを待ちます。
        beforeWait: () => {
          setError("");
          inputRef.current?.blur();
        },
        onError: (error) => setError(String(error)),
      },
    );
  return (
    <>
      <input
        ref={inputRef}
        value={value}
        readOnly={busy || isResultUnknown}
        onChange={(event) => setValue(event.currentTarget.value)}
        onBlur={(event) => {
          // SyntheticEventの値はawaitの前に読み取ります。
          const input = event.currentTarget.value;
          registerAsyncTask(
            "value",
            ({ signal }) => normalize(input, { signal }),
            {
              // 取消・期限切れ・同じkeyでの再登録後は、このsetterを呼びません。
              onCommit: setValue,
            },
          );
        }}
      />
      <button
        type="button"
        onClick={runAfterTasks}
        disabled={busy || isResultUnknown}
      >
        保存
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
