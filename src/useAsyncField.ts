/**
 * 入力の確定と状態表示を行う任意のHook群です。
 * AsyncTasks.tsxとこのファイルをコピーすると、通常のinputで利用できます。
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
  useAsyncTasks,
  useLatestCommitted,
  type FieldSnapshot,
  type TaskStore,
  type Timeout,
} from "./AsyncTasks";

// ブラウザーではDOM反映直後に設定を更新し、SSRではlayout effectの警告を避けます。
const useCommitEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
// SSR用のsnapshotは同じオブジェクトを返し、購読による不要な再レンダーを避けます。
const cleanField: FieldSnapshot = Object.freeze({ phase: "clean" });

/**
 * blur失敗を保存ボタンが押される前から表示するための購読Hookです。
 * 入力そのものは登録しません。useAsyncField等が登録したtaskKeyを指定します。
 * @example
 * import { useTaskField } from "./useAsyncField";
 * const field = useTaskField("name");
 * return field.phase === "error" ? <span role="alert">入力を確認してください</span> : null;
 */
export function useTaskField(key: string): FieldSnapshot {
  const store = useAsyncTasks();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getFieldSnapshot(key),
    () => cleanField,
  );
}

/** 入力の値、値を確定する処理、その結果をstateへ反映する処理を指定します。 */
export type AsyncFieldOptions = {
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
  timeoutMs?: Timeout;
  /** 同じvalueのままでも、この値を変更すると再確定します。 */
  resetKey?: unknown;
};

/**
 * 編集時点で古い処理を無効化し、blurまたはrunで最新の入力を確定します。
 * changeはReactのstateを変更しないため、画面のsetterも呼んでください。
 * 初期valueは確定済みです。reset(value)やresetKeyの変更で再確定を要求できます。
 * HookはProviderの子で常に呼びます。入力の表示を切り替える場合は子部品をmount/unmountします。
 * @example
 * import { useAsyncField } from "./useAsyncField";
 * const nameField = useAsyncField({
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
export function useAsyncField(options: AsyncFieldOptions) {
  const store = useAsyncTasks();
  const { taskKey, value, resetKey, timeoutMs } = options;
  if (
    timeoutMs !== undefined &&
    timeoutMs !== null &&
    (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
  )
    throw new RangeError("期限には正の有限値かnullを指定してください");
  // ReturnTypeで、ContextのmountFieldが返す入力管理オブジェクトの型を利用します。
  const field = useRef<ReturnType<TaskStore["mountField"]> | null>(null);
  const getOptions = useLatestCommitted(options);
  useCommitEffect(() => {
    const current = getOptions();
    if (typeof current.value !== "string")
      throw new TypeError("入力にはstringのvalueが必要です");
    const mounted = store.mountField(taskKey, current.value, getOptions);
    field.current = mounted;
    return () => {
      // 画面から消えた入力の遅い結果が、新しい入力を上書きしないようにします。
      mounted.dispose();
      if (field.current === mounted) field.current = null;
    };
  }, [store, taskKey, getOptions]);
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
  const snapshot = useTaskField(taskKey);
  const change = useCallback(
    (input: string) => field.current?.change(input),
    [],
  );
  const commit = useCallback(() => field.current?.commit(true), []);
  const reset = useCallback((input: string) => field.current?.reset(input), []);
  return { change, commit, reset, ...snapshot };
}
