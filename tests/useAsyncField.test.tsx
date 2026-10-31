// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AsyncTasksProvider, useAsyncTasks } from "../src/AsyncTasks";
import { useAsyncField } from "../src/useAsyncField";
import { deferred } from "./helpers";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
// 確認する状況: 期限省略と、Providerの5ms設定を個別nullで上書きする場合を比較し、入力待機と保存で各1時間進めます。
// 期待する結果: 両設定ともエラーなくbusyを維持し、入力確定後に最新値を保存します。保存完了時にidleへ戻り、タイマーも残しません。
it.each([false, true])(
  "既定の無期限と個別null上書きで入力待機・保存の期限を無効化する（上書き=%s）",
  async (override) => {
    vi.useFakeTimers();
    const normalize = deferred<string>();
    const saving = deferred<void>();
    const error = vi.fn();
    const save = vi.fn((_value: string) => saving.promise);
    function Form() {
      const [value, setValue] = useState("");
      const field = useAsyncField({
        taskKey: "x",
        value,
        normalize: () => normalize.promise,
        timeoutMs: override ? null : undefined,
        onCommit: setValue,
      });
      const { runAfterTasks, busy, isResultUnknown } = useAsyncTasks(
        () => save(value),
        {
          onError: error,
          waitTimeoutMs: override ? null : undefined,
          actionTimeoutMs: override ? null : undefined,
        },
      );
      return (
        <>
          <input
            value={value}
            onChange={(e) => {
              field.change(e.currentTarget.value);
              setValue(e.currentTarget.value);
            }}
            onBlur={field.commit}
          />
          <button onClick={runAfterTasks}>save</button>
          <output>
            {busy ? "busy" : isResultUnknown ? "isResultUnknown" : "idle"}
          </output>
        </>
      );
    }
    render(
      <StrictMode>
        <AsyncTasksProvider
          {...(override
            ? { taskTimeoutMs: 5, waitTimeoutMs: 5, actionTimeoutMs: 5 }
            : {})}
        >
          <Form />
        </AsyncTasksProvider>
      </StrictMode>,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "raw" } });
    fireEvent.click(screen.getByText("save"));
    await act(async () => vi.advanceTimersByTimeAsync(3600000));
    expect(save).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("busy");
    await act(async () => normalize.resolve("normalized"));
    expect(save).toHaveBeenCalledExactlyOnceWith("normalized");
    await act(async () => vi.advanceTimersByTimeAsync(3600000));
    expect(screen.getByRole("status").textContent).toBe("busy");
    expect(error).not.toHaveBeenCalled();
    await act(async () => saving.resolve());
    expect(screen.getByRole("status").textContent).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
  },
);
// 確認する状況: Aの処理を開始してからBへ編集し、Bのblurより先にAの結果を返します。
// 期待する結果: 表示値Bを古い結果で上書きせず、保存要求によるBの確定後に最新結果だけを保存します。
it("通常inputでも次のblur前の再編集で古い結果を無効化する", async () => {
  const old = deferred<string>();
  const current = deferred<string>();
  const saved = vi.fn();
  function Form() {
    const [value, setValue] = useState("");
    const field = useAsyncField({
      taskKey: "x",
      value,
      normalize: (v) => (v === "A" ? old.promise : current.promise),
      onCommit: setValue,
    });
    const { runAfterTasks } = useAsyncTasks(() => saved(value), {
      onError: vi.fn(),
    });
    return (
      <>
        <input
          value={value}
          onChange={(e) => {
            field.change(e.currentTarget.value);
            setValue(e.currentTarget.value);
          }}
          onBlur={field.commit}
        />
        <button onClick={runAfterTasks}>save</button>
      </>
    );
  }
  render(
    <StrictMode>
      <AsyncTasksProvider>
        <Form />
      </AsyncTasksProvider>
    </StrictMode>,
  );
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "A" } });
  fireEvent.blur(input);
  fireEvent.change(input, { target: { value: "B" } });
  await act(async () => old.resolve("obsolete"));
  expect((input as HTMLInputElement).value).toBe("B");
  fireEvent.click(screen.getByText("save"));
  await act(async () => current.resolve("latest"));
  await waitFor(() => expect(saved).toHaveBeenCalledExactlyOnceWith("latest"));
});
