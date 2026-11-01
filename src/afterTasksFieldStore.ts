/** 入力の世代・dirty/pending・key別購読を管理する任意部品の内部storeです。 */
import type {
  AfterTasksStore,
  AfterTasksTimeout,
  AfterTasksHandle,
} from "./AfterTasks";

/** 任意の入力管理が公開する状態。dirtyは編集中の未確定値です。 */
export type AfterTasksFieldSnapshot = Readonly<{
  phase: "clean" | "dirty" | "pending" | "error" | "disposed";
  error?: unknown;
}>;
export const cleanField: AfterTasksFieldSnapshot = Object.freeze({
  phase: "clean",
});

type FieldConfig = {
  normalize: (
    value: string,
    context: { signal: AbortSignal },
  ) => Promise<string> | string;
  onCommit: (value: string) => void;
  timeoutMs?: AfterTasksTimeout;
};
export type Field = {
  change: (value: string) => void;
  reset: (value: string) => void;
  sync: (value: string) => void;
  commit: (retry?: boolean) => void;
  dispose: () => void;
  snapshot: () => AfterTasksFieldSnapshot;
};

type FieldStore = ReturnType<typeof makeFieldStore>;
const stores = new WeakMap<AfterTasksStore, FieldStore>();
/**
 * @internal 同じProvider内の入力Hookが共有する、任意の入力管理本体です。
 * storeの作成だけではcoreを変更しません。mountFieldはcommit後のEffectから呼びます。
 */
export function createAfterTasksFieldStore(store: AfterTasksStore): FieldStore {
  let manager = stores.get(store);
  if (!manager) {
    manager = makeFieldStore(store);
    stores.set(store, manager);
  }
  return manager;
}
function synchronousCommit(result: unknown) {
  if (result && typeof (result as PromiseLike<unknown>).then === "function") {
    void Promise.resolve(result).catch(() => {});
    throw new TypeError("onCommitは同期関数で指定してください");
  }
}
function makeFieldStore(store: AfterTasksStore) {
  const fields = new Map<string, Field>();
  const listeners = new Map<string, Set<() => void>>();
  const notifyField = (key: string) => {
    for (const listener of [...(listeners.get(key) ?? [])]) listener();
  };
  const dirtyFields = new Set<Field>();
  const pendingFields = new Set<Field>();
  let detach: (() => void) | undefined;
  const participant = {
    prepare: () => {
      for (const field of [...dirtyFields]) field.commit();
    },
    hasPending: () => dirtyFields.size > 0 || pendingFields.size > 0,
    retryFailed: () =>
      fields.forEach((field) => {
        if (field.snapshot().phase === "error") field.commit(true);
      }),
    dispose: () => {
      for (const field of [...fields.values()]) field.dispose();
    },
  };
  /**
   * 入力1個の寿命と世代を管理します。fieldインスタンスが所有者tokenの役割も持ちます。
   * 同じkeyで新しい入力がmountされても、古いcleanupは新しい入力を削除できません。
   */
  function mountField(
    key: string,
    value: string,
    getConfig: () => FieldConfig,
  ): Field {
    if (fields.has(key)) throw new Error(`taskKeyが重複しています: ${key}`);
    let draft = value;
    let generation = 0;
    let alive = true;
    let handle: AfterTasksHandle<string> | undefined;
    let snapshot: AfterTasksFieldSnapshot = cleanField;
    const set = (next: AfterTasksFieldSnapshot) => {
      snapshot = next;
      dirtyFields.delete(field);
      pendingFields.delete(field);
      if (next.phase === "dirty") dirtyFields.add(field);
      if (next.phase === "pending") pendingFields.add(field);
      notifyField(key);
      store.notifyChange();
    };
    const reset = (input: string) => {
      // blur時では遅いため、編集した瞬間に世代を変えます。
      // これにより「Bを入力中なのにAの検索結果が戻って上書きする」ことを防ぎます。
      generation++;
      handle?.cancel();
      handle = undefined;
      draft = input;
      store.clearTaskError(key);
      set({ phase: "dirty" });
    };
    const field: Field = {
      snapshot: () => snapshot,
      change: reset,
      reset,
      sync(input) {
        if (input !== draft) reset(input);
      },
      commit(retry = false) {
        if (
          !alive ||
          snapshot.phase === "pending" ||
          (snapshot.phase !== "dirty" && !(retry && snapshot.phase === "error"))
        )
          return;
        // この確定処理がどの編集に対応するかを記憶します。
        // 待機中に再編集されるとgenerationが変わり、古い結果は破棄されます。
        const ownGeneration = generation;
        const current = getConfig();
        set({ phase: "pending" });
        handle = store.registerAsyncTask(
          (context) => current.normalize(draft, context),
          {
            key,
            timeoutMs: current.timeoutMs,
            onCommit(result) {
              if (!alive || generation !== ownGeneration) return;
              if (typeof result !== "string")
                throw new TypeError("normalizeはstringを返してください");
              synchronousCommit(getConfig().onCommit(result));
              draft = result;
            },
          },
        );
        void handle.result.then((result) => {
          if (!alive || generation !== ownGeneration) return;
          if (result.status === "fulfilled") set(cleanField);
          else if (
            result.status === "cancelled" ||
            result.status === "superseded"
          )
            set({ phase: "dirty" });
          else set({ phase: "error", error: result.error });
        });
      },
      dispose() {
        if (!alive) return;
        alive = false;
        generation++;
        handle?.cancel();
        if (fields.get(key) === field) {
          fields.delete(key);
          store.clearTaskError(key);
        }
        if (!fields.size && detach) {
          const disconnect = detach;
          detach = undefined;
          disconnect();
        }
        set({ phase: "disposed" });
      },
    };
    fields.set(key, field);
    if (!detach) detach = store.registerParticipant(participant);
    else store.notifyChange();
    notifyField(key);
    return field;
  }

  return {
    // 入力の状態はそのkeyを表示する購読者だけへ通知します。
    subscribe(key: string, listener: () => void) {
      let bucket = listeners.get(key);
      if (!bucket) {
        bucket = new Set();
        listeners.set(key, bucket);
      }
      bucket.add(listener);
      return () => {
        bucket.delete(listener);
        if (!bucket.size) listeners.delete(key);
      };
    },
    mountField,
    getFieldSnapshot: (key: string) =>
      fields.get(key)?.snapshot() ?? cleanField,
    resetField: (key: string, value: string) => fields.get(key)?.reset(value),
  };
}
