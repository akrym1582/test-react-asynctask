// @vitest-environment node
import { useLatestCommitted } from "../../src/useLatestCommitted";
import { AfterTasksInput } from "../../src/AfterTasksInput";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AfterTasksProvider, useAfterTasks } from "../../src/AfterTasks";
// 確認する状況: node環境でProvider・AfterTasksInput・最新値getter・保存HookをrenderToStringします。
// 期待する結果: serverの文字列を描画でき、保存処理を呼ばずconsole.errorへの警告も発生しません。
it("SSRではDOM参照エラーやEffect警告を出さず保存処理も開始しない", () => {
  const action = vi.fn();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  function Form() {
    const get = useLatestCommitted("server");
    const { isRunning } = useAfterTasks(action, { onError: vi.fn() });
    return (
      <>
        <AfterTasksInput
          taskKey="x"
          value=""
          normalize={(v) => v}
          onCommit={() => {}}
          readOnly
        />
        <span>
          {get()}
          {String(isRunning)}
        </span>
      </>
    );
  }
  const html = renderToString(
    <AfterTasksProvider>
      <Form />
    </AfterTasksProvider>,
  );
  expect(html).toContain("server");
  expect(action).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
  log.mockRestore();
});

// 確認する状況: Providerなしの画面を、同じサーバープロセスで2回レンダリングします。
// 期待する結果: 各レンダーで異なるstoreが使われ、別リクエストに状態が引き継がれません。
it("ProviderなしのSSRでリクエスト間のstoreを分離する", () => {
  const observe = vi.fn();
  function Form() {
    observe(useAfterTasks());
    return <span>入力フォーム</span>;
  }
  renderToString(<Form />);
  renderToString(<Form />);
  expect(observe.mock.calls[0][0]).not.toBe(observe.mock.calls[1][0]);
});
