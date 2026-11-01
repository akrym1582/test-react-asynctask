import { expect, it, vi } from "vitest";
import { deferred, never } from "./helpers";
import { createAfterTasksStore } from "../src/AfterTasks";
import { createAfterTasksFieldStore } from "../src/afterTasksFieldStore";

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
