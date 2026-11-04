/** formのIME・Enter送信を補助する任意のHookです。必要な画面でだけimportします。 */
import { useRef, type FormEvent, type KeyboardEvent } from "react";

/**
 * formにspreadするイベント群。変換確定のEnterで保存しないよう押下サイクルを管理します。
 * preventDefaultはイベント配送中に実行し、イベントオブジェクトを後で使い回しません。
 * 実OSのIMEはブラウザー自動化の合成イベントと異なるため、利用環境でも確認してください。
 * @example
 * import { useAfterTasks } from "./AfterTasks";
 * import { useAfterTasksSubmit } from "./useAfterTasksSubmit";
 * const { runAfterTasks } = useAfterTasks(save, { onError: console.error });
 * const submitEvents = useAfterTasksSubmit(runAfterTasks);
 * return <form {...submitEvents}><input /><button type="submit">保存</button></form>;
 */
export function useAfterTasksSubmit(runAfterTasks: () => void) {
  const ime = useRef({
    composing: false,
    ended: false,
    suppressEnter: false,
    explicit: false,
  });

  return {
    onCompositionStart: () => {
      ime.current.composing = true;
      ime.current.ended = false;
    },

    // 日本語入力の変換確定に使ったEnterを、直後のフォーム送信と区別するために記録します。
    onCompositionEnd: () => {
      ime.current.composing = false;
      ime.current.ended = true;
    },

    onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => {
      const state = ime.current;
      if (event.key === "Enter") {
        const composing =
          state.composing ||
          state.ended ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229;
        state.ended = false;
        state.explicit = false;
        if (composing) {
          state.suppressEnter = true;
          event.preventDefault();
        }
      } else if (event.keyCode === 229) {
        state.suppressEnter = true;
      } else {
        state.ended = false;
      }
    },

    onKeyUp: (event: KeyboardEvent<HTMLFormElement>) => {
      if (event.key === "Enter" || event.keyCode === 229) {
        ime.current.suppressEnter = false;
        ime.current.ended = false;
      }
    },

    onPointerDown: () => {
      ime.current.explicit = true;
      ime.current.suppressEnter = false;
      ime.current.ended = false;
    },

    onSubmit: (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const state = ime.current;
      const allow =
        state.explicit || (!state.composing && !state.suppressEnter);
      state.explicit = false;
      if (allow) runAfterTasks();
    },
  };
}
