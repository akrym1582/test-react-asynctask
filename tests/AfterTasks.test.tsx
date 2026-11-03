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
import {
  AfterTasksProvider,
  createAfterTasksStore,
  useAfterTasks,
  type AfterTasksContext,
} from "../src/AfterTasks";
import { deferred, flush, never } from "./helpers";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("タスクの登録・待機と実行制御", () => {
  // 確認する状況: 先に登録したタスクを待っている途中で、別のkeyのタスクを追加します。
  // 期待する結果: 先のタスクだけ完了しても待機は終わらず、追加したタスクも完了してから終了します。
  it("待機中に追加されたタスクもすべて完了するまで待つ", async () => {
    const store = createAfterTasksStore();
    const first = deferred<void>();
    const second = deferred<void>();
    store.registerAsyncTask(() => first.promise, { key: "first" });
    let finished = false;
    const waiting = store.wait().then(() => {
      finished = true;
    });
    store.registerAsyncTask(() => second.promise, { key: "second" });
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
    const store = createAfterTasksStore();
    store.registerAsyncTask(() => Promise.reject(new Error("invalid")), {
      key: "name",
    });
    await expect(store.wait()).rejects.toBeInstanceOf(AggregateError);
    await expect(store.wait()).rejects.toBeInstanceOf(AggregateError);
    store.registerAsyncTask(() => Promise.resolve(), { key: "name" });
    await expect(store.wait()).resolves.toBeUndefined();
  });
  // 確認する状況: 要求Aを開始して解除し、要求Bの開始後にもう一度Aの解除を試みます。
  // 期待する結果: 実行中の追加要求は拒否し、古いAの解除ではBのisRunningは消えず、Bの解除でidleへ戻ります。
  it("同じProvider内の重複実行と古い要求によるロック解除を防ぐ", () => {
    const store = createAfterTasksStore();
    const first = store.beginAction()!;
    expect(store.beginAction()).toBeNull();
    store.release(first);
    const second = store.beginAction()!;
    store.release(first);
    expect(store.getSnapshot().isRunning).toBe(true);
    store.release(second);
    expect(store.getSnapshot().isRunning).toBe(false);
  });
});
describe("同じkeyのタスク置き換え", () => {
  // 確認する状況: 古いname処理を新しい成功処理へ置き換えてから、古いPromiseを失敗させます。
  // 期待する結果: 古い失敗を現在のエラーとして扱わず、待機は正常終了します。
  it("置き換え前のタスクが遅れて失敗しても新しい成功を取り消さない", async () => {
    const store = createAfterTasksStore();
    const old = deferred<void>();
    store.registerAsyncTask(() => old.promise, { key: "name" });
    store.registerAsyncTask(() => Promise.resolve(), { key: "name" });
    await Promise.resolve();
    await Promise.resolve();
    old.reject(new Error("obsolete"));
    await expect(store.wait()).resolves.toBeUndefined();
  });
});
describe("タスクの期限・取消・背景処理", () => {
  // 確認する状況: Provider相当の設定とタスク個別設定へ、不正な期限やnullを渡します。
  // 期待する結果: 0・負数・NaN・InfinityはRangeErrorとなり、無期限を表すnullは受け付けます。
  it("期限には正の有限値またはnullだけを受け付ける", () => {
    for (const n of [0, -1, NaN, Infinity])
      expect(() => createAfterTasksStore({ taskTimeoutMs: n })).toThrow(
        RangeError,
      );
    expect(() => createAfterTasksStore({ taskTimeoutMs: null })).not.toThrow();
    expect(() =>
      createAfterTasksStore().registerAsyncTask(() => 1, {
        key: "x",
        timeoutMs: 0,
      }),
    ).toThrow();
  });
  // 確認する状況: 入力処理の期限を10msに設定し、期限切れ後に元のPromiseを成功させます。
  // 期待する結果: signalは中断状態となり、期限切れを通知・保持します。遅い結果ではonCommitを呼ばず、タイマーも残しません。
  it("期限切れのタスクを中断し遅い成功を反映しない", async () => {
    vi.useFakeTimers();
    const task = deferred<string>();
    const commit = vi.fn();
    const onTaskError = vi.fn();
    const store = createAfterTasksStore({ taskTimeoutMs: 10, onTaskError });
    const handle = store.registerAsyncTask(() => task.promise, {
      key: "x",
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
    const store = createAfterTasksStore();
    const h = store.registerAsyncTask(() => task.promise, { key: "x" });
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
    const store = createAfterTasksStore({ taskTimeoutMs: null });
    store.registerAsyncTask(never, { key: "a" });
    const wait = store.wait({ timeoutMs: 20 });
    const assertion = expect(wait).rejects.toThrow("タイムアウト");
    await vi.advanceTimersByTimeAsync(10);
    store.registerAsyncTask(never, { key: "b" });
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    store.cancelInputs();
    expect(vi.getTimerCount()).toBe(0);
  });
  // 確認する状況: blocking:falseで終わらない処理と失敗する処理を登録します。
  // 期待する結果: どちらも待機終了を妨げず、背景処理の失敗はonTaskErrorへ1回通知します。
  it("背景タスクの未完了や失敗は保存待機を妨げない", async () => {
    const onTaskError = vi.fn();
    const store = createAfterTasksStore({ onTaskError });
    const h = store.registerAsyncTask(never, { key: "poll", blocking: false });
    await store.wait();
    store.registerAsyncTask(
      () => {
        throw Error("background");
      },
      { key: "background", blocking: false },
    );
    await store.wait();
    expect(onTaskError).toHaveBeenCalledTimes(1);
    h.cancel();
  });
  // 確認する状況: タスク失敗の通知先自身が例外を投げる状況を作り、その後同じkeyを成功させます。
  // 期待する結果: 通知先の例外で内部管理が壊れず、元の失敗を保持した後、新しい成功によって正常待機へ戻れます。
  it("onTaskErrorが例外を投げても後続タスクで回復できる", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createAfterTasksStore({
      onTaskError: () => {
        throw Error("callback");
      },
    });
    store.registerAsyncTask(
      () => {
        throw Error("task");
      },
      { key: "x" },
    );
    await expect(store.wait()).rejects.toThrow();
    store.registerAsyncTask(() => 1, { key: "x" });
    await store.wait();
    log.mockRestore();
  });
});

describe("エラー通知後の実行状態の後始末", () => {
  // 確認する状況: actionを失敗させ、onErrorでも例外を投げた後、もう一度実行します。
  // 期待する結果: エラー通知側の例外があってもisRunningを解除し、2回目のactionを開始できます。
  it("onErrorが例外を投げても保存要求のロックを解除する", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const action = vi.fn(() => {
      throw Error("action");
    });
    function Form() {
      const { runAfterTasks, isRunning } = useAfterTasks(action, {
        onError: () => {
          throw Error("handler");
        },
      });
      return (
        <button disabled={isRunning} onClick={runAfterTasks}>
          runAfterTasks
        </button>
      );
    }
    render(
      <AfterTasksProvider>
        <Form />
      </AfterTasksProvider>,
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
  const store = createAfterTasksStore();
  store.registerAsyncTask(() => task.promise, { key: "input" });
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
  const store = createAfterTasksStore({ taskTimeoutMs: 5 });
  const handle = store.registerAsyncTask(() => task.promise, {
    key: "x",
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
      const { registerAsyncTask, runAfterTasks } = useAfterTasks(
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
              registerAsyncTask(() => task, {
                key: "name",
                onCommit: setValue,
              });
              runAfterTasks(); // blurから再入しても、同じ要求を重複実行しない
            }}
          />
          <button onClick={runAfterTasks}>save</button>
        </>
      );
    }
    render(
      <AfterTasksProvider>
        <Form />
      </AfterTasksProvider>,
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
// 期待する結果: onErrorへ同じ例外を1回通知し、beforeWaitも保存も実行せず、isRunningをfalseに戻します。
it("自動blurの失敗を通知し保存を始めずisRunningを解除する", async () => {
  const failure = new Error("blur failed");
  const onError = vi.fn();
  const beforeWait = vi.fn();
  const save = vi.fn();
  function Form() {
    const { runAfterTasks, isRunning } = useAfterTasks(save, {
      onError,
      beforeWait,
    });
    return (
      <>
        <input />
        <button onClick={runAfterTasks}>save</button>
        <output>{String(isRunning)}</output>
      </>
    );
  }
  render(
    <AfterTasksProvider>
      <Form />
    </AfterTasksProvider>,
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
    expect(screen.getByRole("status").textContent).toBe("false");
  } finally {
    blur.mockRestore();
  }
});
// 確認する状況: 同じProvider内の別コンポーネントで保存を開始し、通常のAPIエラーで終了させます。
// 期待する結果: 引数なしのuseAfterTasksからも実行中はisRunning、APIエラーによる終了後はidleへの変化を購読できます。
it("登録専用Hookにも別コンポーネントの実行状態を共有する", async () => {
  let reject!: (reason: unknown) => void;
  const saving = new Promise<void>((_, no) => {
    reject = no;
  });
  function Observer() {
    const { isRunning } = useAfterTasks();
    return <output>{isRunning ? "isRunning" : "idle"}</output>;
  }
  function Form() {
    const { runAfterTasks } = useAfterTasks(() => saving, { onError: vi.fn() });
    return <button onClick={runAfterTasks}>save</button>;
  }
  render(
    <AfterTasksProvider>
      <Observer />
      <Form />
    </AfterTasksProvider>,
  );
  fireEvent.click(screen.getByText("save"));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("isRunning"),
  );
  await act(async () => reject(new Error("save failed")));
  expect(screen.getByRole("status").textContent).toBe("idle");
});
// 確認する状況: 同じuseAfterTasksで入力タスクを登録し、完了前にrunAfterTasksを呼びます。
// 期待する結果: 完了前は保存せず、onCommitによるstate更新後にnewを引数として保存を1回実行します。
it("1つのHookから登録と実行を行い更新後のstateを保存する", async () => {
  let resolve!: (value: string) => void;
  const input = new Promise<string>((yes) => {
    resolve = yes;
  });
  const save = vi.fn();
  function Form() {
    const [value, setValue] = useState("old");
    const { registerAsyncTask, runAfterTasks } = useAfterTasks(
      () => save(value),
      { onError: vi.fn() },
    );
    return (
      <button
        onClick={() => {
          registerAsyncTask(() => input, { key: "name", onCommit: setValue });
          runAfterTasks();
        }}
      >
        save
      </button>
    );
  }
  render(
    <AfterTasksProvider>
      <Form />
    </AfterTasksProvider>,
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
        const { registerAsyncTask, runAfterTasks, isRunning } = useAfterTasks(
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
            <output data-testid="isRunning">{String(isRunning)}</output>
          </>
        );
      }
      render(
        <StrictMode>
          <AfterTasksProvider>
            <Form />
          </AfterTasksProvider>
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
      expect(screen.getByTestId("isRunning").textContent).toBe("true");
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
        expect(screen.getByTestId("isRunning").textContent).toBe("false"),
      );
      expect(onError).not.toHaveBeenCalled();
    },
  );
});

describe("key省略の自動UUID登録と全件待機", () => {
  // 確認する状況: keyを指定せず、未完了のタスクを2件続けて登録し、1件ずつ完了させます。
  // 期待する結果: 後の登録が先の登録を置き換えず、両方のonCommitが実行され、最後の1件が終わるまで待機を続けます。
  it("keyなしのタスクを独立して管理しすべての完了を待つ", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const commitFirst = vi.fn();
    const commitSecond = vi.fn();
    const store = createAfterTasksStore();
    const firstHandle = store.registerAsyncTask(() => first.promise, {
      onCommit: commitFirst,
    });
    const secondHandle = store.registerAsyncTask(() => second.promise, {
      onCommit: commitSecond,
    });
    let completed = false;
    const waiting = store.wait().then(() => {
      completed = true;
    });
    expect(firstHandle.getStatus()).toBe("pending");
    expect(secondHandle.getStatus()).toBe("pending");
    expect(firstHandle.signal.aborted).toBe(false);
    first.resolve("first");
    await firstHandle.result;
    expect(commitFirst).toHaveBeenCalledExactlyOnceWith("first");
    expect(completed).toBe(false);
    second.resolve("second");
    await waiting;
    expect(commitSecond).toHaveBeenCalledExactlyOnceWith("second");
    expect(completed).toBe(true);
  });

  // 確認する状況: 別々の子コンポーネントのblurでkeyなしタスクを登録し、clickで保存を要求します。
  // 待機中には3つ目の子からもタスクを追加し、B→A→Cの順に完了させます。
  // 期待する結果: A・Bだけでは保存せず、追加したCの完了とstate反映も待ち、全項目の最新値で保存を1回だけ呼びます。
  it("子孫のblurタスクとclick後の追加タスクをすべて待って最新stateを保存する", async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const c = deferred<string>();
    const save = vi.fn();
    const onError = vi.fn();
    function Field({
      label,
      promise,
      onCommit,
    }: {
      label: string;
      promise: Promise<string>;
      onCommit: (value: string) => void;
    }) {
      const { registerAsyncTask } = useAfterTasks();
      return (
        <input
          aria-label={label}
          onBlur={() => {
            registerAsyncTask(() => promise, { onCommit });
          }}
        />
      );
    }
    function Form() {
      const [values, setValues] = useState({ a: "", b: "", c: "" });
      const { runAfterTasks } = useAfterTasks(() => save(values), { onError });
      return (
        <>
          <Field
            label="項目A"
            promise={a.promise}
            onCommit={(value) =>
              setValues((previous) => ({ ...previous, a: value }))
            }
          />
          <Field
            label="項目B"
            promise={b.promise}
            onCommit={(value) =>
              setValues((previous) => ({ ...previous, b: value }))
            }
          />
          <Field
            label="項目C"
            promise={c.promise}
            onCommit={(value) =>
              setValues((previous) => ({ ...previous, c: value }))
            }
          />
          <button onClick={runAfterTasks}>全件の完了後に保存</button>
          <output data-testid="all-values">{JSON.stringify(values)}</output>
        </>
      );
    }
    render(
      <StrictMode>
        <AfterTasksProvider>
          <Form />
        </AfterTasksProvider>
      </StrictMode>,
    );
    fireEvent.blur(screen.getByLabelText("項目A"));
    fireEvent.blur(screen.getByLabelText("項目B"));
    fireEvent.click(screen.getByRole("button", { name: "全件の完了後に保存" }));
    fireEvent.blur(screen.getByLabelText("項目C"));
    await act(async () => b.resolve("B確定"));
    expect(save).not.toHaveBeenCalled();
    await act(async () => a.resolve("A確定"));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByTestId("all-values").textContent).toBe(
      JSON.stringify({ a: "A確定", b: "B確定", c: "" }),
    );
    await act(async () => c.resolve("C確定"));
    await waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith({
        a: "A確定",
        b: "B確定",
        c: "C確定",
      }),
    );
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("登録タスクの実行状態hasPendingTasks", () => {
  // 確認する状況: 保存とは独立した背景タスクを登録し、成功・失敗・取消・期限切れでそれぞれ終了させます。
  // 期待する結果: 背景タスクもpending中はhasPendingTasks=trueですがisRunning=falseです。どの終了理由でもhasPendingTasksを解除します。
  it.each(["fulfilled", "rejected", "cancelled", "timedOut"] as const)(
    "背景タスクも実行状態へ含め終了時に解除する（%s）",
    async (status) => {
      vi.useFakeTimers();
      const task = deferred<string>();
      const store = createAfterTasksStore();
      const handle = store.registerAsyncTask(() => task.promise, {
        blocking: false,
        timeoutMs: status === "timedOut" ? 5 : null,
      });
      expect(store.hasPendingTasks).toBe(true);
      expect(store.isRunning).toBe(false);
      if (status === "fulfilled") task.resolve("done");
      else if (status === "rejected") task.reject(new Error("task failed"));
      else if (status === "cancelled") handle.cancel();
      else await vi.advanceTimersByTimeAsync(5);
      expect((await handle.result).status).toBe(status);
      expect(store.hasPendingTasks).toBe(false);
      expect(store.getSnapshot().hasPendingTasks).toBe(false);
      expect(store.isRunning).toBe(false);
    },
  );

  // 確認する状況: タスク登録、保存要求、入力タスク完了、保存action完了を別々に発生させ、別の子から状態を購読します。
  // 期待する結果: hasPendingTasksとisRunningは独立して変化し、登録専用のHookにも全段階の変化が伝わります。
  it("全子孫でhasPendingTasksを共有し入力処理中と保存処理中を区別する", async () => {
    const input = deferred<void>();
    const saving = deferred<void>();
    const save = vi.fn(() => saving.promise);
    function Observer() {
      const { hasPendingTasks, isRunning } = useAfterTasks();
      return <output>{`${hasPendingTasks}/${isRunning}`}</output>;
    }
    function Form() {
      const { registerAsyncTask, runAfterTasks } = useAfterTasks(save, {
        onError: vi.fn(),
      });
      return (
        <>
          <button
            onClick={() => {
              registerAsyncTask(() => input.promise);
            }}
          >
            入力処理を開始
          </button>
          <button onClick={runAfterTasks}>保存を要求</button>
        </>
      );
    }
    render(
      <StrictMode>
        <AfterTasksProvider>
          <Observer />
          <Form />
        </AfterTasksProvider>
      </StrictMode>,
    );
    const state = () => screen.getByRole("status").textContent;
    expect(state()).toBe("false/false");
    fireEvent.click(screen.getByText("入力処理を開始"));
    expect(state()).toBe("true/false");
    fireEvent.click(screen.getByText("保存を要求"));
    expect(state()).toBe("true/true");
    expect(save).not.toHaveBeenCalled();
    await act(async () => input.resolve());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(state()).toBe("false/true");
    await act(async () => saving.resolve());
    expect(state()).toBe("false/false");
  });
});

describe("APIエラーを呼び出し側で扱う保存処理", () => {
  // 確認する状況: 保存の期限を超えても元のPromiseがまだ終了しない状態で、再度保存を要求します。
  // 期待する結果: timeoutを1回通知しsignalで中断要求します。元の処理が終わるまではisRunningを保ち、終了後は再実行できます。
  it("保存期限で中断を要求し元の処理終了後にisRunningを解除する", async () => {
    vi.useFakeTimers();
    const saving = deferred<void>();
    const onError = vi.fn();
    const action = vi
      .fn<(context: AfterTasksContext) => Promise<void>>()
      .mockImplementationOnce(() => saving.promise)
      .mockResolvedValue(undefined);
    function Form() {
      const { runAfterTasks, isRunning } = useAfterTasks(action, {
        onError,
        actionTimeoutMs: 10,
      });
      return (
        <>
          <button onClick={runAfterTasks}>保存</button>
          <output>{isRunning ? "isRunning" : "idle"}</output>
        </>
      );
    }
    render(
      <AfterTasksProvider>
        <Form />
      </AfterTasksProvider>,
    );
    fireEvent.click(screen.getByText("保存"));
    await flush();
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "timeout" }),
    );
    expect(action.mock.calls[0][0].signal.aborted).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("isRunning");
    fireEvent.click(screen.getByText("保存"));
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => saving.resolve());
    expect(screen.getByRole("status").textContent).toBe("idle");
    fireEvent.click(screen.getByText("保存"));
    await flush();
    expect(action).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  // 確認する状況: 保存中のコンポーネントだけを削除し、同じProvider内の別コンポーネントでisRunningを購読します。
  // 期待する結果: signalで中断要求し、元の保存が終了した時点で共有isRunningを解除します。削除済み画面へのエラー通知は行いません。
  it("保存開始後のunmountでも元の処理終了時に共有isRunningを解除する", async () => {
    const saving = deferred<void>();
    const onError = vi.fn();
    const action = vi.fn((_context: AfterTasksContext) => saving.promise);
    function Observer() {
      const { isRunning } = useAfterTasks();
      return <output>{isRunning ? "isRunning" : "idle"}</output>;
    }
    function Form() {
      const { runAfterTasks } = useAfterTasks(action, { onError });
      return <button onClick={runAfterTasks}>保存</button>;
    }
    function Container({ show }: { show: boolean }) {
      return (
        <AfterTasksProvider>
          <Observer />
          {show && <Form />}
        </AfterTasksProvider>
      );
    }
    const view = render(<Container show />);
    fireEvent.click(screen.getByText("保存"));
    await flush();
    view.rerender(<Container show={false} />);
    expect(action.mock.calls[0][0].signal.aborted).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("isRunning");
    await act(async () => saving.resolve());
    expect(screen.getByRole("status").textContent).toBe("idle");
    expect(onError).not.toHaveBeenCalled();
  });

  // 確認する状況: action内のAPI呼び出しが失敗し、API側のcatchで表示等を済ませて正常終了します。
  // 期待する結果: 共通側は同じエラーを再通知せずisRunningを解除し、次の保存要求を受け付けます。
  it("API側で処理済みのエラーを重ねて通知せずisRunningを解除する", async () => {
    const apiError = new Error("API error");
    const api = vi.fn().mockRejectedValue(apiError);
    const handled = vi.fn();
    const onError = vi.fn();
    function Form() {
      const { runAfterTasks, isRunning } = useAfterTasks(
        async () => {
          try {
            await api();
          } catch (error) {
            handled(error);
          }
        },
        { onError },
      );
      return (
        <>
          <button disabled={isRunning} onClick={runAfterTasks}>
            保存
          </button>
          <output>{String(isRunning)}</output>
        </>
      );
    }
    render(
      <AfterTasksProvider>
        <Form />
      </AfterTasksProvider>,
    );
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(handled).toHaveBeenCalledExactlyOnceWith(apiError),
    );
    expect(screen.getByRole("status").textContent).toBe("false");
    expect(onError).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(onError).not.toHaveBeenCalled();
  });
});

