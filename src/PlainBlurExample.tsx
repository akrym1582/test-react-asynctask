import { useRef, useState } from "react";
import { AsyncTasksProvider, useAfterTasks, useAsyncTasks } from "./AsyncTasks";

/**
 * 既存のasync onBlurをそのまま登録する、最小限の使用例です。
 * TrackedInputもuseAsyncFieldも必要ありません。
 * この方式は完了待機のみを提供します。再編集時に古い結果を破棄したい場合は、
 * ExampleFormのuseAsyncField方式を使ってください。
 */
export function PlainBlurExample({
  normalize,
  save,
}: {
  normalize: (value: string) => Promise<string>;
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
  normalize: (value: string) => Promise<string>;
  save: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { register } = useAsyncTasks();
  const { run, busy, blocked } = useAfterTasks(
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
  async function handleBlur(input: string) {
    const result = await normalize(input);
    setValue(result);
  }
  return (
    <>
      <input
        ref={inputRef}
        value={value}
        readOnly={busy || blocked}
        onChange={(event) => setValue(event.currentTarget.value)}
        onBlur={(event) =>
          register(handleBlur(event.currentTarget.value), "value")
        }
      />
      <button type="button" onClick={run} disabled={busy || blocked}>
        保存
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
