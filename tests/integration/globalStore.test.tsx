// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AfterTasksProvider, useAfterTasks } from "../../src/AfterTasks";
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

// 入力元と保存元を順にunmountする。直接登録は残るが古い保存は再開せず、同じkeyの再登録で回復する。
it("画面をまたぐ同一keyの置換と失敗通知を新しい保存要求に対応付ける", async () => {
  const a = form();
  const old = deferred<void>();
  const onCommit = vi.fn();
  let oldSignal!: AbortSignal;
  act(() => {
    oldSignal = a.result.current.registerAsyncTask(() => old.promise, {
      key: "route",
      onCommit,
    }).signal;
  });
  act(a.result.current.runAfterTasks);
  a.unmount();
  const b = form();
  expect(b.result.current.hasPendingTasks).toBe(true);
  expect(b.result.current.isRunning).toBe(false);
  const failure = new Error("invalid");
  act(() => {
    b.result.current.registerAsyncTask(() => Promise.reject(failure), {
      key: "route",
    });
  });
  expect(oldSignal.aborted).toBe(true);
  await act(async () => old.resolve());
  expect(onCommit).not.toHaveBeenCalled();
  expect(b.result.current.hasPendingTasks).toBe(false);
  b.unmount();
  const c = form();
  act(c.result.current.runAfterTasks);
  await flush();
  expect(c.onError).toHaveBeenCalledTimes(1);
  expect(c.onError.mock.calls[0][0]).toBeInstanceOf(AggregateError);
  expect(c.onError.mock.calls[0][0].errors[0].cause).toBe(failure);
  expect(c.action).not.toHaveBeenCalled();
  expect(c.result.current.isRunning).toBe(false);
  expect(a.onError).not.toHaveBeenCalled();
  expect(a.action).not.toHaveBeenCalled();
  await act(async () => {
    c.result.current.registerAsyncTask(() => undefined, { key: "route" });
  });
  act(c.result.current.runAfterTasks);
  await flush();
  expect(c.action).toHaveBeenCalledTimes(1);
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
  const observer = renderHook(() => useAfterTasks());
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
