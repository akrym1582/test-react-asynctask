import {
  createContext, forwardRef, useContext, useEffect, useRef, useState,
  useSyncExternalStore, type ComponentPropsWithoutRef, type FocusEvent,
  type ReactNode,
} from "react";

export function createTaskStore() {
  const pending = new Set<Promise<void>>();
  const failures = new Map<string | symbol, unknown>();
  const versions = new Map<string | symbol, symbol>();
  const listeners = new Set<() => void>();
  let owner: symbol | null = null;
  let taskRevision = 0;

  const notify = () => listeners.forEach((listener) => listener());

  return {
    // 同じkeyの再登録が成功すると、その項目の過去の失敗を解除する。
    register(task: Promise<unknown>, key: string | symbol = Symbol()) {
      taskRevision += 1;
      const version = Symbol();
      versions.set(key, version);
      const tracked = Promise.resolve(task).then(
        () => {
          if (versions.get(key) === version) failures.delete(key);
        },
        (error: unknown) => {
          if (versions.get(key) === version) failures.set(key, error);
        },
      );
      pending.add(tracked);
      void tracked.then(() => {
        pending.delete(tracked);
        if (versions.get(key) === version) versions.delete(key);
      });
    },
    async wait() {
      while (pending.size > 0) await Promise.all([...pending]);
      if (failures.size > 0) {
        throw new AggregateError([...failures.values()], "入力処理に失敗しました");
      }
    },
    hasPending: () => pending.size > 0,
    getRevision: () => taskRevision,
    assertSuccess() {
      if (failures.size > 0) {
        throw new AggregateError([...failures.values()], "入力処理に失敗しました");
      }
    },
    // 検証済みのリセット時などに明示的に利用。保存のたびに消さない。
    clearErrors: () => failures.clear(),
    tryAcquire() {
      if (owner !== null) return null;
      const token = Symbol();
      owner = token;
      notify();
      return () => {
        if (owner !== token) return;
        owner = null;
        notify();
      };
    },
    getBusy: () => owner !== null,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type TaskStore = ReturnType<typeof createTaskStore>;


const Context = createContext<TaskStore | null>(null);

export function AsyncTasksProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createTaskStore);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useAsyncTasks() {
  const store = useContext(Context);
  if (!store) throw new Error("AsyncTasksProviderが必要です");
  return store;
}


export type AfterTasksOptions = {
  onError: (error: unknown) => void;
  /** 同期処理のみ。必要なら対象フォーム内の要素をblurする。 */
  beforeWait?: () => void;
};
type Request = {
  phase: "waiting" | "ready" | "executing";
  release: () => void;
  failure?: { error: unknown };
  renderRevision?: number;
  taskRevision?: number;
};
const getServerSnapshot = () => false;

/** runはイベント用のvoid関数。保存完了をawaitするAPIではありません。 */
export function useAfterTasks(
  action: () => void | Promise<void>,
  { onError, beforeWait }: AfterTasksOptions,
): { run: () => void; busy: boolean } {
  const store = useAsyncTasks();
  const busy = useSyncExternalStore(store.subscribe, store.getBusy, getServerSnapshot);
  const request = useRef<Request | null>(null);
  const nextRevision = useRef(0);
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
      current.taskRevision = store.getRevision();
      current.renderRevision = ++nextRevision.current;
      setRevision(current.renderRevision);
    })();
  }

  useEffect(() => {
    const current = request.current;
    if (!current || current.phase !== "ready" || current.renderRevision !== revision) return;

    // 待機完了からcommitまでの間に追加されたタスクも拾う。
    if (!current.failure && (
      store.hasPending() || current.taskRevision !== store.getRevision()
    )) {
      current.phase = "waiting";
      void (async () => {
        try {
          await store.wait();
        } catch (error) {
          current.failure = { error };
        }
        if (request.current !== current) return;
        current.phase = "ready";
        current.taskRevision = store.getRevision();
        current.renderRevision = ++nextRevision.current;
        setRevision(current.renderRevision);
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


export type TrackedInputProps = Omit<ComponentPropsWithoutRef<"input">, "onBlur"> & {
  taskKey: string;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void | Promise<void>;
};

/** 任意の共通Inputに同じ処理を組み込めます。 */
export const TrackedInput = forwardRef<HTMLInputElement, TrackedInputProps>(
  function TrackedInput({ taskKey, onBlur, ...props }, ref) {
    const { register } = useAsyncTasks();
    return <input {...props} ref={ref} onBlur={(event) => {
      // currentTargetが有効なイベント配送中に、ハンドラーを呼び始める。
      try {
        register(Promise.resolve(onBlur?.(event)), taskKey);
      } catch (error) {
        register(Promise.reject(error), taskKey);
      }
    }} />;
  },
);
