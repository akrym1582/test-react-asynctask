// @vitest-environment node
import { TrackedInput } from "../src/TrackedInput";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  AsyncTasksProvider,
  useAfterTasks,
  useLatestCommitted,
} from "../src/AsyncTasks";
it("renders on the server without accessing window/document or starting actions", () => {
  const action = vi.fn();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  function Form() {
    const get = useLatestCommitted("server");
    const { busy } = useAfterTasks(action, { onError: vi.fn() });
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
