/**
 * 任意の入力UI部品です。AfterTasks.tsx、useLatestCommitted.ts、useAfterTasksField.tsと一緒にコピーします。
 * 通常のinput + useAfterTasksFieldを使う場合は、このファイルは不要です。
 * UIから入力Hook、入力Hookから中心ファイルへ依存し、逆向きのimportは行いません。
 */
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import {
  useAfterTasksField,
  type AfterTasksFieldOptions,
} from "./useAfterTasksField";

/** 文字列の入力専用です。確定処理はnormalize/onCommitで指定します。 */
export type AfterTasksInputProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "onBlur" | "value" | "type"
> &
  AfterTasksFieldOptions & {
    type?: "text" | "search" | "email" | "tel" | "url" | "password";
  };

/**
 * normalize（通信/計算）とonCommit（state反映）を分けた入力部品です。
 * 最新の編集の結果だけonCommitへ渡すので、画面側で世代番号を管理する必要がありません。
 * 初期valueは確定済みとして扱います。resetKey変更で同じ値も再確定対象にできます。
 * @example
 * import { AfterTasksInput } from "./AfterTasksInput";
 * <AfterTasksInput taskKey="name" value={name}
 *   onChange={event => setName(event.currentTarget.value)}
 *   normalize={(input, { signal }) => normalizeName(input, { signal })}
 *   onCommit={setName} />
 */
export const AfterTasksInput = forwardRef<
  HTMLInputElement,
  AfterTasksInputProps
>(function AfterTasksInput(props, ref) {
  const {
    taskKey,
    normalize,
    onCommit,
    timeoutMs,
    resetKey,
    onChange,
    ...input
  } = props;

  const field = useAfterTasksField({
    taskKey,
    value: input.value,
    normalize,
    onCommit,
    timeoutMs,
    resetKey,
  });
  return (
    <input
      {...input}
      ref={ref}
      onChange={(event) => {
        // ここで編集を記録し、blurで整形を始めます。親には通常のonChangeも届けます。
        field.change(event.currentTarget.value);
        onChange?.(event);
      }}
      onBlur={field.commit}
    />
  );
});