// 確認する状況: 多数の入力が購読している状態で、pending件数だけが増減します。
// 期待する結果: trueのままの通知では再描画せず、最後の完了ではfalseを表示します。
it("公開状態が同じタスク増減では購読コンポーネントを再描画しない", async () => {
  const renders = vi.fn();
  let store!: ReturnType<typeof createAfterTasksStore>;
  function View() {
    store = useAfterTasks();
    renders();
    return <span>{String(store.hasPendingTasks)}</span>;
  }
  render(
    <AfterTasksProvider>
      <View />
    </AfterTasksProvider>,
  );
  const a = deferred<void>();
  const b = deferred<void>();
  act(() => {
    store.registerAsyncTask(() => a.promise);
  });
  const count = renders.mock.calls.length;
  act(() => {
    store.registerAsyncTask(() => b.promise);
  });
  expect(renders).toHaveBeenCalledTimes(count);
  await act(async () => {
    a.resolve();
  });
  expect(renders).toHaveBeenCalledTimes(count);
  await act(async () => {
    b.resolve();
  });
  expect(screen.getByText("false")).toBeTruthy();
});

// 確認する状況: state変更後にも同じイベント関数を使用します。
// 期待する結果: 関数参照は安定し、保存には変更後のstateが渡ります。
it("runAfterTasksの参照を維持したまま最新stateを保存する", async () => {
  const save = vi.fn();
  const refs: Array<() => void> = [];
  function View() {
    const [value, setValue] = useState(0);
    const { runAfterTasks } = useAfterTasks(
      () => {
        save(value);
      },
      { onError: console.error },
    );
    refs.push(runAfterTasks);
    return <button onClick={() => setValue(1)}>変更</button>;
  }
  render(
    <AfterTasksProvider>
      <View />
    </AfterTasksProvider>,
  );
  fireEvent.click(screen.getByText("変更"));
  expect(refs[refs.length - 1]).toBe(refs[0]);
  act(() => refs[0]());
  await waitFor(() => expect(save).toHaveBeenCalledWith(1));
});

