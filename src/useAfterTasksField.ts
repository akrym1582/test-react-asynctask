/**
 * 入力の確定と状態表示を行う任意のHook群です。
 * AfterTasks.tsx・useLatestCommitted.tsとこのファイルをコピーすると、通常のinputで利用できます。
 * Contextで直接タスクを登録するだけなら、このファイルは不要です。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  useAfterTasks,
  type AfterTasksStore,
  type AfterTasksTimeout,
  type AfterTasksHandle,
} from "./AfterTasks";
import { useLatestCommitted } from "./useLatestCommitted";

// ブラウザーではDOM反映直後に設定を更新し、SSRではlayout effectの警告を避けます。
const useCommitEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
// SSR用のsnapshotは同じオブジェクトを返し、購読による不要な再レンダーを避けます。
/** 任意の入力管理が公開する状態。dirtyは編集中の未確定値です。 */
export type AfterTasksFieldSnapshot = Readonly<{
  phase: "clean" | "dirty" | "pending" | "error" | "disposed";
  error?: unknown;
}>;
const cleanField: AfterTasksFieldSnapshot = Object.freeze({ phase: "clean" });

/**
 * blur失敗を保存ボタンが押される前から表示するための購読Hookです。
 * 入力そのものは登録しません。useAfterTasksField等が登録したtaskKeyを指定します。
 * @example
 * import { useAfterTasksFieldState } from "./useAfterTasksField";
 * const field = useAfterTasksFieldState("name");
 * return field.phase === "error" ? <span role="alert">入力を確認してください</span> : null;
 */
export function useAfterTasksFieldState(key: string): AfterTasksFieldSnapshot {
  const store = useAfterTasks();
  const fields = createAfterTasksFieldStore(store);
  return useSyncExternalStore(
    store.subscribe,
    () => fields.getFieldSnapshot(key),
    () => cleanField,
  );
}

/** 入力の値、値を確定する処理、その結果をstateへ反映する処理を指定します。 */
export type AfterTasksFieldOptions = {
  /** 同じProvider内の入力ごとに異なる名前を指定します。 */
  taskKey: string;
  value: string;
  /** 通信や計算を行い、確定した文字列を返します。ここではstateを更新しません。 */
  normalize: (
    value: string,
    context: { signal: AbortSignal },
  ) => Promise<string> | string;
  /** 有効な最新の結果だけを同期的に反映します。通常はReactのsetterを渡します。 */
  onCommit: (value: string) => void;
  /** nullは無期限、省略時はProviderの入力タスク期限を使います。 */
  timeoutMs?: AfterTasksTimeout;
  /** 同じvalueのままでも、この値を変更すると再確定します。 */
  resetKey?: unknown;
};

/**
 * 編集時点で古い処理を無効化し、blurまたはrunAfterTasksで最新の入力を確定します。
 * changeはReactのstateを変更しないため、画面のsetterも呼んでください。
 * 初期valueは確定済みです。reset(value)やresetKeyの変更で再確定を要求できます。
 * HookはProviderの子で常に呼びます。入力の表示を切り替える場合は子部品をmount/unmountします。
 * @example
 * import { useAfterTasksField } from "./useAfterTasksField";
 * const nameField = useAfterTasksField({
 *   taskKey: "name", value: name,
 *   normalize: (input, { signal }) => normalizeName(input, { signal }),
 *   onCommit: setName,
 *   timeoutMs: null, // この入力の処理を無期限で待つ
 * });
 * return <input value={name} onChange={event => {
 *   const value = event.currentTarget.value;
 *   nameField.change(value); // 古い結果を、この時点で無効化する
 *   setName(value);          // 入力中の文字列を表示する
 * }} onBlur={nameField.commit} />;
 */
export function useAfterTasksField(options: AfterTasksFieldOptions) {
  const store = useAfterTasks();
  const fields = createAfterTasksFieldStore(store);
  const { taskKey, value, resetKey, timeoutMs } = options;
  if (
    timeoutMs !== undefined &&
    timeoutMs !== null &&
    (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
  )
    throw new RangeError("期限には正の有限値かnullを指定してください");
  const field = useRef<Field | null>(null);
  const getOptions = useLatestCommitted(options);
  useCommitEffect(() => {
    const current = getOptions();
    if (typeof current.value !== "string")
      throw new TypeError("入力にはstringのvalueが必要です");
    const mounted = fields.mountField(taskKey, current.value, getOptions);
    field.current = mounted;
    return () => {
      // 画面から消えた入力の遅い結果が、新しい入力を上書きしないようにします。
      mounted.dispose();
      if (field.current === mounted) field.current = null;
    };
  }, [fields, taskKey, getOptions]);
  useCommitEffect(() => {
    field.current?.sync(value);
  }, [value]);
  const previousReset = useRef(resetKey);
  useCommitEffect(() => {
    if (!Object.is(previousReset.current, resetKey)) {
      previousReset.current = resetKey;
      field.current?.reset(value);
    }
  }, [resetKey, value]);
  // 既に取得したstoreを使い、useAfterTasksを重複して購読しません。
  const snapshot = useSyncExternalStore(
    store.subscribe,
    () => fields.getFieldSnapshot(taskKey),
    () => cleanField,
  );
  const change = useCallback(
    (input: string) => field.current?.change(input),
    [],
  );
  const commit = useCallback(() => field.current?.commit(true), []);
  const reset = useCallback((input: string) => field.current?.reset(input), []);
  return { change, commit, reset, ...snapshot };
}

type FieldConfig = {
  normalize: (
    value: string,
    context: { signal: AbortSignal },
  ) => Promise<string> | string;
  onCommit: (value: string) => void;
  timeoutMs?: AfterTasksTimeout;
};
type Field = {
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
    return field;
  }

  return {
    mountField,
    getFieldSnapshot: (key: string) =>
      fields.get(key)?.snapshot() ?? cleanField,
    resetField: (key: string, value: string) => fields.get(key)?.reset(value),
  };
}
