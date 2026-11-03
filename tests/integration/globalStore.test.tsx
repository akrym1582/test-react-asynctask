// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  AfterTasksProvider,
  useAfterTasks,
  useAfterTasksStoreInternal,
} from "../../src/AfterTasks";
import { useAfterTasksField } from "../../src/useAfterTasksField";
import { deferred, flush, never } from "../helpers";

afterEach(cleanup);

function form(isolated = false) {
  const action = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(() => useAfterTasks(action, { onError }), {
    wrapper: isolated ? AfterTasksProvider : undefined,
  });
  return { ...hook, action, onError };
}

// 別rootのAに背景・入力タスクがある。Bは入力だけを待ち、保存のロックは両方に見える。
it("別フォームのblocking入力を待ち、背景処理が続いていても保存する", async () => {
  const a = form();
  const b = form();
  const input = deferred<void>();
  const save = deferred<void>();
  b.action.mockReturnValue(save.promise);
  let cancelBackground!: () => void;
  act(() => {
    cancelBackground = a.result.current.registerAsyncTask(never, {
      blocking: false,
    }).cancel;
    a.result.current.registerAsyncTask(() => input.promise);
  });
  try {
    expect(b.result.current.hasPendingTasks).toBe(true);
    expect(b.result.current.isRunning).toBe(false);
    act(b.result.current.runAfterTasks);
    act(a.result.current.runAfterTasks);
    await flush();
    expect(a.result.current.isRunning).toBe(true);
    expect(b.action).not.toHaveBeenCalled();
    await act(async () => input.resolve());
    expect(b.action).toHaveBeenCalledTimes(1);
    expect(a.action).not.toHaveBeenCalled();
    expect(b.result.current.hasPendingTasks).toBe(true);
    act(cancelBackground);
    expect(a.result.current.hasPendingTasks).toBe(false);
    expect(a.result.current.isRunning).toBe(true);
    await act(async () => save.resolve());
    expect(a.result.current.isRunning).toBe(false);
  } finally {
    act(cancelBackground);
    input.resolve();
    save.resolve();
  }
});

// 異なるrootでBの保存はAの入力だけを待つ。Aを閉じれば保存が進み、Bの背景処理は続く。
it("登録元を閉じると別フォームの保存が進み、別フォームのタスクは残る", async () => {
  const a = renderHook(() => useAfterTasks(), { wrapper: StrictMode });
  const b = form();
  const old = deferred<void>();
  const onCommit = vi.fn();
  const { registerAsyncTask } = a.result.current;
  let signal!: AbortSignal;
  let background!: AbortSignal;
  act(() => {
    signal = registerAsyncTask(() => old.promise, {
      key: "route",
      onCommit,
    }).signal;
    background = b.result.current.registerAsyncTask(never, {
      blocking: false,
    }).signal;
    b.result.current.runAfterTasks();
  });
  await flush();
  expect(b.action).not.toHaveBeenCalled();
  a.unmount();
  expect(signal.aborted).toBe(true);
  await flush();
  expect(b.action).toHaveBeenCalledTimes(1);
  expect(b.result.current.isRunning).toBe(false);
  expect(background.aborted).toBe(false);
  expect(b.result.current.hasPendingTasks).toBe(true);
  const late = vi.fn();
  expect(registerAsyncTask(late).getStatus()).toBe("cancelled");
  expect(late).not.toHaveBeenCalled();
  await act(async () => old.resolve());
  expect(onCommit).not.toHaveBeenCalled();
  b.unmount();
  expect(background.aborted).toBe(true);
});

// Aの失敗をBから観測し、同じkeyでBも失敗する。Aを閉じてもBのエラーは残り、Bを閉じれば保存できる。
it("unmountは同じkeyの新しい登録元の失敗を消さない", async () => {
  const a = form();
  const b = form();
  const save = form();
  const fail = (page: ReturnType<typeof form>, message: string) =>
    act(async () => {
      page.result.current.registerAsyncTask(
        () => Promise.reject(new Error(message)),
        { key: "route" },
      );
    });
  await fail(a, "A");
  act(save.result.current.runAfterTasks);
  await flush();
  expect(save.onError.mock.calls[0][0].errors[0].cause.message).toBe("A");
  await fail(b, "B");
  a.unmount();
  act(save.result.current.runAfterTasks);
  await flush();
  expect(save.onError.mock.calls[1][0].errors[0].cause.message).toBe("B");
  b.unmount();
  act(save.result.current.runAfterTasks);
  await flush();
  expect(save.action).toHaveBeenCalledTimes(1);
  expect(save.onError).toHaveBeenCalledTimes(2);
});

