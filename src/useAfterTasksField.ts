/**
 * 入力の編集・確定をReactへ接続する任意Hookです。
 * AfterTasks.tsx・afterTasksFieldStore.ts・useLatestCommitted.tsとこのファイルをコピーすると、通常のinputで利用できます。
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
  useAfterTasksStoreInternal,
  type AfterTasksTimeout,
} from "./AfterTasks";
import {
  createAfterTasksFieldStore,
  cleanField,
  type Field,
} from "./afterTasksFieldStore";
export type { AfterTasksFieldSnapshot } from "./afterTasksFieldStore";
import { useLatestCommitted } from "./useLatestCommitted";

// ブラウザーではDOM反映直後に設定を更新し、SSRではlayout effectの警告を避けます。
const useCommitEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
// SSR用のsnapshotは同じオブジェクトを返し、購読による不要な再レンダーを避けます。
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
  const store = useAfterTasksStoreInternal();
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
    useCallback(
      (listener: () => void) => fields.subscribe(taskKey, listener),
      [fields, taskKey],
    ),
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
