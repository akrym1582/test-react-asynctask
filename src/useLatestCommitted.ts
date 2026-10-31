/** 最新のcommit済み値が必要な画面で追加する、任意のHookです。Reactだけに依存します。 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
const useCommitEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * 最新のcommit済み値を読む安定したgetterを返します。
 * render中にrefを書き換えないため、途中で破棄されたレンダーの値を公開しません。
 * setState直後の値を即座に取得する関数ではありません。
 * @example
 * import { useAsyncTasks } from "./AsyncTasks";
 * import { useLatestCommitted } from "./useLatestCommitted";
 * const getValues = useLatestCommitted(values);
 * const { runAfterTasks } = useAsyncTasks(async () => {
 *   await checkPermission();
 *   await save(getValues()); // checkPermission待機中の編集も含めて読む場合
 * }, { onError: console.error });
 */
export function useLatestCommitted<T>(value: T): () => T {
  const ref = useRef(value);
  useCommitEffect(() => {
    ref.current = value;
  });
  return useCallback(() => ref.current, []);
}
