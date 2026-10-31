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
import { AsyncTasksProvider, useAsyncTasks } from "../src/AsyncTasks";
afterEach(cleanup);

it.each([undefined, true, false])(
  "auto blur=%s runs before preparation and waits for registered state",
  async (blurActiveElement) => {
    let resolve!: (value: string) => void;
    const task = new Promise<string>((yes) => {
      resolve = yes;
    });
    const events: string[] = [];
    const save = vi.fn();
    const error = vi.fn();
    function Form() {
      const [value, setValue] = useState("old");
      const { registerAsyncTask, runAfterTasks } = useAsyncTasks(
        () => save(value),
        {
          blurActiveElement,
          beforeWait: () => {
            events.push("prepare");
          },
          onError: error,
        },
      );
      return (
        <>
          <input
            aria-label="value"
            onBlur={() => {
              events.push("blur");
              registerAsyncTask("name", () => task, { onCommit: setValue });
              runAfterTasks(); // blurから再入しても、同じ要求を重複実行しない
            }}
          />
          <button onClick={runAfterTasks}>save</button>
        </>
      );
    }
    render(
      <AsyncTasksProvider>
        <Form />
      </AsyncTasksProvider>,
    );
    const input = screen.getByLabelText("value");
    input.focus();
    // fireEvent.clickはフォーカスを変更しないため、Hook自身のblurを検証できます。
    fireEvent.click(screen.getByText("save"));
    if (blurActiveElement === false) {
      expect(document.activeElement).toBe(input);
      expect(events).toEqual(["prepare"]);
      await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith("old"));
    } else {
      expect(document.activeElement).not.toBe(input);
      expect(events).toEqual(["blur", "prepare"]);
      expect(save).not.toHaveBeenCalled();
      await act(async () => resolve("new"));
      await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith("new"));
    }
    expect(error).not.toHaveBeenCalled();
  },
);

it("reports blur failures without preparation or saving and releases busy", async () => {
  const failure = new Error("blur failed");
  const onError = vi.fn();
  const beforeWait = vi.fn();
  const save = vi.fn();
  function Form() {
    const { runAfterTasks, busy, isResultUnknown } = useAsyncTasks(save, {
      onError,
      beforeWait,
    });
    return (
      <>
        <input />
        <button onClick={runAfterTasks}>save</button>
        <output>{`${busy}/${isResultUnknown}`}</output>
      </>
    );
  }
  render(
    <AsyncTasksProvider>
      <Form />
    </AsyncTasksProvider>,
  );
  const input = screen.getByRole("textbox");
  input.focus();
  const blur = vi.spyOn(input, "blur").mockImplementation(() => {
    throw failure;
  });
  try {
    fireEvent.click(screen.getByText("save"));
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(beforeWait).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("false/false");
  } finally {
    blur.mockRestore();
  }
});