// 確認する状況: 自動UUIDの登録が複数失敗し、個別に解除します。
// 期待する結果: 他の登録の失敗は残り、全件解除後に待機が成功します。
it("キー省略の失敗をハンドル単位で解除できる", async () => {
  const store = createAfterTasksStore();
  const a = store.registerAsyncTask(() => {
    throw new Error("a");
  });
  const b = store.registerAsyncTask(() => {
    throw new Error("b");
  });
  await Promise.all([a.result, b.result]);
  a.clearError();
  await expect(store.wait()).rejects.toThrow();
  b.clearError();
  await expect(store.wait()).resolves.toBeUndefined();
});

// 確認する状況: 同じkeyで再試行も失敗した後、古いハンドルを解除します。
// 期待する結果: 新しい失敗を消さず、新しいハンドルからのみ解除できます。
it("古いハンドルで新しい登録のエラーを解除しない", async () => {
  const store = createAfterTasksStore();
  const fail = () => {
    throw new Error("失敗");
  };
  const a = store.registerAsyncTask(fail, { key: "value" });
  const b = store.registerAsyncTask(fail, { key: "value" });
  await Promise.all([a.result, b.result]);
  a.clearError();
  await expect(store.wait()).rejects.toThrow();
  b.clearError();
  await expect(store.wait()).resolves.toBeUndefined();
});

