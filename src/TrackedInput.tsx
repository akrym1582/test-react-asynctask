import { forwardRef, type ComponentPropsWithoutRef, type FocusEvent } from "react";
import { useAsyncTasks } from "./AsyncTasksContext";

type Props = Omit<ComponentPropsWithoutRef<"input">, "onBlur"> & {
  taskKey: string;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void | Promise<void>;
};

/** 任意の共通Inputに同じ処理を組み込めます。 */
export const TrackedInput = forwardRef<HTMLInputElement, Props>(
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
