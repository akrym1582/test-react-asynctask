import { useAsyncField } from "../src/useAsyncField";
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
  useAsyncTasks,
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

it.each([false, true])(
  "waits indefinitely with default deadlines or explicit null overrides (override=%s)",
  async (override) => {
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
        timeoutMs: override ? null : undefined,
        onCommit: setValue,
      });
      const { runAfterTasks, busy, isResultUnknown } = useAsyncTasks(
        () => save(value),
        {
          onError: error,
          waitTimeoutMs: override ? null : undefined,
          actionTimeoutMs: override ? null : undefined,
        },
      );
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
          <button onClick={runAfterTasks}>save</button>
          <output>
            {busy ? "busy" : isResultUnknown ? "isResultUnknown" : "idle"}
          </output>
        </>
      );
    }
    render(
      <StrictMode>
        <AsyncTasksProvider
          {...(override
            ? { taskTimeoutMs: 5, waitTimeoutMs: 5, actionTimeoutMs: 5 }
            : {})}
        >
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
  },
);

it("registerAsyncTask can wait indefinitely through Provider/store defaults", async () => {
  vi.useFakeTimers();
  const task = deferred<void>();
  const store = createTaskStore();
  store.registerAsyncTask("input", () => task.promise);
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

it("registerAsyncTask timeoutMs null overrides a finite default", async () => {
  vi.useFakeTimers();
  const task = deferred<string>();
  const store = createTaskStore({ taskTimeoutMs: 5 });
  const handle = store.registerAsyncTask("x", () => task.promise, {
    timeoutMs: null,
  });
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
    const { runAfterTasks } = useAsyncTasks(() => saved(value), {
      onError: vi.fn(),
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
        <button onClick={runAfterTasks}>save</button>
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
