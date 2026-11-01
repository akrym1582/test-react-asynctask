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
import {
  AfterTasksProvider,
  createAfterTasksStore,
  useAfterTasks,
} from "../src/AfterTasks";
import {
  createAfterTasksFieldStore,
  useAfterTasksFieldState,
  useAfterTasksField,
} from "../src/useAfterTasksField";
import { deferred, never } from "./helpers";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
// 確認する状況: 期限省略と、Providerの5ms設定を個別nullで上書きする場合を比較し、入力待機と保存で各1時間進めます。
// 期待する結果: 両設定ともエラーなくisRunningを維持し、入力確定後に最新値を保存します。保存完了時にidleへ戻り、タイマーも残しません。
it.each([false, true])(
  "既定の無期限と個別null上書きで入力待機・保存の期限を無効化する（上書き=%s）",
  async (override) => {
    vi.useFakeTimers();
    const normalize = deferred<string>();
    const saving = deferred<void>();
    const error = vi.fn();
    const save = vi.fn((_value: string) => saving.promise);
    function Form() {
      const [value, setValue] = useState("");
      const field = useAfterTasksField({
        taskKey: "x",
        value,
        normalize: () => normalize.promise,
        timeoutMs: override ? null : undefined,
        onCommit: setValue,
      });
      const { runAfterTasks, isRunning } = useAfterTasks(() => save(value), {
        onError: error,
        waitTimeoutMs: override ? null : undefined,
        actionTimeoutMs: override ? null : undefined,
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
          <output>{isRunning ? "isRunning" : "idle"}</output>
        </>
      );
    }
    render(
      <StrictMode>
        <AfterTasksProvider
          {...(override
            ? { taskTimeoutMs: 5, waitTimeoutMs: 5, actionTimeoutMs: 5 }
            : {})}
        >
          <Form />
        </AfterTasksProvider>
      </StrictMode>,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "raw" } });
    fireEvent.click(screen.getByText("save"));
    await act(async () => vi.advanceTimersByTimeAsync(3600000));
    expect(save).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("isRunning");
    await act(async () => normalize.resolve("normalized"));
    expect(save).toHaveBeenCalledExactlyOnceWith("normalized");
    await act(async () => vi.advanceTimersByTimeAsync(3600000));
    expect(screen.getByRole("status").textContent).toBe("isRunning");
    expect(error).not.toHaveBeenCalled();
    await act(async () => saving.resolve());
    expect(screen.getByRole("status").textContent).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
  },
);
// 確認する状況: Aの処理を開始してからBへ編集し、Bのblurより先にAの結果を返します。
// 期待する結果: 表示値Bを古い結果で上書きせず、保存要求によるBの確定後に最新結果だけを保存します。
it("通常inputでも次のblur前の再編集で古い結果を無効化する", async () => {
  const old = deferred<string>();
  const current = deferred<string>();
  const saved = vi.fn();
  function Form() {
    const [value, setValue] = useState("");
    const field = useAfterTasksField({
      taskKey: "x",
      value,
      normalize: (v) => (v === "A" ? old.promise : current.promise),
      onCommit: setValue,
    });
    const { runAfterTasks } = useAfterTasks(() => saved(value), {
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
      <AfterTasksProvider>
        <Form />
      </AfterTasksProvider>
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

// 状況: 同じkeyを2箇所で購読し、片方を解除して編集・破棄・再mountします。
// 期待: 他keyへ通知せず、残った購読は再mount後も有効です。
it("入力keyの購読を独立して解除し再mountでも維持する", () => {
  const store = createAfterTasksStore();
  const fields = createAfterTasksFieldStore(store);
  const first = vi.fn();
  const second = vi.fn();
  const other = vi.fn();
  const off = fields.subscribe("a", first);
  fields.subscribe("a", second);
  fields.subscribe("b", other);
  const config = () => ({ normalize: (v: string) => v, onCommit: () => {} });
  const a = fields.mountField("a", "", config);
  first.mockClear();
  second.mockClear();
  off();
  a.change("x");
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
  expect(other).not.toHaveBeenCalled();
  a.dispose();
  const next = fields.mountField("a", "", config);
  second.mockClear();
  next.change("y");
  expect(second).toHaveBeenCalledTimes(1);
  next.dispose();
});

// 確認する状況: Aの確定処理を開始し、次のblurより前にBへ編集してからAの結果を返します。
// 期待する結果: Aをstateへ反映せず、待機がBの確定を開始して最新結果だけを反映します。同じ入力の重複commitも1回にまとめます。
it("再編集時に古い結果を無効化し最新の未確定入力を待機時に確定する", async () => {
  const a = deferred<string>();
  const b = deferred<string>();
  const commit = vi.fn();
  const normalize = vi.fn((v: string) => (v === "A" ? a.promise : b.promise));
  const store = createAfterTasksStore();
  const field = createAfterTasksFieldStore(store).mountField(
    "name",
    "",
    () => ({
      normalize,
      onCommit: commit,
    }),
  );
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
  const store = createAfterTasksStore();
  const commit = vi.fn();
  const field = createAfterTasksFieldStore(store).mountField("x", "", () => ({
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
  const store = createAfterTasksStore();
  let valid = false;
  const a = createAfterTasksFieldStore(store).mountField("a", "", () => ({
    normalize: () => {
      if (!valid) throw Error("a");
      return "ok";
    },
    onCommit: () => {},
  }));
  const b = createAfterTasksFieldStore(store).mountField("b", "", () => ({
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
  const replacement = createAfterTasksFieldStore(store).mountField(
    "a",
    "",
    () => ({
      normalize: (v) => v,
      onCommit: () => {},
    }),
  );
  a.dispose();
  expect(() =>
    createAfterTasksFieldStore(store).mountField("a", "", () => ({
      normalize: (v) => v,
      onCommit: () => {},
    })),
  ).toThrow("重複");
  replacement.dispose();
});

// 確認する状況: 処理中の入力を外部値へ変更し、古い処理を完了させます。新しい入力のonCommitは例外を投げます。
// 期待する結果: 古い結果ではonCommitを呼ばず、新しい入力のstate反映失敗によって待機を失敗させます。
it("外部reset後の古い結果を捨てstate反映時の例外も失敗として扱う", async () => {
  const store = createAfterTasksStore();
  const deferredTask = deferred<string>();
  const commit = vi.fn(() => {
    throw Error("commit");
  });
  const field = createAfterTasksFieldStore(store).mountField("x", "", () => ({
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

// 確認する状況: 入力管理を作成してから入力を登録し、一度失敗した確定処理をclearErrorsで再試行します。
// その後、別の処理を未完了のままProvider相当の管理範囲を破棄します。
// 期待する結果: 管理本体の取得だけではcoreを変更せず、再試行では最新値を反映し、破棄では入力・未完了タスク・待機状態を片付けます。
it("任意の入力管理を待機・再試行・Scope破棄へ接続できる", async () => {
  const store = createAfterTasksStore();
  const release = store.attach();
  const fields = createAfterTasksFieldStore(store);
  expect(createAfterTasksFieldStore(store)).toBe(fields);
  expect(store.getRevision()).toBe(0);
  let valid = false;
  const pending = deferred<string>();
  const commit = vi.fn();
  const field = fields.mountField("name", "", () => ({
    normalize: (value) => {
      if (!valid) throw new Error("invalid");
      return value === "pending" ? pending.promise : value.trim();
    },
    onCommit: commit,
  }));
  field.change(" ok ");
  await expect(store.wait()).rejects.toBeInstanceOf(AggregateError);
  expect(field.snapshot().phase).toBe("error");
  valid = true;
  store.clearErrors();
  await store.wait();
  expect(commit).toHaveBeenCalledExactlyOnceWith("ok");
  field.change("pending");
  field.commit();
  expect(store.hasPendingTasks).toBe(true);
  release();
  await Promise.resolve();
  expect(fields.getFieldSnapshot("name").phase).toBe("clean");
  expect(store.hasPending()).toBe(false);
  expect(store.hasPendingTasks).toBe(false);
  pending.resolve("late");
  await Promise.resolve();
  expect(commit).toHaveBeenCalledTimes(1);
});

function Input() {
  const [value, setValue] = useState("");
  const field = useAfterTasksField({
    taskKey: "x",
    value,
    normalize: async () => {
      throw Error("bad");
    },
    onCommit: setValue,
  });
  return (
    <input
      aria-label="value"
      value={value}
      onChange={(e) => {
        field.change(e.target.value);
        setValue(e.target.value);
      }}
      onBlur={field.commit}
    />
  );
}
function Status() {
  const field = useAfterTasksFieldState("x");
  return <output>{field.phase}</output>;
}
// 確認する状況: 入力と別のコンポーネントで同じkeyの状態を購読し、blurの正規化を失敗させます。
// 期待する結果: 初期cleanからdirtyへ変化し、保存を押さずにerrorを表示します。
it("別コンポーネントから入力状態とblur失敗を購読する", async () => {
  render(
    <AfterTasksProvider>
      <Input />
      <Status />
    </AfterTasksProvider>,
  );
  expect(screen.getByRole("status").textContent).toBe("clean");
  fireEvent.change(screen.getByLabelText("value"), {
    target: { value: "bad" },
  });
  expect(screen.getByRole("status").textContent).toBe("dirty");
  fireEvent.blur(screen.getByLabelText("value"));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("error"),
  );
});