// 確認する状況: Provider外の入力と保存ボタンが別コンポーネントにあり、
// 別フォームのProvider内にも未完了の入力タスクが残っています。
// 期待する結果: 保存は外側の入力を待ち、その更新後の値を使います。別フォームの完了は待ちません。
it("Providerなしでblurタスクを共有し、Provider内のタスクとは分離する", async () => {
  const input = deferred<string>();
  const other = deferred<void>();
  const save = vi.fn();
  function Input({ commit }: { commit: (value: string) => void }) {
    const { registerAsyncTask } = useAfterTasks();
    return (
      <input
        aria-label="入力"
        onBlur={() =>
          registerAsyncTask(() => input.promise, { onCommit: commit })
        }
      />
    );
  }
  function Save({ value }: { value: string }) {
    const { runAfterTasks } = useAfterTasks(() => save(value), {
      onError: console.error,
    });
    return <button onClick={runAfterTasks}>保存</button>;
  }
  function Other() {
    const { registerAsyncTask } = useAfterTasks();
    return (
      <button onClick={() => registerAsyncTask(() => other.promise)}>
        別フォーム
      </button>
    );
  }
  function Form() {
    const [value, setValue] = useState("変更前");
    return (
      <>
        <Input commit={setValue} />
        <Save value={value} />
        <AfterTasksProvider>
          <Other />
        </AfterTasksProvider>
      </>
    );
  }
  render(<Form />);
  fireEvent.click(screen.getByText("別フォーム"));
  fireEvent.blur(screen.getByLabelText("入力"));
  fireEvent.click(screen.getByText("保存"));
  await flush();
  expect(save).not.toHaveBeenCalled();
  await act(async () => {
    input.resolve("変更後");
  });
  await waitFor(() => expect(save).toHaveBeenCalledWith("変更後"));
  await act(async () => {
    other.resolve();
  });
});

