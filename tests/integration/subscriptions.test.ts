import { expect, it, vi } from "vitest";
import { createAfterTasksStore } from "../../src/AfterTasks";

// 状況: 公開状態が同じまま2件目を登録・取消します。
// 期待: 内部通知は届き、共有状態通知は最初と最後の切替だけです。
it("内部変更と共有snapshotの通知を分離する", () => {
  const store = createAfterTasksStore();
  const internal = vi.fn();
  const shared = vi.fn();
  store.subscribe(internal);
  store.subscribeSnapshot(shared);
  const idle = store.getSnapshot();
  const a = store.registerAsyncTask(() => new Promise(() => {}));
  const pending = store.getSnapshot();
  expect(pending).not.toBe(idle);
  const b = store.registerAsyncTask(() => new Promise(() => {}));
  expect(store.getSnapshot()).toBe(pending);
  b.cancel();
  expect(store.getSnapshot()).toBe(pending);
  expect(shared).toHaveBeenCalledTimes(1);
  expect(internal).toHaveBeenCalledTimes(3);
  a.cancel();
  expect(store.getSnapshot()).toBe(idle);
  expect(shared).toHaveBeenCalledTimes(2);
});
