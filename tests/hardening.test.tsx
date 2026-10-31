// @vitest-environment jsdom
import { TrackedInput } from "../src/TrackedInput";
import { StrictMode, Suspense, startTransition, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsyncTasksProvider,
  createTaskStore,
  useAfterTasks,
  useAsyncSubmit,
  useLatestCommitted,
  useTaskField,
  UncertainActionError,
} from "../src/AsyncTasks";
import { createMemorySaveAdapter } from "../src/exampleSaveAdapter";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const never = () => new Promise<never>(() => {});
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("store deadlines and fields", () => {
  it("validates defaults and overrides", () => {
    for (const n of [0, -1, NaN, Infinity])
      expect(() => createTaskStore({ taskTimeoutMs: n })).toThrow(RangeError);
    expect(() => createTaskStore({ taskTimeoutMs: null })).not.toThrow();
    expect(() =>
      createTaskStore().track("x", () => 1, { timeoutMs: 0 }),
    ).toThrow();
  });
  it("times out, aborts, retains the error and discards a late success", async () => {
    vi.useFakeTimers();
    const task = deferred<string>();
    const commit = vi.fn();
    const onTaskError = vi.fn();
    const store = createTaskStore({ taskTimeoutMs: 10, onTaskError });
    const handle = store.track("x", () => task.promise, { onCommit: commit });
    await vi.advanceTimersByTimeAsync(10);
    expect(handle.signal.aborted).toBe(true);
    expect((await handle.result).status).toBe("timedOut");
    await expect(store.wait()).rejects.toThrow();
    task.resolve("late");
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    expect(onTaskError).toHaveBeenCalledTimes(1);
    await expect(store.wait()).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("handles late rejection after cancellation", async () => {
    const task = deferred<void>();
    const store = createTaskStore();
    const h = store.track("x", () => task.promise);
    h.cancel();
    task.reject(new Error("late"));
    await Promise.resolve();
    expect((await h.result).status).toBe("cancelled");
    await store.wait();
  });
  it("bounds total waiting while new tasks arrive", async () => {
    vi.useFakeTimers();
    const store = createTaskStore({ taskTimeoutMs: null });
    store.track("a", never);
    const wait = store.wait({ timeoutMs: 20 });
    const assertion = expect(wait).rejects.toThrow("タイムアウト");
    await vi.advanceTimersByTimeAsync(10);
    store.track("b", never);
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    store.cancelInputs();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not block on background tasks or their errors", async () => {
    const onTaskError = vi.fn();
    const store = createTaskStore({ onTaskError });
    const h = store.track("poll", never, { blocking: false });
    await store.wait();
    store.track(
      "background",
      () => {
        throw Error("background");
      },
      { blocking: false },
    );
    await store.wait();
    expect(onTaskError).toHaveBeenCalledTimes(1);
    h.cancel();
  });
  it("invalidates at edit time before another blur and flushes dirty fields", async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const commit = vi.fn();
    const normalize = vi.fn((v: string) => (v === "A" ? a.promise : b.promise));
    const store = createTaskStore();
    const field = store.mountField("name", "", () => ({
      normalize,
      onCommit: commit,
    }));
    field.change("A");
    field.commit();
    field.commit();
    expect(normalize).toHaveBeenCalledTimes(1);
    field.change("B");
    a.resolve("obsolete");
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    const wait = store.wait();
    b.resolve("latest");
    await wait;
    expect(commit).toHaveBeenCalledExactlyOnceWith("latest");
    expect(field.snapshot().phase).toBe("clean");
    field.dispose();
  });
  it("does not let an old never-ending generation block the new one", async () => {
    const store = createTaskStore();
    const commit = vi.fn();
    const field = store.mountField("x", "", () => ({
      normalize: (v) => (v === "old" ? never() : v),
      onCommit: commit,
    }));
    field.change("old");
    field.commit();
    field.change("new");
    await store.wait();
    expect(commit).toHaveBeenCalledExactlyOnceWith("new");
    field.dispose();
  });
  it("keeps field failures separate and removes only a disposed owner", async () => {
    const store = createTaskStore();
    let valid = false;
    const a = store.mountField("a", "", () => ({
      normalize: () => {
        if (!valid) throw Error("a");
        return "ok";
      },
      onCommit: () => {},
    }));
    const b = store.mountField("b", "", () => ({
      normalize: () => {
        throw Error("b");
      },
      onCommit: () => {},
    }));
    a.change("a");
    b.change("b");
    await expect(store.wait()).rejects.toThrow();
    valid = true;
    a.commit(true);
    await expect(store.wait()).rejects.toThrow();
    b.dispose();
    await store.wait();
    a.dispose();
    const replacement = store.mountField("a", "", () => ({
      normalize: (v) => v,
      onCommit: () => {},
    }));
    a.dispose();
    expect(() =>
      store.mountField("a", "", () => ({
        normalize: (v) => v,
        onCommit: () => {},
      })),
    ).toThrow("重複");
    replacement.dispose();
  });
  it("treats commit throws as validation errors and aborts on external reset", async () => {
    const store = createTaskStore();
    const deferredTask = deferred<string>();
    const commit = vi.fn(() => {
      throw Error("commit");
    });
    const field = store.mountField("x", "", () => ({
      normalize: (v) => (v === "old" ? deferredTask.promise : v),
      onCommit: commit,
    }));
    field.change("old");
    field.commit();
    field.sync("reset");
    deferredTask.resolve("late");
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    await expect(store.wait()).rejects.toThrow();
    field.dispose();
  });
  it("cleans up after a throwing task error callback", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createTaskStore({
      onTaskError: () => {
        throw Error("callback");
      },
    });
    store.track("x", () => {
      throw Error("task");
    });
    await expect(store.wait()).rejects.toThrow();
    store.track("x", () => 1);
    await store.wait();
    log.mockRestore();
  });
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
    const { run, busy } = useAfterTasks(() => onSave(value), {
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
        <button onClick={run} disabled={busy}>
          save
        </button>
        <output>{field.phase}</output>
      </>
    );
  }
  it("flushes focused dirty input from run without requiring blur", async () => {
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
  it("shows field failure immediately, before run", async () => {
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

describe("actions and recovery", () => {
  function Action({
    action,
    error,
    waitMs = 10,
    actionMs = 10,
  }: {
    action: (ctx: any) => Promise<void> | void;
    error: (e: unknown) => void;
    waitMs?: number;
    actionMs?: number;
  }) {
    const { run, busy, blocked, requestId, reconcile } = useAfterTasks(action, {
      onError: error,
      waitTimeoutMs: waitMs,
      actionTimeoutMs: actionMs,
    });
    const [recovered, setRecovered] = useState(false);
    return (
      <>
        <button onClick={run}>run</button>
        <output>{busy ? "busy" : blocked ? "blocked" : "idle"}</output>
        <button
          onClick={() => {
            void reconcile(requestId!, async () => "saved").then(setRecovered);
          }}
        >
          recover
        </button>
        <span>{String(recovered)}</span>
      </>
    );
  }
  it("quarantines timed-out actions until settled AND externally confirmed", async () => {
    vi.useFakeTimers();
    const d = deferred<void>();
    const error = vi.fn();
    const action = vi.fn(() => d.promise);
    render(
      <AsyncTasksProvider>
        <Action action={action} error={error} />
      </AsyncTasksProvider>,
    );
    fireEvent.click(screen.getByText("run"));
    await flush();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByRole("status").textContent).toBe("blocked");
    fireEvent.click(screen.getByText("run"));
    expect(action).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("recover"));
    await flush();
    expect(screen.getByText("false")).toBeTruthy();
    await act(async () => d.resolve());
    expect(error).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("recover"));
    await flush();
    expect(screen.getByText("true")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("idle");
  });
  it("quarantines adapter-reported unknown results and rejects stale request IDs", async () => {
    const store = createTaskStore();
    const owner = store.beginAction()!;
    store.markUncertain(owner);
    owner.settled = true;
    expect(await store.reconcile("wrong", async () => "saved")).toBe(false);
    expect(await store.reconcile(owner.id, async () => "unknown")).toBe(false);
    expect(await store.reconcile(owner.id, async () => "not-saved")).toBe(true);
    const error = vi.fn();
    render(
      <AsyncTasksProvider>
        <Action
          action={async () => {
            throw new UncertainActionError();
          }}
          error={error}
        />
      </AsyncTasksProvider>,
    );
    fireEvent.click(screen.getByText("run"));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("blocked"),
    );
    expect(error).toHaveBeenCalledTimes(1);
  });
  it("uses stable requestId with the fake idempotency contract", async () => {
    const adapter = createMemorySaveAdapter<{ name: string }>();
    const context = { signal: new AbortController().signal, requestId: "id" };
    await adapter.save({ name: "x" }, context);
    await adapter.save({ name: "x" }, context);
    expect(adapter.getCount()).toBe(1);
    expect(await adapter.lookup("id")).toBe("saved");
    await expect(adapter.save({ name: "y" }, context)).rejects.toThrow();
  });
});

describe("committed state and IME", () => {
  it("stable getter reads a newer commit but not a suspended render", async () => {
    let getter!: () => string;
    let set!: (v: string) => void;
    const blocker = never();
    let previous: unknown;
    function Form() {
      const [value, setValue] = useState("old");
      set = setValue;
      const get = useLatestCommitted(value);
      if (previous) expect(get).toBe(previous);
      previous = get;
      getter = get;
      if (value === "suspend") throw blocker;
      return <span>{value}</span>;
    }
    render(
      <Suspense fallback="loading">
        <Form />
      </Suspense>,
    );
    expect(getter()).toBe("old");
    act(() => set("new"));
    expect(getter()).toBe("new");
    act(() => startTransition(() => set("suspend")));
    expect(getter()).toBe("new");
  });
  it("blocks conversion Enter, permits next Enter and explicit click", () => {
    const run = vi.fn();
    function Form() {
      return (
        <form {...useAsyncSubmit(run)}>
          <input />
          <button>save</button>
        </form>
      );
    }
    const view = render(<Form />);
    const input = screen.getByRole("textbox");
    const form = view.container.querySelector("form")!;
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.submit(form);
    expect(run).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.submit(form);
    expect(run).not.toHaveBeenCalled();
    fireEvent.keyUp(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.submit(form);
    expect(run).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(input, { key: "Enter" });
    fireEvent.compositionStart(input);
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.submit(form);
    expect(run).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByText("save"));
    fireEvent.submit(form);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("request timeout and snapshot contract", () => {
  it("releases a timed-out wait, cancels managed input, and never saves late results", async () => {
    vi.useFakeTimers();
    const task = deferred<string>();
    const save = vi.fn();
    const error = vi.fn();
    function Form() {
      const [value, setValue] = useState("");
      const { run, busy } = useAfterTasks(
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
          <button onClick={run}>run</button>
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
    fireEvent.click(screen.getByText("run"));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(error).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("false");
    await act(async () => task.resolve("late"));
    expect(save).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("raw");
  });
  it("keeps the action snapshot while an explicit getter can read a later commit", async () => {
    const gate = deferred<void>();
    const result = vi.fn();
    function Form() {
      const [value, setValue] = useState("old");
      const get = useLatestCommitted(value);
      const { run } = useAfterTasks(
        async () => {
          await gate.promise;
          result(value, get());
        },
        { onError: vi.fn() },
      );
      return (
        <>
          <button onClick={run}>run</button>
          <button onClick={() => setValue("new")}>edit</button>
        </>
      );
    }
    render(
      <AsyncTasksProvider>
        <Form />
      </AsyncTasksProvider>,
    );
    fireEvent.click(screen.getByText("run"));
    await flush();
    fireEvent.click(screen.getByText("edit"));
    await act(async () => gate.resolve());
    expect(result).toHaveBeenCalledExactlyOnceWith("old", "new");
  });
  it("cleans up the action lock even when onError throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const action = vi.fn(() => {
      throw Error("action");
    });
    function Form() {
      const { run, busy } = useAfterTasks(action, {
        onError: () => {
          throw Error("handler");
        },
      });
      return (
        <button disabled={busy} onClick={run}>
          run
        </button>
      );
    }
    render(
      <AsyncTasksProvider>
        <Form />
      </AsyncTasksProvider>,
    );
    fireEvent.click(screen.getByText("run"));
    await flush();
    fireEvent.click(screen.getByText("run"));
    await flush();
    expect(action).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});
