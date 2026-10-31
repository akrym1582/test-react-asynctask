// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AsyncTasksProvider, useAsyncTasks } from "../../src/AsyncTasks";
import { TrackedInput } from "../../src/TrackedInput";
import { deferred } from "../helpers";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("releases a timed-out wait, cancels managed input, and never saves late results", async () => {
  vi.useFakeTimers();
  const task = deferred<string>();
  const save = vi.fn();
  const error = vi.fn();
  function Form() {
    const [value, setValue] = useState("");
    const { runAfterTasks, busy } = useAsyncTasks(
      () => {
        save(value);
      },
      { onError: error, waitTimeoutMs: 10 },
    );
    return (
      <>
        <TrackedInput
          taskKey="x"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          normalize={() => task.promise}
          onCommit={setValue}
        />
        <button onClick={runAfterTasks}>runAfterTasks</button>
        <output>{String(busy)}</output>
      </>
    );
  }
  render(
    <AsyncTasksProvider taskTimeoutMs={null}>
      <Form />
    </AsyncTasksProvider>,
  );
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "raw" } });
  fireEvent.click(screen.getByText("runAfterTasks"));
  await act(async () => vi.advanceTimersByTimeAsync(10));
  expect(error).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status").textContent).toBe("false");
  await act(async () => task.resolve("late"));
  expect(save).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("raw");
});
