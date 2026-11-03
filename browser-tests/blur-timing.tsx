import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AfterTasksProvider, useAfterTasks } from "../src/AfterTasks";

const params = new URLSearchParams(location.search);
const mode = params.get("mode");
const strategy = params.get("strategy");
const clickMs = Number(params.get("clickMs"));
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function normalize(raw: string): string | Promise<string> {
  if (mode === "sync") return raw.toUpperCase();
  const delay =
    mode === "microtask"
      ? Promise.resolve()
      : sleep(Number(mode?.replace("timer", "")));
  return delay.then(() => raw.toUpperCase());
}

function useForm() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  const [blurs, setBlurs] = useState(0);
  async function save() {
    if (clickMs) await sleep(clickMs);
    setSaved(value);
  }
  return {
    value,
    setValue,
    saved,
    blurs,
    markBlur: () => setBlurs((n) => n + 1),
    save,
  };
}

function Fields({
  form,
  blur,
  click,
}: {
  form: ReturnType<typeof useForm>;
  blur: (raw: string) => void;
  click: () => void;
}) {
  return (
    <>
      <input
        aria-label="Name"
        value={form.value}
        onChange={(event) => form.setValue(event.target.value)}
        onBlur={(event) => {
          form.markBlur();
          blur(event.currentTarget.value);
        }}
      />
      <button onClick={click}>Save</button>
      <output data-testid="saved">{form.saved}</output>
      <output data-testid="blurs">{form.blurs}</output>
    </>
  );
}

function Plain() {
  const form = useForm();
  function blur(raw: string) {
    const result = normalize(raw);
    if (typeof result === "string") form.setValue(result);
    else void result.then(form.setValue);
  }
  return <Fields form={form} blur={blur} click={form.save} />;
}

function Tracked() {
  const form = useForm();
  const [error, setError] = useState("");
  const tasks = useAfterTasks(form.save, {
    onError: (cause) => setError(String(cause)),
  });
  function blur(raw: string) {
    tasks.registerAsyncTask(() => normalize(raw), {
      key: "name",
      onCommit: form.setValue,
    });
  }
  return (
    <>
      <Fields form={form} blur={blur} click={tasks.runAfterTasks} />
      <output data-testid="error">{error}</output>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  strategy === "provider" ? (
    <AfterTasksProvider>
      <Tracked />
    </AfterTasksProvider>
  ) : strategy === "global" ? (
    <Tracked />
  ) : (
    <Plain />
  ),
);
