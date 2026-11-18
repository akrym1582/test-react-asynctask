// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { AfterTasksProvider, useAfterTasks } from "../../src/AfterTasks";
import { deferred, flush } from "../helpers";

afterEach(cleanup);

// 保存中にキューを無効にした要求と既定の要求を行い、その後から入力タスクを登録します。
// キューを無効にした要求はスキップされ、次の保存は先行保存と入力の完了後に新しい値で実行されます。
it("先行する保存の終了後に入力を待ち最新のstateで保存する", async () => {
  const first = deferred<void>();
  const input = deferred<string>();
  const saved: string[] = [];

  function Form() {
    const [value, setValue] = useState("初期値");
    const { registerAsyncTask, runAfterTasks } = useAfterTasks(
      async (_context, id: number) => {
        saved.push(id + ":" + value);
        if (saved.length === 1) await first.promise;
      },
      { onError: (error) => saved.push(String(error)) },
    );

    return (
      <>
        <button onClick={() => runAfterTasks({ args: [1] })}>保存 1</button>
        <button onClick={() => runAfterTasks({ args: [2] })}>保存 2</button>
        <button
          onClick={() => runAfterTasks({ args: [3], enqueue: false })}
        >
          スキップ
        </button>
        <button
          onClick={() =>
            registerAsyncTask(() => input.promise, { onCommit: setValue })
          }
        >
          更新
        </button>
      </>
    );
  }

  render(
    <AfterTasksProvider>
      <Form />
    </AfterTasksProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "保存 1" }));
  await waitFor(() => expect(saved).toEqual(["1:初期値"]));

  fireEvent.click(screen.getByRole("button", { name: "スキップ" }));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  fireEvent.click(screen.getByRole("button", { name: "更新" }));
  first.resolve();
  await flush();
  expect(saved).toEqual(["1:初期値"]);

  input.resolve("更新値");
  await waitFor(() => expect(saved).toEqual(["1:初期値", "2:更新値"]));
});
