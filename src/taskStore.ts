export function createTaskStore() {
  const pending = new Set<Promise<void>>();
  const failures = new Map<string | symbol, unknown>();
  const versions = new Map<string | symbol, symbol>();
  const listeners = new Set<() => void>();
  let owner: symbol | null = null;

  const notify = () => listeners.forEach((listener) => listener());

  return {
    // 同じkeyの再登録が成功すると、その項目の過去の失敗を解除する。
    register(task: Promise<unknown>, key: string | symbol = Symbol()) {
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
