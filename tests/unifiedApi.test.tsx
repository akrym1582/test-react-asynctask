// @vitest-environment jsdom
import { useState } from "react";
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
  UncertainActionError,
  useAsyncTasks,
} from "../src/AsyncTasks";
afterEach(cleanup);

it("shares busy and unknown result with a registration-only consumer", async () => {
  let reject!: (reason: unknown) => void;
  const saving = new Promise<void>((_, no) => {
    reject = no;
  });
  function Observer() {
    const { busy, isResultUnknown } = useAsyncTasks();
    return (
      <output>{busy ? "busy" : isResultUnknown ? "unknown" : "idle"}</output>
    );
  }
  function Form() {
    const { runAfterTasks } = useAsyncTasks(() => saving, { onError: vi.fn() });
    return <button onClick={runAfterTasks}>save</button>;
  }
  render(
    <AsyncTasksProvider>
      <Observer />
      <Form />
    </AsyncTasksProvider>,
  );
  fireEvent.click(screen.getByText("save"));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("busy"),
  );
  await act(async () => reject(new UncertainActionError()));
  expect(screen.getByRole("status").textContent).toBe("unknown");
});

it("registers and saves the updated state from the same hook", async () => {
  let resolve!: (value: string) => void;
  const input = new Promise<string>((yes) => {
    resolve = yes;
  });
  const save = vi.fn();
  function Form() {
    const [value, setValue] = useState("old");
    const { registerAsyncTask, runAfterTasks } = useAsyncTasks(
      () => save(value),
      { onError: vi.fn() },
    );
    return (
      <button
        onClick={() => {
          registerAsyncTask("name", () => input, { onCommit: setValue });
          runAfterTasks();
        }}
      >
        save
      </button>
    );
  }
  render(
    <AsyncTasksProvider>
      <Form />
    </AsyncTasksProvider>,
  );
  fireEvent.click(screen.getByText("save"));
  expect(save).not.toHaveBeenCalled();
  await act(async () => resolve("new"));
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith("new"));
});
