import { createAfterTasksStore } from "../src/AfterTasks";

/** 背景タスクを残してblocking=0の判定を繰り返し、全タスク走査の有無を分離します。 */
export async function measureStore(size: number) {
  const store = createAfterTasksStore();
  const promise = new Promise<void>(() => {});
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  const started = performance.now();
  const handles = Array.from({ length: size }, () =>
    store.registerAsyncTask(() => promise, { blocking: false }),
  );
  const registerMs = performance.now() - started;
  const checkStarted = performance.now();
  let pendingChecks = 0;
  for (let i = 0; i < 10000; i++) if (store.hasPending()) pendingChecks++;
  const checkMs = performance.now() - checkStarted;
  const waitStarted = performance.now();
  await store.wait();
  const waitMs = performance.now() - waitStarted;
  handles.forEach((handle) => handle.cancel());
  unsubscribe();
  return { size, registerMs, checkMs, waitMs, pendingChecks, notifications };
}
