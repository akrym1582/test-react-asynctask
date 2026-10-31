import { useState } from "react";
import { useAsyncTasks } from "./AsyncTasks";
import { useLatestCommitted } from "./useLatestCommitted";

/** 親にAsyncTasksProviderを置いて利用する、getter方式だけの小さな例。 */
export function LatestStateExample({
  check,
  save,
}: {
  check: () => Promise<void>;
  save: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const getValue = useLatestCommitted(value);
  const { runAfterTasks, busy, isResultUnknown } = useAsyncTasks(
    async () => {
      await check();
      // check待機中にcommitされた編集を含めて読む。
      // 同じ操作の入力を固定したい場合は通常のsnapshot方式を選ぶ。
      await save(getValue());
    },
    { onError: (error) => setError(String(error)) },
  );
  return (
    <>
      <input
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <button onClick={runAfterTasks} disabled={busy || isResultUnknown}>
        確認して保存
      </button>
      <p>{error}</p>
    </>
  );
}
