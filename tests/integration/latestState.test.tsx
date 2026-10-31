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
import { AfterTasksProvider, useAfterTasks } from "../../src/AfterTasks";
import { useLatestCommitted } from "../../src/useLatestCommitted";
import { deferred, flush } from "../helpers";
afterEach(cleanup);

// 確認する状況: action内のawait中に画面のstateを変更し、待機解除後にclosureの値とgetterの値を読みます。
// 期待する結果: actionのclosureは開始時のoldを維持し、最新値getterだけが反映済みのnewを返します。
it("保存開始時のstateとawait後の最新値を区別する", async () => {
  const gate = deferred<void>();
  const result = vi.fn();
  function Form() {
    const [value, setValue] = useState("old");
    const get = useLatestCommitted(value);
    const { runAfterTasks } = useAfterTasks(
      async () => {
        await gate.promise;
        result(value, get());
      },
      { onError: vi.fn() },
    );
    return (
      <>
        <button onClick={runAfterTasks}>runAfterTasks</button>
        <button onClick={() => setValue("new")}>edit</button>
      </>
    );
  }
  render(
    <AfterTasksProvider>
      <Form />
    </AfterTasksProvider>,
  );
  fireEvent.click(screen.getByText("runAfterTasks"));
  await flush();
  fireEvent.click(screen.getByText("edit"));
  await act(async () => gate.resolve());
  expect(result).toHaveBeenCalledExactlyOnceWith("old", "new");
});
