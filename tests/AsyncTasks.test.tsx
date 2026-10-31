// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Suspense, startTransition, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsyncTasksProvider,
  UncertainActionError,
  createTaskStore,
  useAsyncTasks,
  useLatestCommitted,
  type ActionContext,
} from "../src/AsyncTasks";
import { deferred, flush, never } from "./helpers";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("task store", () => {
  it("waits for tasks added while waiting", async () => {
    const store = createTaskStore();
    const first = deferred<void>();
    const second = deferred<void>();
    store.registerAsyncTask("first", () => first.promise);
    let finished = false;
    const waiting = store.wait().then(() => {
      finished = true;
    });
    store.registerAsyncTask("second", () => second.promise);
    first.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    second.resolve();
    await waiting;
    expect(finished).toBe(true);
  });
  it("retains errors until the same field succeeds", async () => {
    const store = createTaskStore();
    store.registerAsyncTask("name", () => Promise.reject(new Error("invalid")));
    await expect(store.wait()).rejects.toBeInstanceOf(AggregateError);
    await expect(store.wait()).rejects.toBeInstanceOf(AggregateError);
    store.registerAsyncTask("name", () => Promise.resolve());
    await expect(store.wait()).resolves.toBeUndefined();
  });
  it("locks actions within the scope and ignores stale releases", () => {
    const store = createTaskStore();
    const first = store.beginAction()!;
    expect(store.beginAction()).toBeNull();
    store.release(first);
    const second = store.beginAction()!;
    store.release(first);
    expect(store.getSnapshot().busy).toBe(true);
    store.release(second);
    expect(store.getSnapshot().busy).toBe(false);
  });
});
describe("replacement tasks", () => {
  it("does not revive an old failure after a newer task with the same key succeeds", async () => {
    const store = createTaskStore();
    const old = deferred<void>();
    store.registerAsyncTask("name", () => old.promise);
    store.registerAsyncTask("name", () => Promise.resolve());
    await Promise.resolve();
    await Promise.resolve();
    old.reject(new Error("obsolete"));
    await expect(store.wait()).resolves.toBeUndefined();
  });
});
describe("store deadlines and fields", () => {
  it("validates defaults and overrides", () => {
    for (const n of [0, -1, NaN, Infinity])
      expect(() => createTaskStore({ taskTimeoutMs: n })).toThrow(RangeError);
    expect(() => createTaskStore({ taskTimeoutMs: null })).not.toThrow();
    expect(() =>
      createTaskStore().registerAsyncTask("x", () => 1, { timeoutMs: 0 }),
    ).toThrow();
  });
  it("times out, aborts, retains the error and discards a late success", async () => {
    vi.useFakeTimers();
    const task = deferred<string>();
    const commit = vi.fn();
    const onTaskError = vi.fn();
    const store = createTaskStore({ taskTimeoutMs: 10, onTaskError });
    const handle = store.registerAsyncTask("x", () => task.promise, {
      onCommit: commit,
    });
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
    const h = store.registerAsyncTask("x", () => task.promise);
    h.cancel();
    task.reject(new Error("late"));
    await Promise.resolve();
    expect((await h.result).status).toBe("cancelled");
    await store.wait();
  });
  it("bounds total waiting while new tasks arrive", async () => {
    vi.useFakeTimers();
    const store = createTaskStore({ taskTimeoutMs: null });
    store.registerAsyncTask("a", never);
    const wait = store.wait({ timeoutMs: 20 });
    const assertion = expect(wait).rejects.toThrow("タイムアウト");
    await vi.advanceTimersByTimeAsync(10);
    store.registerAsyncTask("b", never);
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    store.cancelInputs();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not block on background tasks or their errors", async () => {
    const onTaskError = vi.fn();
    const store = createTaskStore({ onTaskError });
    const h = store.registerAsyncTask("poll", never, { blocking: false });
    await store.wait();
    store.registerAsyncTask(
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
    store.registerAsyncTask("x", () => {
      throw Error("task");
    });
    await expect(store.wait()).rejects.toThrow();
    store.registerAsyncTask("x", () => 1);
    await store.wait();
    log.mockRestore();
  });
});
describe("actions and recovery", () => {
  function Action({
    action,
    error,
    waitMs = 10,
    actionMs = 10,
  }: {
    action: (ctx: ActionContext) => Promise<void> | void;
    error: (e: unknown) => void;
    waitMs?: number;
    actionMs?: number;
  }) {
    const { runAfterTasks, busy, isResultUnknown, requestId, reconcile } =
      useAsyncTasks(action, {
        onError: error,
        waitTimeoutMs: waitMs,
        actionTimeoutMs: actionMs,
      });
    const [recovered, setRecovered] = useState(false);
    return (
      <>
        <button onClick={runAfterTasks}>runAfterTasks</button>
        <output>
          {busy ? "busy" : isResultUnknown ? "isResultUnknown" : "idle"}
        </output>
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
    fireEvent.click(screen.getByText("runAfterTasks"));
    await flush();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByRole("status").textContent).toBe("isResultUnknown");
    fireEvent.click(screen.getByText("runAfterTasks"));
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
    fireEvent.click(screen.getByText("runAfterTasks"));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("isResultUnknown"),
    );
    expect(error).toHaveBeenCalledTimes(1);
  });
});
describe("committed state", () => {
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
});
describe("snapshot and callback cleanup", () => {
  it("keeps the action snapshot while an explicit getter can read a later commit", async () => {
    const gate = deferred<void>();
    const result = vi.fn();
    function Form() {
      const [value, setValue] = useState("old");
      const get = useLatestCommitted(value);
      const { runAfterTasks } = useAsyncTasks(
        async () => {
          await gate.promise;
          result(value, get());
        },
        { onError: vi.fn() },
      );
      return (
        <>
          <button onClick={runAfterTasks}>runAfterTasks</button>
          <button onClick={() => setValue("new")}>edit</button>
        </>
      );
    }
    render(
      <AsyncTasksProvider>
        <Form />
      </AsyncTasksProvider>,
    );
    fireEvent.click(screen.getByText("runAfterTasks"));
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
      const { runAfterTasks, busy } = useAsyncTasks(action, {
        onError: () => {
          throw Error("handler");
        },
      });
      return (
        <button disabled={busy} onClick={runAfterTasks}>
          runAfterTasks
        </button>
      );
    }
    render(
      <AsyncTasksProvider>
        <Form />
      </AsyncTasksProvider>,
    );
    fireEvent.click(screen.getByText("runAfterTasks"));
    await flush();
    fireEvent.click(screen.getByText("runAfterTasks"));
    await flush();
    expect(action).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});
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
