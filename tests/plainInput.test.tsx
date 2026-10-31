// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  AsyncTasksProvider,
  createTaskStore,
  useAfterTasks,
  useAsyncField,
} from "../src/AsyncTasks";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("null disables input, overall wait and action deadlines, including hook overrides", async () => {
  vi.useFakeTimers();
  const normalize = deferred<string>();
  const saving = deferred<void>();
  const error = vi.fn();
  const save = vi.fn((_value: string) => saving.promise);
  function Form() {
    const [value, setValue] = useState("");
    const field = useAsyncField({
      taskKey: "x",
      value,
      normalize: () => normalize.promise,
      onCommit: setValue,
    });
    const { run, busy, blocked } = useAfterTasks(() => save(value), {
      onError: error,
      waitTimeoutMs: null,
      actionTimeoutMs: null,
    });
    return (
      <>
        <input
          value={value}
          onChange={(e) => {
            field.change(e.currentTarget.value);
            setValue(e.currentTarget.value);
          }}
          onBlur={field.commit}
        />
        <button onClick={run}>save</button>
        <output>{busy ? "busy" : blocked ? "blocked" : "idle"}</output>
      </>
    );
  }
  render(
    <StrictMode>
      <AsyncTasksProvider taskTimeoutMs={null}>
        <Form />
      </AsyncTasksProvider>
    </StrictMode>,
  );
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "raw" } });
  fireEvent.click(screen.getByText("save"));
  await act(async () => vi.advanceTimersByTimeAsync(3600000));
  expect(save).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toBe("busy");
  await act(async () => normalize.resolve("normalized"));
  expect(save).toHaveBeenCalledExactlyOnceWith("normalized");
  await act(async () => vi.advanceTimersByTimeAsync(3600000));
  expect(screen.getByRole("status").textContent).toBe("busy");
  expect(error).not.toHaveBeenCalled();
  await act(async () => saving.resolve());
  expect(screen.getByRole("status").textContent).toBe("idle");
  expect(vi.getTimerCount()).toBe(0);
});

it("legacy registerAsyncTask can wait indefinitely through Provider/store defaults", async () => {
  vi.useFakeTimers();
  const task = deferred<void>();
  const store = createTaskStore({ taskTimeoutMs: null, waitTimeoutMs: null });
  store.registerAsyncTask(task.promise, "legacy");
  let completed = false;
  const waiting = store.wait().then(() => {
    completed = true;
  });
  await vi.advanceTimersByTimeAsync(3600000);
  expect(completed).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  task.resolve();
  await waiting;
  expect(completed).toBe(true);
});

it("track timeoutMs null overrides a finite default", async () => {
  vi.useFakeTimers();
  const task = deferred<string>();
  const store = createTaskStore({ taskTimeoutMs: 5 });
  const handle = store.track("x", () => task.promise, { timeoutMs: null });
  await vi.advanceTimersByTimeAsync(3600000);
  expect(handle.getStatus()).toBe("pending");
  task.resolve("done");
  expect(await handle.result).toEqual({ status: "fulfilled", value: "done" });
});

it("a native input ignores a previous edit even before the next blur", async () => {
  const old = deferred<string>();
  const current = deferred<string>();
  const saved = vi.fn();
  function Form() {
    const [value, setValue] = useState("");
    const field = useAsyncField({
      taskKey: "x",
      value,
      normalize: (v) => (v === "A" ? old.promise : current.promise),
      onCommit: setValue,
    });
    const { run } = useAfterTasks(() => saved(value), { onError: vi.fn() });
    return (
      <>
        <input
          value={value}
          onChange={(e) => {
            field.change(e.currentTarget.value);
            setValue(e.currentTarget.value);
          }}
          onBlur={field.commit}
        />
        <button onClick={run}>save</button>
      </>
    );
  }
  render(
    <StrictMode>
      <AsyncTasksProvider>
        <Form />
      </AsyncTasksProvider>
    </StrictMode>,
  );
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "A" } });
  fireEvent.blur(input);
  fireEvent.change(input, { target: { value: "B" } });
  await act(async () => old.resolve("obsolete"));
  expect((input as HTMLInputElement).value).toBe("B");
  fireEvent.click(screen.getByText("save"));
  await act(async () => current.resolve("latest"));
  await waitFor(() => expect(saved).toHaveBeenCalledExactlyOnceWith("latest"));
});
