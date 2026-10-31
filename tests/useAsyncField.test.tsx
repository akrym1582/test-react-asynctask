// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AsyncTasksProvider, useAsyncTasks } from "../src/AsyncTasks";
import { useAsyncField } from "../src/useAsyncField";
import { deferred } from "./helpers";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
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