// BがAの固定keyを置き換えた後Aを閉じる。Bは取り消されず、factory内でBを閉じても新たなタスクは残らない。
it("同じkeyの置換と登録中のunmountで現在の所有者だけを取り消す", async () => {
  const a = form();
  const b = form();
  const observer = form();
  let first!: AbortSignal;
  let replacement!: AbortSignal;
  act(() => {
    first = a.result.current.registerAsyncTask(never, { key: "route" }).signal;
    replacement = b.result.current.registerAsyncTask(never, {
      key: "route",
    }).signal;
  });
  expect(first.aborted).toBe(true);
  a.unmount();
  expect(replacement.aborted).toBe(false);
  let during!: AbortSignal;
  act(() => {
    during = b.result.current.registerAsyncTask(() => {
      b.unmount();
      return never();
    }).signal;
  });
  expect(during.aborted).toBe(true);
  expect(replacement.aborted).toBe(true);
  expect(observer.result.current.hasPendingTasks).toBe(false);
  act(observer.result.current.runAfterTasks);
  await flush();
  expect(observer.action).toHaveBeenCalledTimes(1);
});

// StrictModeでeffectが再接続されても登録でき、Providerが残る間に消えた子のタスクだけを取り消す。
it("同じProviderの兄弟は登録元だけをunmountしても独立して後始末できる", () => {
  const a: AbortSignal[] = [];
  const b: AbortSignal[] = [];
  function Input({ signals }: { signals: AbortSignal[] }) {
    const { registerAsyncTask } = useAfterTasks();
    useLayoutEffect(() => {
      signals.push(registerAsyncTask(never).signal);
    }, [registerAsyncTask, signals]);
    return null;
  }
  function Page({ show }: { show: boolean }) {
    return (
      <StrictMode>
        <AfterTasksProvider>
          {show && <Input signals={a} />}
          <Input signals={b} />
        </AfterTasksProvider>
      </StrictMode>
    );
  }
  const view = render(<Page show />);
  expect(a.at(-1)?.aborted).toBe(false);
  expect(b.at(-1)?.aborted).toBe(false);
  view.rerender(<Page show={false} />);
  expect(a.every((signal) => signal.aborted)).toBe(true);
  expect(b.at(-1)?.aborted).toBe(false);
  view.unmount();
  expect(b.every((signal) => signal.aborted)).toBe(true);
});

// 各フォームのProviderで同じkeyを使う。Aのタスク・失敗・保存ロックはBに影響しない。
it("別Providerなら同じkeyで独立して保存できる", async () => {
  const a = form(true);
  const b = form(true);
  const input = deferred<void>();
  let signal!: AbortSignal;
  act(() => {
    signal = a.result.current.registerAsyncTask(() => input.promise, {
      key: "name",
    }).signal;
    a.result.current.runAfterTasks();
  });
  expect(b.result.current.hasPendingTasks).toBe(false);
  expect(b.result.current.isRunning).toBe(false);
  act(() => {
    b.result.current.registerAsyncTask(() => undefined, { key: "name" });
    b.result.current.runAfterTasks();
  });
  await flush();
  expect(signal.aborted).toBe(false);
  expect(b.action).toHaveBeenCalledTimes(1);
  expect(a.action).not.toHaveBeenCalled();
  await act(async () => input.reject(new Error("invalid")));
  expect(a.onError).toHaveBeenCalledTimes(1);
  act(b.result.current.runAfterTasks);
  await flush();
  expect(b.action).toHaveBeenCalledTimes(2);
  expect(b.onError).not.toHaveBeenCalled();
});

// normalizeの開始中に画面を閉じる。次画面への再マウントを繰り返しても、古い入力は保存を待たせない。
it("登録中のunmountでも入力タスクを取り消し、次画面へ持ち越さない", async () => {
  const next = form();
  for (let visit = 0; visit < 2; visit++) {
    const late = deferred<string>();
    const onCommit = vi.fn();
    let signal!: AbortSignal;
    const field = renderHook(() =>
      useAfterTasksField({
        taskKey: "name",
        value: "",
        normalize: (_, context) => {
          signal = context.signal;
          field.unmount();
          return late.promise;
        },
        onCommit,
      }),
    );
    act(() => {
      field.result.current.change("edited");
      field.result.current.commit();
    });
    expect(signal.aborted).toBe(true);
    expect(next.result.current.hasPendingTasks).toBe(false);
    act(next.result.current.runAfterTasks);
    await flush();
    expect(next.action).toHaveBeenCalledTimes(visit + 1);
    await act(async () => late.resolve("old"));
    expect(onCommit).not.toHaveBeenCalled();
  }
});

// 別rootの画面を順に開閉する。各mountが共有storeから受け取った購読解除関数を1回ずつ呼ぶ。
it("画面を閉じるたびにそのrootの状態購読を解除する", () => {
  const observer = renderHook(() => useAfterTasksStoreInternal());
  const store = observer.result.current;
  const subscribe = store.subscribeSnapshot;
  const releases: ReturnType<typeof vi.fn>[] = [];
  const spy = vi.spyOn(store, "subscribeSnapshot").mockImplementation((cb) => {
    const release = vi.fn(subscribe(cb));
    releases.push(release);
    return release;
  });
  try {
    for (let visit = 0; visit < 3; visit++) {
      const page = form();
      expect(releases).toHaveLength(visit + 1);
      page.unmount();
      expect(releases[visit]).toHaveBeenCalledTimes(1);
    }
  } finally {
    spy.mockRestore();
  }
});
