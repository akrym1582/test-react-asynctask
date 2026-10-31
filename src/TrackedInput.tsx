/**
 * 任意の入力UI部品です。AsyncTasks.tsx、useLatestCommitted.ts、useAsyncField.tsと一緒にコピーします。
 * 通常のinput + useAsyncFieldを使う場合は、このファイルは不要です。
 * UIから入力Hook、入力Hookから中心ファイルへ依存し、逆向きのimportは行いません。
 */
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { useAsyncField, type AsyncFieldOptions } from "./useAsyncField";

/** 文字列の入力専用です。確定処理はnormalize/onCommitで指定します。 */
export type TrackedInputProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "onBlur" | "value" | "type"
> &
  AsyncFieldOptions & {
    type?: "text" | "search" | "email" | "tel" | "url" | "password";
  };

/**
 * normalize（通信/計算）とonCommit（state反映）を分けた入力部品です。
 * 最新の編集の結果だけonCommitへ渡すので、画面側で世代番号を管理する必要がありません。
 * 初期valueは確定済みとして扱います。resetKey変更で同じ値も再確定対象にできます。
 * @example
 * import { TrackedInput } from "./TrackedInput";
 * <TrackedInput taskKey="name" value={name}
 *   onChange={event => setName(event.currentTarget.value)}
 *   normalize={(input, { signal }) => normalizeName(input, { signal })}
 *   onCommit={setName} />
 */
export const TrackedInput = forwardRef<HTMLInputElement, TrackedInputProps>(
  function TrackedInput(props, ref) {
    const {
      taskKey,
      normalize,
      onCommit,
      timeoutMs,
      resetKey,
      onChange,
      ...input
    } = props;
    const field = useAsyncField({
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
          field.change(event.currentTarget.value);
          onChange?.(event);
        }}
        onBlur={field.commit}
      />
    );
  },
);
