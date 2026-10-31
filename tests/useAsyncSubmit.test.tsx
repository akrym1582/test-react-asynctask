// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAsyncSubmit } from "../src/useAsyncSubmit";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
// 確認する状況: composition開始から確定までのEnter・submit・keyupを順に送り、別のEnterと保存クリックを試します。
// 期待する結果: 変換確定に伴う送信は抑止し、その後の独立したEnterと明示クリックでのみ保存処理を呼びます。
it("IMEの変換確定Enterでは保存せず別のEnterや明示クリックを許可する", () => {
  const runAfterTasks = vi.fn();
  function Form() {
    return (
      <form {...useAsyncSubmit(runAfterTasks)}>
        <input />
        <button>save</button>
      </form>
    );
  }
  const view = render(<Form />);
  const input = screen.getByRole("textbox");
  const form = view.container.querySelector("form")!;
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  fireEvent.submit(form);
  expect(runAfterTasks).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.submit(form);
  expect(runAfterTasks).not.toHaveBeenCalled();
  fireEvent.keyUp(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.submit(form);
  expect(runAfterTasks).toHaveBeenCalledTimes(1);
  fireEvent.keyUp(input, { key: "Enter" });
  fireEvent.compositionStart(input);
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.submit(form);
  expect(runAfterTasks).toHaveBeenCalledTimes(1);
  fireEvent.pointerDown(screen.getByText("save"));
  fireEvent.submit(form);
  expect(runAfterTasks).toHaveBeenCalledTimes(2);
});
