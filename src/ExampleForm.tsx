import { useAfterTasksSubmit } from "./useAfterTasksSubmit";
import { useAfterTasksField } from "./useAfterTasksField";
import { useAfterTasksFieldState } from "./useAfterTasksField";
import { useState } from "react";
import {
  AfterTasksProvider,
  useAfterTasks,
  type AfterTasksContext,
} from "./AfterTasks";

type Values = { name: string; address: string };
type Props = {
  normalizeName: (
    value: string,
    context: { signal: AbortSignal },
  ) => Promise<string>;
  normalizeAddress: (
    value: string,
    context: { signal: AbortSignal },
  ) => Promise<string>;
  save: (values: Values, context: AfterTasksContext) => Promise<void>;
};

/**
 * 通常のinputだけを使う例です。AfterTasksInputは不要です。
 * 期限の指定を省略し、既定の無期限で待機します。
 * 期限を設ける場合は、Providerまたは各Hookへ数値（ミリ秒）を指定します。
 */
export function ExampleForm(props: Props) {
  return (
    <AfterTasksProvider>
      <Fields {...props} />
    </AfterTasksProvider>
  );
}

function FieldError({ taskKey }: { taskKey: string }) {
  const field = useAfterTasksFieldState(taskKey);
  return field.phase === "error" ? (
    <span role="alert">入力を確認して再度フォーカスを外してください。</span>
  ) : null;
}

function Fields({ normalizeName, normalizeAddress, save }: Props) {
  const [values, setValues] = useState<Values>({ name: "", address: "" });
  const [error, setError] = useState<string | null>(null);
  const { runAfterTasks, isRunning } = useAfterTasks(
    // valuesはactionを開始するレンダーでのsnapshotです。
    // signalとrequestIdを通信層まで渡すと、中断・ログ記録に利用できます。
    async (context) => {
      await save(values, context);
    },
    {
      beforeWait: () => {
        setError(null);
      },
      onError: (error) =>
        setError(error instanceof Error ? error.message : "処理に失敗しました"),
    },
  );
  // normalizeとstate反映をHookへ渡します。DOMには通常のinputを使います。
  const nameField = useAfterTasksField({
    taskKey: "name",
    value: values.name,
    normalize: normalizeName,
    onCommit: (name) => setValues((previous) => ({ ...previous, name })),
  });
  const addressField = useAfterTasksField({
    taskKey: "address",
    value: values.address,
    normalize: normalizeAddress,
    onCommit: (address) => setValues((previous) => ({ ...previous, address })),
  });
  const submitEvents = useAfterTasksSubmit(runAfterTasks);
  return (
    <form {...submitEvents}>
      <label>
        氏名
        <input
          value={values.name}
          readOnly={isRunning}
          onChange={(event) => {
            const name = event.currentTarget.value;
            nameField.change(name);
            setValues((previous) => ({ ...previous, name }));
          }}
          onBlur={nameField.commit}
        />
      </label>
      <FieldError taskKey="name" />
      <label>
        住所
        <input
          value={values.address}
          readOnly={isRunning}
          onChange={(event) => {
            const address = event.currentTarget.value;
            addressField.change(address);
            setValues((previous) => ({ ...previous, address }));
          }}
          onBlur={addressField.commit}
        />
      </label>
      <FieldError taskKey="address" />
      <button type="submit" disabled={isRunning}>
        {isRunning ? "処理中…" : "保存"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
