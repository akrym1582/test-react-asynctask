import { useCallback } from "react";
import {
  useAfterTasks,
  useAfterTasksStoreInternal,
  type AfterTasksOptions,
  type AfterTasksStore,
} from "./AfterTasks";

type Job = { priority: number; run: () => Promise<void> };

function createQueue() {
  // Setの走査は登録順。同じ優先度なら先に見つかった仕事を選びます。
  const waiting = new Set<Job>();
  let draining = false;

  async function drain() {
    while (waiting.size > 0) {
      let next: Job | undefined;
      for (const job of waiting) {
        if (!next || job.priority > next.priority) next = job;
      }
      if (!next) break;
      waiting.delete(next);
      await next.run();
    }
    draining = false;
  }

  return function enqueue<T>(
    priority: number,
    signal: AbortSignal,
    work: () => T | Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const job = {
        priority,
        async run() {
          signal.removeEventListener("abort", cancel);
          try {
            resolve(await work());
          } catch (error) {
            reject(error);
          }
        },
      };
      function cancel() {
        waiting.delete(job);
        reject(signal.reason);
      }
      signal.addEventListener("abort", cancel, { once: true });
      waiting.add(job);
      if (!draining) {
        draining = true;
        // 同じEffect処理中の兄弟からの登録も集めてから先頭を選びます。
        queueMicrotask(drain);
      }
    });
  };
}

const queues = new WeakMap<AfterTasksStore, ReturnType<typeof createQueue>>();

/**
 * 同じAfterTasksストアを使う部品間で、優先度が高い順に1件ずつ実行します。
 * タスク期限には順番待ちも含み、nullなら無期限です。
 * @example
 * import { usePriorityTasks } from "./usePriorityTasks";
 * const register = usePriorityTasks();
 * useEffect(() => {
 *   const task = register(({ signal }) => loadProfile(id, signal), {
 *     priority: 10, onCommit: setProfile,
 *   });
 *   return task.cancel;
 * }, [id, register]);
 */
export function usePriorityTasks() {
  const store = useAfterTasksStoreInternal();
  const { registerAsyncTask } = useAfterTasks();

  return useCallback(
    <T>(
      factory: (context: { signal: AbortSignal }) => T | Promise<T>,
      options: AfterTasksOptions<T> & { priority?: number } = {},
    ) => {
      const { priority = 0, ...taskOptions } = options;
      if (!Number.isFinite(priority))
        throw new RangeError("優先度には有限の数値を指定してください");
      let enqueue = queues.get(store);
      if (!enqueue) {
        enqueue = createQueue();
        queues.set(store, enqueue);
      }
      // 先にAfterTasksへ登録すると、順番待ち中の仕事も保存の待機対象になります。
      const schedule = enqueue;
      return registerAsyncTask(
        (context) => schedule(priority, context.signal, () => factory(context)),
        taskOptions,
      );
    },
    [registerAsyncTask, store],
  );
}
