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
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsyncTasksProvider, useAsyncTasks } from "../src/AsyncTasks";
import { TrackedInput } from "../src/TrackedInput";
import { useTaskField } from "../src/useAsyncField";
import { deferred } from "./helpers";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("managed UI", () => {
  function Form({
    normalize,
    onSave,
  }: {
    normalize: (v: string) => Promise<string>;
    onSave: (v: string) => void;
  }) {
    const [value, setValue] = useState("");
    const field = useTaskField("x");
    const { runAfterTasks, busy } = useAsyncTasks(() => onSave(value), {
      onError: () => {},
    });
    return (
      <>
        <TrackedInput
          aria-label="value"
          taskKey="x"
          value={value}
          normalize={normalize}
          onCommit={setValue}
          onChange={(e) => setValue(e.currentTarget.value)}
        />
        <button onClick={runAfterTasks} disabled={busy}>
          save
        </button>
        <output>{field.phase}</output>
      </>
    );
  }
  it("flushes focused dirty input from runAfterTasks without requiring blur", async () => {
    const d = deferred<string>();
    const save = vi.fn();
    render(
      <StrictMode>
        <AsyncTasksProvider>
          <Form normalize={() => d.promise} onSave={save} />
        </AsyncTasksProvider>
      </StrictMode>,
    );
    fireEvent.change(screen.getByLabelText("value"), {
      target: { value: "raw" },
    });
    fireEvent.click(screen.getByText("save"));
    await act(async () => d.resolve("normalized"));
    await waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith("normalized"),
    );
  });
  it("shows field failure immediately, before runAfterTasks", async () => {
    render(
      <AsyncTasksProvider>
        <Form
          normalize={async () => {
            throw Error("bad");
          }}
          onSave={vi.fn()}
        />
      </AsyncTasksProvider>,
    );
    const input = screen.getByLabelText("value");
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("error"),
    );
  });
  it("drops late writes after field and provider unmount", async () => {
    const d = deferred<string>();
    const commit = vi.fn();
    const view = render(
      <StrictMode>
        <AsyncTasksProvider>
          <TrackedInput
            taskKey="x"
            value=""
            onChange={() => {}}
            normalize={() => d.promise}
            onCommit={commit}
          />
        </AsyncTasksProvider>
      </StrictMode>,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "raw" } });
    fireEvent.blur(screen.getByRole("textbox"));
    view.unmount();
    await act(async () => d.resolve("late"));
    expect(commit).not.toHaveBeenCalled();
  });
});
