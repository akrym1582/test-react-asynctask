import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AfterTasksProvider, useAfterTasks } from "../../src/AfterTasks";

// registerAsyncTaskも入力Hookも使わず、同期blurによる通常のstate更新だけを検証します。
function Form() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const automatic = new URLSearchParams(location.search).has("automatic");
  const save = () => {
    setEvents((previous) => [...previous, `save:${value}`]);
    setSaved(value);
  };
  const { runAfterTasks } = useAfterTasks(save, {
    onError: (error) => {
      throw error;
    },
  });
  return (
    <>
      <label>
        同期入力
        <input
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          onBlur={(event) => {
            const normalized = event.currentTarget.value.trim().toUpperCase();
            setValue(normalized);
            setEvents((previous) => [...previous, `blur:${normalized}`]);
          }}
        />
      </label>
      <button
        // 自動blurのケースでは自然なフォーカス移動を防ぎ、click開始時もinputのフォーカスを維持します。
        onMouseDown={automatic ? (event) => event.preventDefault() : undefined}
        onClick={automatic ? runAfterTasks : save}
      >
        保存
      </button>
      <output data-testid="saved">{saved}</output>
      <output data-testid="events">{JSON.stringify(events)}</output>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AfterTasksProvider>
      <Form />
    </AfterTasksProvider>
  </StrictMode>,
);
