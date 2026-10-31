// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, Suspense, startTransition, useState } from "react";
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
describe("タスクの登録・待機と実行制御", () => {
  // 確認する状況: 先に登録したタスクを待っている途中で、別のkeyのタスクを追加します。
  // 期待する結果: 先のタスクだけ完了しても待機は終わらず、追加したタスクも完了してから終了します。
  it("待機中に追加されたタスクもすべて完了するまで待つ", async () => {
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
  // 確認する状況: nameの処理を失敗させ、待機を繰り返した後、同じkeyで成功する処理を登録します。
  // 期待する結果: 再度待機してもエラーは残り、同じkeyの成功後にだけ待機が正常終了します。
  it("同じ項目が成功するまで入力エラーを保持する", async () => {
    const store = createTaskStore();
    store.registerAsyncTask("name", () => Promise.reject(new Error("invalid")));
    await expect(store.wait()).rejects.toBeInstanceOf(AggregateError);
    await expect(store.wait()).rejects.toBeInstanceOf(AggregateError);
    store.registerAsyncTask("name", () => Promise.resolve());
    await expect(store.wait()).resolves.toBeUndefined();
  });
  // 確認する状況: 要求Aを開始して解除し、要求Bの開始後にもう一度Aの解除を試みます。
  // 期待する結果: 実行中の追加要求は拒否し、古いAの解除ではBのbusyは消えず、Bの解除でidleへ戻ります。
  it("同じProvider内の重複実行と古い要求によるロック解除を防ぐ", () => {
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
describe("同じkeyのタスク置き換え", () => {
  // 確認する状況: 古いname処理を新しい成功処理へ置き換えてから、古いPromiseを失敗させます。
  // 期待する結果: 古い失敗を現在のエラーとして扱わず、待機は正常終了します。
  it("置き換え前のタスクが遅れて失敗しても新しい成功を取り消さない", async () => {
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
describe("タスクの期限と入力の世代管理", () => {
  // 確認する状況: Provider相当の設定とタスク個別設定へ、不正な期限やnullを渡します。
  // 期待する結果: 0・負数・NaN・InfinityはRangeErrorとなり、無期限を表すnullは受け付けます。
  it("期限には正の有限値またはnullだけを受け付ける", () => {
    for (const n of [0, -1, NaN, Infinity])
      expect(() => createTaskStore({ taskTimeoutMs: n })).toThrow(RangeError);
    expect(() => createTaskStore({ taskTimeoutMs: null })).not.toThrow();
    expect(() =>
      createTaskStore().registerAsyncTask("x", () => 1, { timeoutMs: 0 }),
    ).toThrow();
  });
  // 確認する状況: 入力処理の期限を10msに設定し、期限切れ後に元のPromiseを成功させます。
  // 期待する結果: signalは中断状態となり、期限切れを通知・保持します。遅い結果ではonCommitを呼ばず、タイマーも残しません。
  it("期限切れのタスクを中断し遅い成功を反映しない", async () => {
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
  // 確認する状況: タスクをcancelした後、その元のPromiseをrejectします。
  // 期待する結果: ハンドルの状態はcancelledのままで、遅い失敗が待機処理へ伝わらず正常終了します。
  it("取り消したタスクの遅い失敗を保存阻止のエラーにしない", async () => {
    const task = deferred<void>();
    const store = createTaskStore();
    const h = store.registerAsyncTask("x", () => task.promise);
    h.cancel();
    task.reject(new Error("late"));
    await Promise.resolve();
    expect((await h.result).status).toBe("cancelled");
    await store.wait();
  });
  // 確認する状況: 終わらないタスクを待ち、20msの総期限の途中で別タスクを追加します。
  // 期待する結果: タスク追加で計測をやり直さず20msで待機が失敗します。最後に入力を取り消すとタイマーも残りません。
  it("タスクが増えても総待機期限を延長しない", async () => {
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
  // 確認する状況: blocking:falseで終わらない処理と失敗する処理を登録します。
  // 期待する結果: どちらも待機終了を妨げず、背景処理の失敗はonTaskErrorへ1回通知します。
  it("背景タスクの未完了や失敗は保存待機を妨げない", async () => {
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
  // 確認する状況: Aの確定処理を開始し、次のblurより前にBへ編集してからAの結果を返します。
  // 期待する結果: Aをstateへ反映せず、待機がBの確定を開始して最新結果だけを反映します。同じ入力の重複commitも1回にまとめます。
  it("再編集時に古い結果を無効化し最新の未確定入力を待機時に確定する", async () => {
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
  // 確認する状況: 古い入力の処理を未完了のまま残し、新しい値へ編集して待機します。
  // 期待する結果: 古い処理を待ち続けず、新しい値の確定だけで待機が完了しonCommitを1回呼びます。
  it("終わらない古い入力処理に最新入力の保存を妨げさせない", async () => {
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
  // 確認する状況: A・Bを失敗させ、Aだけ再成功させてからBを削除します。さらに同じkeyの入力を作り直します。
  // 期待する結果: Aの成功だけではBの失敗を消さず、Bの削除後に待機できます。古い入力のdisposeは新しい入力を消さず、同じkeyの二重登録は拒否します。
  it("項目別のエラーと入力の所有者を独立して管理する", async () => {
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
  // 確認する状況: 処理中の入力を外部値へ変更し、古い処理を完了させます。新しい入力のonCommitは例外を投げます。
  // 期待する結果: 古い結果ではonCommitを呼ばず、新しい入力のstate反映失敗によって待機を失敗させます。
  it("外部reset後の古い結果を捨てstate反映時の例外も失敗として扱う", async () => {
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
  // 確認する状況: タスク失敗の通知先自身が例外を投げる状況を作り、その後同じkeyを成功させます。
  // 期待する結果: 通知先の例外で内部管理が壊れず、元の失敗を保持した後、新しい成功によって正常待機へ戻れます。
  it("onTaskErrorが例外を投げても後続タスクで回復できる", async () => {
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
describe("保存処理と結果不明からの回復", () => {
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
  // 確認する状況: 保存をタイムアウトさせ、再実行と結果照会を試します。続いて元の保存を完了し再照会します。
  // 期待する結果: isResultUnknownとなり再送を拒否します。元処理が未完了の間は照会だけで解除せず、完了後の照会でidleへ戻します。
  it("保存期限切れは元処理の終了と結果照会の両方が揃うまで再送させない", async () => {
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
  // 確認する状況: 結果不明の要求へ誤ったIDやunknownの照会結果を渡し、別途actionからUncertainActionErrorを投げます。
  // 期待する結果: 誤ったIDやunknownでは解除せず、正しいIDの確定結果だけで解除します。actionが報告した結果不明も通知して再送を止めます。
  it("保存結果不明を保護し異なるrequestIdでの回復を拒否する", async () => {
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
describe("反映済みstateの参照", () => {
  // 確認する状況: 値を正常に更新した後、次の更新をSuspenseで未確定にします。
  // 期待する結果: getterの参照は変わらず、正常更新後は新値を読み、未確定の更新中は直前にcommitされた値を読み続けます。
  it("最新値getterは反映済みの値だけを読み未確定レンダーの値を公開しない", async () => {
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
describe("保存時のstateと例外後の後始末", () => {
  // 確認する状況: action内のawait中に画面のstateを変更し、待機解除後にclosureの値とgetterの値を読みます。
  // 期待する結果: actionのclosureは開始時のoldを維持し、最新値getterだけが反映済みのnewを返します。
  it("保存開始時のstateとawait後の最新値を区別する", async () => {
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
  // 確認する状況: actionを失敗させ、onErrorでも例外を投げた後、もう一度実行します。
  // 期待する結果: エラー通知側の例外があってもbusyを解除し、2回目のactionを開始できます。
  it("onErrorが例外を投げても保存要求のロックを解除する", async () => {
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
// 確認する状況: 期限なしの既定設定で未完了タスクを登録し、仮想時計を1時間進めます。
// 期待する結果: タイマーを作らず待機を続け、タスクを成功させた時点で正常終了します。
it("設定を省略したタスク登録と待機は無期限となる", async () => {
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
// 確認する状況: 既定の入力期限を5msにし、個別タスクにはtimeoutMs:nullを指定します。
// 期待する結果: 1時間経過してもpendingを保ち、完了させるとfulfilledとして結果を取得できます。
it("タスク個別のnullでProviderの有限期限を無効化する", async () => {
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
// 確認する状況: フォーカス中の入力を残して保存し、blur内でタスク登録と保存への再入を行います。省略・true・falseを比較します。
// 期待する結果: 省略とtrueではblur→beforeWaitの順に1回ずつ実行し、最新stateを待って保存します。falseではフォーカスを維持して現在値を保存します。
it.each([undefined, true, false])(
  "自動blur設定=%sに従い準備前に入力を確定する",
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
// 確認する状況: フォーカス中の要素のblurメソッドが例外を投げる状況で保存を実行します。
// 期待する結果: onErrorへ同じ例外を1回通知し、beforeWaitも保存も実行せず、busyとisResultUnknownをfalseに戻します。
it("自動blurの失敗を通知し保存を始めずbusyを解除する", async () => {
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
// 確認する状況: 同じProvider内の別コンポーネントで保存を開始し、結果不明のエラーで終了させます。
// 期待する結果: 引数なしのuseAsyncTasksからも待機中はbusy、結果不明後はisResultUnknownを購読できます。
it("登録専用Hookにも別コンポーネントの実行状態を共有する", async () => {
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
// 確認する状況: 同じuseAsyncTasksで入力タスクを登録し、完了前にrunAfterTasksを呼びます。
// 期待する結果: 完了前は保存せず、onCommitによるstate更新後にnewを引数として保存を1回実行します。
it("1つのHookから登録と実行を行い更新後のstateを保存する", async () => {
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

describe("元の要件: 非同期blurのstate更新を待ってclickの処理を実行する", () => {
  // 確認する状況: 通常のクリックのようにblurが先に始まる場合と、click時点で入力にフォーカスが残る場合を比較します。
  // blurの非同期処理は、テストから完了させるまで未完了に保ちます。表示中のstateはまだ未確定の文字列です。
  // 期待する結果: clickが届いてもすぐには保存せず、blurの結果がonCommitでstateへ反映されてから、最新値で1回だけ保存します。
  // 先行blurの場合は自動blurをfalseにして登録済み処理の待機を確認し、フォーカス残存の場合は既定の自動blurを確認します。
  it.each([
    { label: "blur開始後にclick", blurBeforeClick: true },
    { label: "clickから既定の自動blur", blurBeforeClick: false },
  ])(
    "非同期blur完了後のstateでclickの保存処理を実行する（$label）",
    async ({ blurBeforeClick }) => {
      const normalization = deferred<string>();
      const save = vi.fn();
      const onError = vi.fn();
      const events: string[] = [];

      function Form() {
        const [value, setValue] = useState("old");
        const { registerAsyncTask, runAfterTasks, busy } = useAsyncTasks(
          () => {
            events.push("save");
            save(value);
          },
          { onError, blurActiveElement: blurBeforeClick ? false : undefined },
        );
        return (
          <>
            <input
              aria-label="確定前の入力"
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
              onBlur={(event) => {
                events.push("blur-start");
                const input = event.currentTarget.value;
                registerAsyncTask(
                  "value",
                  async () => {
                    // 実際の通信に相当する待機。ここでは完了タイミングをテストから制御します。
                    const normalized = await normalization.promise;
                    events.push("blur-complete");
                    return `${input.trim()}:${normalized}`;
                  },
                  {
                    onCommit: (normalized) => {
                      events.push("state-update");
                      setValue(normalized);
                    },
                  },
                );
              }}
            />
            <button
              onClick={() => {
                events.push("click");
                runAfterTasks();
              }}
            >
              保存
            </button>
            <output data-testid="value">{value}</output>
            <output data-testid="busy">{String(busy)}</output>
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
      const input = screen.getByLabelText("確定前の入力");
      fireEvent.change(input, { target: { value: " raw " } });
      input.focus();

      // jsdomのfireEvent.clickはフォーカスを移さないため、通常操作の先行blurは明示的に配送します。
      if (blurBeforeClick)
        act(() => {
          input.blur();
        });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await flush();

      // 古いclosureのまま進む実装だと、ここで未確定値を保存してしまうため失敗します。
      expect(save).not.toHaveBeenCalled();
      expect(screen.getByTestId("value").textContent).toBe(" raw ");
      expect(screen.getByTestId("busy").textContent).toBe("true");
      expect(events).toEqual(
        blurBeforeClick ? ["blur-start", "click"] : ["click", "blur-start"],
      );

      await act(async () => normalization.resolve("normalized"));

      // Promiseの完了だけでなくReactのstate反映を経由し、保存側が更新後の値を読むことを確認します。
      await waitFor(() =>
        expect(save).toHaveBeenCalledExactlyOnceWith("raw:normalized"),
      );
      expect(screen.getByTestId("value").textContent).toBe("raw:normalized");
      expect(events.slice(-3)).toEqual([
        "blur-complete",
        "state-update",
        "save",
      ]);
      await waitFor(() =>
        expect(screen.getByTestId("busy").textContent).toBe("false"),
      );
      expect(onError).not.toHaveBeenCalled();
    },
  );
});
