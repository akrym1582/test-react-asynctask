// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, expect, it } from "vitest";
import { AfterTasksProvider, useAfterTasks } from "../../src/AfterTasks";
import { useLatestCommitted } from "../../src/useLatestCommitted";
import { deferred, flush } from "../helpers";

afterEach(cleanup);

function Worker({
  priority,
  work,
}: {
  priority: number;
  work: () => Promise<void> | void;
}) {
  const { registerAsyncTask } = useAfterTasks();
  useEffect(() => {
    const task = registerAsyncTask(work, { priority });
    return task.cancel;
  }, [priority, registerAsyncTask, work]);
  return null;
}

// 兄弟のEffectで同時に登録し、同点の先着順と、高優先度の終了を待つことを確認します。
it("同じストアのEffectを優先度順に1件ずつ実行する", async () => {
  const gate = deferred<void>();
  const order: string[] = [];
  render(
    <AfterTasksProvider>
      <Worker priority={0} work={() => void order.push("low")} />
      <Worker
        priority={10}
        work={async () => {
          order.push("first");
          await gate.promise;
        }}
      />
      <Worker priority={10} work={() => void order.push("second")} />
    </AfterTasksProvider>,
  );
  await flush();
  expect(order).toEqual(["first"]);
  gate.resolve();
  await flush();
  expect(order).toEqual(["first", "second", "low"]);
});

// 実行中に高優先度を追加し、待機中の部品を取り外してから先行処理を失敗させます。
// 実行中の仕事は追い越さず、失敗後は残った高優先度から再開します。
it("追加・取消・失敗の後も待機中の優先度を尊重する", async () => {
  const gate = deferred<void>();
  const order: string[] = [];
  const active = () => {
    order.push("active");
    return gate.promise;
  };
  const low = () => void order.push("low");
  const removed = () => void order.push("removed");
  const high = () => void order.push("high");
  const tree = (updated: boolean) => (
    <AfterTasksProvider>
      <Worker priority={5} work={active} />
      <Worker priority={0} work={low} />
      {updated ? (
        <Worker key="added" priority={20} work={high} />
      ) : (
        <Worker key="removed" priority={1} work={removed} />
      )}
    </AfterTasksProvider>
  );
  const view = render(tree(false));
  await flush();
  view.rerender(tree(true));
  await flush();
  expect(order).toEqual(["active"]);
  gate.reject(new Error("失敗"));
  await flush();
  expect(order).toEqual(["active", "high", "low"]);
});

// 低優先度を先に登録して保存を要求します。最後の登録タスクのstate反映後に1回だけ保存します。
it("優先度順に確定した最新のstateで最後に保存する", async () => {
  const gate = deferred<void>();
  const order: string[] = [];
  function Form() {
    const [value, setValue] = useState("");
    const getValue = useLatestCommitted(value);
    const { registerAsyncTask, runAfterTasks } = useAfterTasks(
      () => {
        order.push("save:" + value);
      },
      { onError: () => order.push("error") },
    );
    useEffect(() => {
      const low = registerAsyncTask(() => getValue() + "-low", {
        priority: 1,
        onCommit: (name) => {
          order.push(name);
          setValue(name);
        },
      });
      const high = registerAsyncTask(
        async () => {
          await gate.promise;
          return "high";
        },
        {
          priority: 10,
          onCommit: (name) => {
            order.push(name);
            setValue((prev) => prev + name);
          },
        },
      );
      return () => {
        low.cancel();
        high.cancel();
      };
    }, [getValue, registerAsyncTask]);
    return <button onClick={runAfterTasks}>保存</button>;
  }
  render(
    <AfterTasksProvider>
      <Form />
    </AfterTasksProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await flush();
  expect(order).toEqual([]);
  gate.resolve();
  await waitFor(() =>
    expect(order).toEqual(["high", "high-low", "save:high-low"]),
  );
});
