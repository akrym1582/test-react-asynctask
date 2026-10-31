// @vitest-environment node
import { TrackedInput } from "../../src/TrackedInput";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  AsyncTasksProvider,
  useAsyncTasks,
  useLatestCommitted,
} from "../../src/AsyncTasks";
// 確認する状況: node環境でProvider・TrackedInput・最新値getter・保存HookをrenderToStringします。
// 期待する結果: serverの文字列を描画でき、保存処理を呼ばずconsole.errorへの警告も発生しません。
it("SSRではDOM参照エラーやEffect警告を出さず保存処理も開始しない", () => {
  const action = vi.fn();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  function Form() {
    const get = useLatestCommitted("server");
    const { busy } = useAsyncTasks(action, { onError: vi.fn() });
    return (
      <>
        <TrackedInput
          taskKey="x"
          value=""
          normalize={(v) => v}
          onCommit={() => {}}
          readOnly
        />
        <span>
          {get()}
          {String(busy)}
        </span>
      </>
    );
  }
  const html = renderToString(
    <AsyncTasksProvider>
      <Form />
    </AsyncTasksProvider>,
  );
  expect(html).toContain("server");
  expect(action).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
  log.mockRestore();
});
