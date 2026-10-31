import { useRef, useState } from "react";
import { AsyncTasksProvider } from "./AsyncTasksContext";
import { TrackedInput } from "./TrackedInput";
import { useAfterTasks } from "./useAfterTasks";

type Values = { name: string; address: string };
type Props = {
  normalizeName: (value: string) => Promise<string>;
  normalizeAddress: (value: string) => Promise<string>;
  save: (values: Values) => Promise<void>;
};

export function ExampleForm(props: Props) {
  return <AsyncTasksProvider><Fields {...props} /></AsyncTasksProvider>;
}

function Fields({ normalizeName, normalizeAddress, save }: Props) {
  const [values, setValues] = useState<Values>({ name: "", address: "" });
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null); // DOM用。stateのコピーではない。

  const { run, busy } = useAfterTasks(
    async () => {
      await save(values);
    },
    {
      beforeWait: () => {
        setError(null);
        const active = document.activeElement;
        if (active instanceof HTMLElement && formRef.current?.contains(active)) {
          active.blur();
        }
      },
      onError: () => setError("入力の確定または保存に失敗しました。再入力してお試しください。"),
    },
  );

  return <form ref={formRef} onSubmit={(event) => { event.preventDefault(); run(); }}>
    <label>氏名
      <TrackedInput taskKey="name" value={values.name} readOnly={busy}
        onChange={(event) => {
          const name = event.currentTarget.value;
          setValues((previous) => ({ ...previous, name }));
        }}
        onBlur={async (event) => {
          const input = event.currentTarget.value;
          const name = await normalizeName(input);
          setValues((previous) => ({ ...previous, name }));
        }} />
    </label>
    <label>住所
      <TrackedInput taskKey="address" value={values.address} readOnly={busy}
        onChange={(event) => {
          const address = event.currentTarget.value;
          setValues((previous) => ({ ...previous, address }));
        }}
        onBlur={async (event) => {
          const input = event.currentTarget.value;
          const address = await normalizeAddress(input);
          setValues((previous) => ({ ...previous, address }));
        }} />
    </label>
    <button type="submit" disabled={busy}>{busy ? "処理中…" : "保存"}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
