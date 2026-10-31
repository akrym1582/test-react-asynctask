// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AsyncTasksProvider, useAsyncTasks } from "../../src/AsyncTasks";
import { TrackedInput } from "../../src/TrackedInput";
import { deferred } from "../helpers";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
// 確認する状況: TrackedInputの確定が終わらないまま総待機期限10msを超え、その後に元処理を成功させます。
// 期待する結果: エラーを1回通知してisRunningを解除します。遅い結果でも保存は始まらず、表示中の入力値も上書きしません。
it("入力の総待機期限で要求を解除し遅い結果から保存を開始しない", async () => {
  vi.useFakeTimers();
  const task = deferred<string>();
  const save = vi.fn();
  const error = vi.fn();
  function Form() {
    const [value, setValue] = useState("");
    const { runAfterTasks, isRunning } = useAsyncTasks(
      () => {
        save(value);
      },
      { onError: error, waitTimeoutMs: 10 },
    );
    return (
      <>
        <TrackedInput
          taskKey="x"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          normalize={() => task.promise}
          onCommit={setValue}
        />
        <button onClick={runAfterTasks}>runAfterTasks</button>
        <output>{String(isRunning)}</output>
      </>
    );
  }
  render(
    <AsyncTasksProvider taskTimeoutMs={null}>
      <Form />
    </AsyncTasksProvider>,
  );
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "raw" } });
  fireEvent.click(screen.getByText("runAfterTasks"));
  await act(async () => vi.advanceTimersByTimeAsync(10));
  expect(error).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status").textContent).toBe("false");
  await act(async () => task.resolve("late"));
  expect(save).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("raw");
});
