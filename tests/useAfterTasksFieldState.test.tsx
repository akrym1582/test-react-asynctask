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
import { AfterTasksProvider } from "../src/AfterTasks";
import { useAfterTasksField } from "../src/useAfterTasksField";
import { useAfterTasksFieldState } from "../src/useAfterTasksFieldState";
afterEach(cleanup);
function Input() {
  const [value, setValue] = useState("");
  const field = useAfterTasksField({
    taskKey: "x",
    value,
    normalize: async () => {
      throw Error("bad");
    },
    onCommit: setValue,
  });
  return (
    <input
      aria-label="value"
      value={value}
      onChange={(e) => {
        field.change(e.target.value);
        setValue(e.target.value);
      }}
      onBlur={field.commit}
    />
  );
}
function Status() {
  const field = useAfterTasksFieldState("x");
  return <output>{field.phase}</output>;
}
// 確認する状況: 入力と別のコンポーネントで同じkeyの状態を購読し、blurの正規化を失敗させます。
// 期待する結果: 初期cleanからdirtyへ変化し、保存を押さずにerrorを表示します。
it("別コンポーネントから入力状態とblur失敗を購読する", async () => {
  render(
    <AfterTasksProvider>
      <Input />
      <Status />
    </AfterTasksProvider>,
  );
  expect(screen.getByRole("status").textContent).toBe("clean");
  fireEvent.change(screen.getByLabelText("value"), {
    target: { value: "bad" },
  });
  expect(screen.getByRole("status").textContent).toBe("dirty");
  fireEvent.blur(screen.getByLabelText("value"));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("error"),
  );
});
