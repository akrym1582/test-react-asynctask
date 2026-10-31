import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAsyncTasks } from "./AsyncTasksContext";

type Options = {
  onError: (error: unknown) => void;
  /** 同期処理のみ。必要なら対象フォーム内の要素をblurする。 */
  beforeWait?: () => void;
};
type Request = {
  phase: "waiting" | "ready" | "executing";
  release: () => void;
  failure?: { error: unknown };
};
const getServerSnapshot = () => false;

/** runはイベント用のvoid関数。保存完了をawaitするAPIではありません。 */
export function useAfterTasks(
  action: () => void | Promise<void>,
  { onError, beforeWait }: Options,
): { run: () => void; busy: boolean } {
  const store = useAsyncTasks();
  const busy = useSyncExternalStore(store.subscribe, store.getBusy, getServerSnapshot);
  const request = useRef<Request | null>(null);
  const [revision, setRevision] = useState(0);

  // アンマウントした画面の予約は実行しない。開始済みの通信は中断しない。
  useEffect(() => () => {
    const current = request.current;
    request.current = null;
    if (current && current.phase !== "executing") current.release();
  }, [store]);

  function run() {
    const release = store.tryAcquire();
    if (!release) return;
    const current: Request = { phase: "waiting", release };
    request.current = current;

    void (async () => {
      try {
        beforeWait?.();
        await store.wait();
      } catch (error) {
        current.failure = { error };
      }
      if (request.current !== current) return;
      current.phase = "ready";
      setRevision((value) => value + 1);
    })();
  }

  useEffect(() => {
    const current = request.current;
    if (!current || current.phase !== "ready") return;

    // 待機完了からcommitまでの間に追加されたタスクも拾う。
    if (!current.failure && store.hasPending()) {
      current.phase = "waiting";
      void (async () => {
        try {
          await store.wait();
        } catch (error) {
          current.failure = { error };
        }
        if (request.current !== current) return;
        current.phase = "ready";
        setRevision((value) => value + 1);
      })();
      return;
    }

    // Effectの再実行やハンドラーの変更による二重実行を防ぐ。
    current.phase = "executing";
    void (async () => {
      try {
        // commitまでに完了した追加タスクの失敗も確認する。
        store.assertSuccess();
        if (current.failure) throw current.failure.error;
        await action();
      } catch (error) {
        if (request.current === current) {
          try { onError(error); } catch (handlerError) { console.error(handlerError); }
        }
      } finally {
        if (request.current === current) request.current = null;
        current.release();
      }
    })();
  }, [revision, action, onError, store]);

  return { run, busy };
}
