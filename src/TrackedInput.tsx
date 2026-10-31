/**
 * 任意の入力UI部品です。利用時はAsyncTasks.tsxとこのファイルをコピーします。
 * 通常のinput + useAsyncFieldを使う場合は、このファイルは不要です。
 * Context/Hook側からこの部品を参照しないため、依存は一方向です。
 */
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type FocusEvent,
} from "react";
import {
  useAsyncTasks,
  useAsyncField,
  type AsyncFieldOptions,
  type Timeout,
} from "./AsyncTasks";

type InputBase = Omit<ComponentPropsWithoutRef<"input">, "onBlur"> & {
  taskKey: string;
};
/** 旧onBlur形式とmanaged形式は同時指定できません。managed形式は文字列の入力専用です。 */
export type TrackedInputProps = InputBase &
  (
    | {
        normalize?: never;
        onCommit?: never;
        timeoutMs?: never;
        resetKey?: never;
        onBlur?: (event: FocusEvent<HTMLInputElement>) => void | Promise<void>;
      }
    | {
        value: string;
        type?: "text" | "search" | "email" | "tel" | "url" | "password";
        normalize: AsyncFieldOptions["normalize"];
        onCommit: AsyncFieldOptions["onCommit"];
        timeoutMs?: Timeout;
        resetKey?: unknown;
        onBlur?: never;
      }
  );
/**
 * normalize（通信/計算）とonCommit（state反映）を分けた入力部品です。
 * 最新の世代の結果だけonCommitへ渡すので、画面側で世代番号を管理する必要がありません。
 * 初期valueは確定済みとして扱います。resetKey変更で同じ値も再確定対象にできます。
 * @example
 * <TrackedInput taskKey="name" value={name}
 *   onChange={event => setName(event.currentTarget.value)}
 *   normalize={(input, { signal }) => normalizeName(input, { signal })}
 *   onCommit={setName} />
 *
 * @example
 * // 互換形式。完了は待てますが、内部の古いsetStateは共通側から取り消せません。
 * <TrackedInput taskKey="name" onBlur={async event => {
 *   const input = event.currentTarget.value; // awaitより前に取得
 *   await legacyBlur(input);
 * }} />
 */
export const TrackedInput = forwardRef<HTMLInputElement, TrackedInputProps>(
  function TrackedInput(props, ref) {
    const store = useAsyncTasks();
    const {
      taskKey,
      normalize,
      onCommit,
      timeoutMs,
      resetKey,
      onBlur,
      onChange,
      ...input
    } = props;
    const managed = normalize !== undefined;
    const field = useAsyncField(
      managed
        ? {
            taskKey,
            value: input.value as string,
            normalize,
            onCommit: onCommit!,
            timeoutMs,
            resetKey,
          }
        : null,
    );
    return (
      <input
        {...input}
        ref={ref}
        onChange={(event) => {
          field.change(event.currentTarget.value);
          onChange?.(event);
        }}
        onBlur={(event) => {
          if (managed) {
            field.commit();
            return;
          }
          try {
            store.registerAsyncTask(Promise.resolve(onBlur?.(event)), taskKey);
          } catch (error) {
            store.registerAsyncTask(Promise.reject(error), taskKey);
          }
        }}
      />
    );
  },
);
