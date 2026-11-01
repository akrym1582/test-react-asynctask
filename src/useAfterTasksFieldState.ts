import { useCallback, useSyncExternalStore } from "react";
import { useAfterTasksStoreInternal } from "./AfterTasks";
import {
  createAfterTasksFieldStore,
  type AfterTasksFieldSnapshot,
} from "./useAfterTasksField";

const cleanField: AfterTasksFieldSnapshot = Object.freeze({ phase: "clean" });

/**
 * blur失敗を保存ボタンが押される前から表示するための購読Hookです。
 * 入力そのものは登録しません。useAfterTasksField等が登録したtaskKeyを指定します。
 * @example
 * import { useAfterTasksFieldState } from "./useAfterTasksFieldState";
 * const field = useAfterTasksFieldState("name");
 * return field.phase === "error" ? <span role="alert">入力を確認してください</span> : null;
 */
export function useAfterTasksFieldState(key: string): AfterTasksFieldSnapshot {
  const store = useAfterTasksStoreInternal();
  const fields = createAfterTasksFieldStore(store);
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) => fields.subscribe(key, listener),
      [fields, key],
    ),
    () => fields.getFieldSnapshot(key),
    () => cleanField,
  );
}