// 確認する状況: AをBで置き換える途中で、Aのabortリスナーが同じキーのCを登録します。
// 期待する結果: Bは開始せず、保存はCだけを待ち、Aが遅れて終了してもCの値だけが反映されます。
it("中断通知中に再登録された最後のタスクだけを待つ", async () => {
  const store = createAfterTasksStore();
  const first = deferred<string>();
  const last = deferred<string>();
  const commit = vi.fn();
  const middle = vi.fn(() => "B");
  const options = { key: "field", onCommit: commit };
  const a = store.registerAsyncTask(({ signal }) => {
    signal.addEventListener("abort", () => {
      store.registerAsyncTask(() => last.promise, options);
    });
    return first.promise;
  }, options);
  const b = store.registerAsyncTask(middle, options);
  expect((await a.result).status).toBe("superseded");
  expect((await b.result).status).toBe("superseded");
  expect(middle).not.toHaveBeenCalled();
  expect(store.hasPendingTasks).toBe(true);
  expect(store.hasPending()).toBe(true);
  const saved = vi.fn();
  const waiting = store.wait().then(saved);
  await flush();
  expect(saved).not.toHaveBeenCalled();
  last.resolve("C");
  await waiting;
  first.resolve("A");
  await flush();
  expect(commit).toHaveBeenCalledExactlyOnceWith("C");
  expect(store.hasPending()).toBe(false);
  expect(store.hasPendingTasks).toBe(false);
});
