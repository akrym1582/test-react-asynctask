// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, useLayoutEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AfterTasksProvider, useAfterTasks } from "../../src/AfterTasks";
import { ExampleForm } from "../../src/ExampleForm";

afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function Harness({
  task,
  action,
  onError,
}: {
  task: Promise<string>;
  action: (value: string) => Promise<void> | void;
  onError: (error: unknown) => void;
}) {
  const [value, setValue] = useState("old");
  const { registerAsyncTask, runAfterTasks, isRunning } = useAfterTasks(
    () => action(value),
    { onError },
  );
  return (
    <>
      <button
        onClick={() =>
          registerAsyncTask(() => task, { key: "value", onCommit: setValue })
        }
      >
        blur
      </button>
      <button onClick={runAfterTasks} disabled={isRunning}>
        save
      </button>
      <output>{value}</output>
    </>
  );
}
function setup(task: Promise<string>, action = vi.fn(), onError = vi.fn()) {
  const view = render(
    <StrictMode>
      <AfterTasksProvider>
        <Harness task={task} action={action} onError={onError} />
      </AfterTasksProvider>
    </StrictMode>,
  );
  return { ...view, action, onError };
}

describe("入力待機から保存までの連携", () => {
  // 確認する状況: 入力待機中に保存を連打し、入力の確定と保存の完了を別々に制御します。
  // 期待する結果: 入力確定後にnewで保存を1回実行し、保存中はボタンを無効化して完了後に操作可能へ戻します。
  it("入力完了後の新しいstateで保存を1回だけ行い完了までisRunningを維持する", async () => {
    const input = deferred<string>();
    const saving = deferred<void>();
    const action = vi.fn(() => saving.promise);
    setup(input.promise, action);
    fireEvent.click(screen.getByText("blur"));
    fireEvent.click(screen.getByText("save"));
    fireEvent.click(screen.getByText("save"));
    expect(action).not.toHaveBeenCalled();
    await act(async () => {
      input.resolve("new");
    });
    await waitFor(() => expect(action).toHaveBeenCalledExactlyOnceWith("new"));
    expect((screen.getByText("save") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      saving.resolve();
    });
    await waitFor(() =>
      expect((screen.getByText("save") as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });
  // 確認する状況: 入力処理の未完了中に保存を要求し、その入力処理を失敗させます。
  // 期待する結果: onErrorを1回呼び、保存actionは呼びません。
  it("入力タスクが失敗した場合は保存を開始しない", async () => {
    const task = deferred<string>();
    const { action, onError } = setup(task.promise);
    fireEvent.click(screen.getByText("blur"));
    fireEvent.click(screen.getByText("save"));
    await act(async () => {
      task.reject(new Error("failed"));
    });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(action).not.toHaveBeenCalled();
  });
  // 確認する状況: 入力タスクを待つ保存要求を出し、unmount後にその入力を完了させます。
  // 期待する結果: 完了通知が遅れて届いても、削除済み画面のactionは呼びません。
  it("画面削除後は待機中だった保存を実行しない", async () => {
    const task = deferred<string>();
    const { action, unmount } = setup(task.promise);
    fireEvent.click(screen.getByText("blur"));
    fireEvent.click(screen.getByText("save"));
    unmount();
    await act(async () => {
      task.resolve("new");
    });
    expect(action).not.toHaveBeenCalled();
  });
  // 確認する状況: 保存action自身が通常のErrorで失敗する状況を作ります。
  // 期待する結果: onErrorへ1回通知し、保存ボタンを再び操作可能にします。
  it("保存処理の失敗を通知してisRunningを解除する", async () => {
    const action = vi.fn(async () => {
      throw new Error("save failed");
    });
    const { onError } = setup(Promise.resolve("unused"), action);
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect((screen.getByText("save") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
  // 確認する状況: 氏名を編集してフォーカスを残したままsubmitし、正規化処理を後から完了させます。
  // 期待する結果: 正規化前は保存せず、確定済み氏名と住所を1回だけ保存します。requestIdとsignalも保存処理へ渡します。
  it("入力にフォーカスが残ったフォーム送信でも確定後の値を保存する", async () => {
    const task = deferred<string>();
    const save = vi.fn(async () => {});
    render(
      <StrictMode>
        <ExampleForm
          normalizeName={() => task.promise}
          normalizeAddress={async (value) => value}
          save={save}
        />
      </StrictMode>,
    );
    const input = screen.getByLabelText("氏名");
    fireEvent.change(input, { target: { value: " raw " } });
    input.focus();
    fireEvent.submit(input.closest("form")!);
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      task.resolve("normalized");
    });
    await waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith(
        { name: "normalized", address: "" },
        expect.objectContaining({
          requestId: expect.any(String),
          signal: expect.any(AbortSignal),
        }),
      ),
    );
  });
});

describe("追加タスク・重複要求・Provider間の独立性", () => {
  // 確認する状況: 最初の入力が確定したlayout effectで、別の入力タスクを追加します。
  // 期待する結果: 最初の完了だけで保存を開始せず、追加タスクの完了後にsecondの値で保存します。
  it("再レンダー中に追加されたタスクも保存開始前に待ち直す", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const action = vi.fn();
    function Form() {
      const store = useAfterTasks();
      const [value, setValue] = useState("old");
      const added = useRef(false);
      const { runAfterTasks, isRunning } = useAfterTasks(
        () => {
          action(value);
        },
        {
          onError: (error) => {
            throw error;
          },
        },
      );
      useLayoutEffect(() => {
        if (value === "first" && !added.current) {
          added.current = true;
          store.registerAsyncTask(() => second.promise, {
            key: "second",
            onCommit: setValue,
          });
        }
      }, [value, store]);
      return (
        <button
          disabled={isRunning}
          onClick={() => {
            store.registerAsyncTask(() => first.promise, {
              key: "first",
              onCommit: setValue,
            });
            runAfterTasks();
          }}
        >
          execute
        </button>
      );
    }
    render(
      <StrictMode>
        <AfterTasksProvider>
          <Form />
        </AfterTasksProvider>
      </StrictMode>,
    );
    fireEvent.click(screen.getByText("execute"));
    await act(async () => {
      first.resolve("first");
    });
    expect(action).not.toHaveBeenCalled();
    await act(async () => {
      second.resolve("second");
    });
    await waitFor(() =>
      expect(action).toHaveBeenCalledExactlyOnceWith("second"),
    );
  });

  // 確認する状況: 同じイベント内で2つのHookのrunAfterTasksを連続して呼びます。
  // 期待する結果: 先に受け付けたactionだけを開始し、後のactionは実行しません。
  it("同じProviderの別Hookから同時に要求しても保存を1つに制限する", async () => {
    const saving = deferred<void>();
    const first = vi.fn(() => saving.promise);
    const second = vi.fn();
    function Form() {
      const a = useAfterTasks(first, { onError: vi.fn() });
      const b = useAfterTasks(second, { onError: vi.fn() });
      return (
        <button
          onClick={() => {
            a.runAfterTasks();
            b.runAfterTasks();
          }}
        >
          both
        </button>
      );
    }
    render(
      <AfterTasksProvider>
        <Form />
      </AfterTasksProvider>,
    );
    fireEvent.click(screen.getByText("both"));
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    expect(second).not.toHaveBeenCalled();
    await act(async () => saving.resolve());
  });

  // 確認する状況: 保存準備のbeforeWaitが例外を投げる状態でrunAfterTasksを実行します。
  // 期待する結果: 同じ例外をonErrorへ1回通知し、actionを呼ばずボタンを操作可能に戻します。
  it("beforeWaitの同期例外で保存を始めず要求を解除する", async () => {
    const action = vi.fn();
    const onError = vi.fn();
    const error = new Error("before");
    function Form() {
      const { runAfterTasks, isRunning } = useAfterTasks(action, {
        onError,
        beforeWait: () => {
          throw error;
        },
      });
      return (
        <button onClick={runAfterTasks} disabled={isRunning}>
          execute
        </button>
      );
    }
    render(
      <AfterTasksProvider>
        <Form />
      </AfterTasksProvider>,
    );
    fireEvent.click(screen.getByText("execute"));
    await waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith(error));
    expect(action).not.toHaveBeenCalled();
    expect((screen.getByText("execute") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  // 確認する状況: Providerを2つ並べ、片方を入力待機中にしたまま、もう片方でも保存を要求します。
  // 期待する結果: 待機中の側では保存が始まらず、別Provider側ではその待機に影響されず保存を開始できます。
  it("異なるProviderの待機や保存を互いに干渉させない", async () => {
    const neverUntilReleased = deferred<string>();
    const first = vi.fn();
    const second = vi.fn();
    render(
      <>
        <AfterTasksProvider>
          <Harness
            task={neverUntilReleased.promise}
            action={first}
            onError={vi.fn()}
          />
        </AfterTasksProvider>
        <AfterTasksProvider>
          <Harness
            task={Promise.resolve("second")}
            action={second}
            onError={vi.fn()}
          />
        </AfterTasksProvider>
      </>,
    );
    fireEvent.click(screen.getAllByText("blur")[0]!);
    fireEvent.click(screen.getAllByText("save")[0]!);
    fireEvent.click(screen.getAllByText("save")[1]!);
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
    await act(async () => neverUntilReleased.resolve("first"));
    await waitFor(() => expect(first).toHaveBeenCalledExactlyOnceWith("first"));
  });
});
