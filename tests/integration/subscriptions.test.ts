import { expect, it, vi } from "vitest";
import { createAfterTasksStore } from "../../src/AfterTasks";
import { createAfterTasksFieldStore } from "../../src/useAfterTasksField";

// 状況: 公開状態が同じまま2件目を登録・取消します。
// 期待: 内部通知は届き、共有状態通知は最初と最後の切替だけです。
it("内部変更と共有snapshotの通知を分離する", () => {
  const store = createAfterTasksStore();
  const internal = vi.fn();
  const shared = vi.fn();
  store.subscribe(internal);
  store.subscribeSnapshot(shared);
  const a = store.registerAsyncTask(() => new Promise(() => {}));
  const b = store.registerAsyncTask(() => new Promise(() => {}));
  b.cancel();
  expect(shared).toHaveBeenCalledTimes(1);
  expect(internal).toHaveBeenCalledTimes(3);
  a.cancel();
  expect(shared).toHaveBeenCalledTimes(2);
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
