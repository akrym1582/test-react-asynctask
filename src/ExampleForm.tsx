import { useRef, useState } from "react";
import {
  AsyncTasksProvider,
  useAsyncField,
  useAfterTasks,
  useAsyncSubmit,
  useTaskField,
  type ActionContext,
} from "./AsyncTasks";

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
  save: (values: Values, context: ActionContext) => Promise<void>;
  lookupRequest?: (
    requestId: string,
  ) => Promise<"saved" | "not-saved" | "unknown">;
};

/**
 * 通常のinputだけを使う例です。TrackedInputは不要です。
 * この例では3種類の期限をnullにし、無期限で待機します。
 * 有限時間へ戻す場合は数値（ミリ秒）を指定するか、Providerの指定を省略します。
 */
export function ExampleForm(props: Props) {
  return (
    <AsyncTasksProvider
      taskTimeoutMs={null}
      waitTimeoutMs={null}
      actionTimeoutMs={null}
    >
      <Fields {...props} />
    </AsyncTasksProvider>
  );
}

function FieldError({ taskKey }: { taskKey: string }) {
  const field = useTaskField(taskKey);
  return field.phase === "error" ? (
    <span role="alert">入力を確認して再度フォーカスを外してください。</span>
  ) : null;
}

function Fields({
  normalizeName,
  normalizeAddress,
  save,
  lookupRequest,
}: Props) {
  const [values, setValues] = useState<Values>({ name: "", address: "" });
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { run, busy, blocked, requestId, reconcile } = useAfterTasks(
    // valuesはactionを開始するレンダーでのsnapshotです。
    // signalとrequestIdを通信層まで渡すと、中断・結果照会に利用できます。
    async (context) => {
      await save(values, context);
    },
    {
      beforeWait: () => {
        setError(null);
        const active = document.activeElement;
        if (active instanceof HTMLElement && formRef.current?.contains(active))
          active.blur();
      },
      onError: (error) =>
        setError(error instanceof Error ? error.message : "処理に失敗しました"),
    },
  );
  // normalizeとstate反映をHookへ渡します。DOMには通常のinputを使います。
  const nameField = useAsyncField({
    taskKey: "name",
    value: values.name,
    normalize: normalizeName,
    onCommit: (name) => setValues((previous) => ({ ...previous, name })),
  });
  const addressField = useAsyncField({
    taskKey: "address",
    value: values.address,
    normalize: normalizeAddress,
    onCommit: (address) => setValues((previous) => ({ ...previous, address })),
  });
  const submitEvents = useAsyncSubmit(run);
  return (
    <form ref={formRef} {...submitEvents}>
      <label>
        氏名
        <input
          value={values.name}
          readOnly={busy || blocked}
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
          readOnly={busy || blocked}
          onChange={(event) => {
            const address = event.currentTarget.value;
            addressField.change(address);
            setValues((previous) => ({ ...previous, address }));
          }}
          onBlur={addressField.commit}
        />
      </label>
      <FieldError taskKey="address" />
      <button type="submit" disabled={busy || blocked}>
        {busy ? "処理中…" : "保存"}
      </button>
      {blocked && (
        <p role="status">
          保存結果が不明です。再送せず、結果を確認してください。
        </p>
      )}
      {blocked && lookupRequest && (
        <button
          type="button"
          onClick={() => {
            if (!requestId) return;
            void reconcile(requestId, lookupRequest).then(
              (resolved) => {
                setError(
                  resolved
                    ? "保存結果を確認しました"
                    : "処理中または結果不明のため、再送を保留しています",
                );
              },
              () => setError("結果の照会に失敗しました"),
            );
          }}
        >
          保存結果を確認
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
