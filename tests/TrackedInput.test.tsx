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
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsyncTasksProvider, useAsyncTasks } from "../src/AsyncTasks";
import { TrackedInput } from "../src/TrackedInput";
import { useTaskField } from "../src/useAsyncField";
import { deferred } from "./helpers";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("入力UIの確定・エラー表示・破棄", () => {
  function Form({
    normalize,
    onSave,
  }: {
    normalize: (v: string) => Promise<string>;
    onSave: (v: string) => void;
  }) {
    const [value, setValue] = useState("");
    const field = useTaskField("x");
    const { runAfterTasks, isRunning } = useAsyncTasks(() => onSave(value), {
      onError: () => {},
    });
    return (
      <>
        <TrackedInput
          aria-label="value"
          taskKey="x"
          value={value}
          normalize={normalize}
          onCommit={setValue}
          onChange={(e) => setValue(e.currentTarget.value)}
        />
        <button onClick={runAfterTasks} disabled={isRunning}>
          save
        </button>
        <output>{field.phase}</output>
      </>
    );
  }
  // 確認する状況: TrackedInputを編集し、テスト側からblurを配送せずに保存を要求します。
  // 期待する結果: 共通処理が未確定入力を確定し、正規化完了後の値で保存を1回実行します。
  it("保存要求時に未確定の入力を確定して正規化後の値を保存する", async () => {
    const d = deferred<string>();
    const save = vi.fn();
    render(
      <StrictMode>
        <AsyncTasksProvider>
          <Form normalize={() => d.promise} onSave={save} />
        </AsyncTasksProvider>
      </StrictMode>,
    );
    fireEvent.change(screen.getByLabelText("value"), {
      target: { value: "raw" },
    });
    fireEvent.click(screen.getByText("save"));
    await act(async () => d.resolve("normalized"));
    await waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith("normalized"),
    );
  });
  // 確認する状況: TrackedInputの正規化処理を失敗させ、blurだけを発生させます。
  // 期待する結果: runAfterTasksを呼ばなくてもuseTaskFieldがerrorを通知し、画面へ表示できます。
  it("入力失敗は保存ボタンを押す前に項目状態へ反映する", async () => {
    render(
      <AsyncTasksProvider>
        <Form
          normalize={async () => {
            throw Error("bad");
          }}
          onSave={vi.fn()}
        />
      </AsyncTasksProvider>,
    );
    const input = screen.getByLabelText("value");
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("error"),
    );
  });
  // 確認する状況: StrictMode内の入力で処理を開始し、画面をunmountした後に処理を完了させます。
  // 期待する結果: 削除済み入力のonCommitは呼ばれず、遅い結果による書き込みを防ぎます。
  it("入力とProviderの削除後に返った結果をstateへ反映しない", async () => {
    const d = deferred<string>();
    const commit = vi.fn();
    const view = render(
      <StrictMode>
        <AsyncTasksProvider>
          <TrackedInput
            taskKey="x"
            value=""
            onChange={() => {}}
            normalize={() => d.promise}
            onCommit={commit}
          />
        </AsyncTasksProvider>
      </StrictMode>,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "raw" } });
    fireEvent.blur(screen.getByRole("textbox"));
    view.unmount();
    await act(async () => d.resolve("late"));
    expect(commit).not.toHaveBeenCalled();
  });
});
