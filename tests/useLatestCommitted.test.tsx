// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { Suspense, startTransition, useState } from "react";
import { afterEach, expect, it } from "vitest";
import { useLatestCommitted } from "../src/useLatestCommitted";
import { never } from "./helpers";
afterEach(cleanup);

// 確認する状況: 値を正常に更新した後、次の更新をSuspenseで未確定にします。
// 期待する結果: getterの参照は変わらず、正常更新後は新値を読み、未確定の更新中は直前にcommitされた値を読み続けます。
it("最新値getterは反映済みの値だけを読み未確定レンダーの値を公開しない", async () => {
  let getter!: () => string;
  let set!: (v: string) => void;
  const blocker = never();
  let previous: unknown;
  function Form() {
    const [value, setValue] = useState("old");
    set = setValue;
    const get = useLatestCommitted(value);
    if (previous) expect(get).toBe(previous);
    previous = get;
    getter = get;
    if (value === "suspend") throw blocker;
    return <span>{value}</span>;
  }
  render(
    <Suspense fallback="loading">
      <Form />
    </Suspense>,
  );
  expect(getter()).toBe("old");
  act(() => set("new"));
  expect(getter()).toBe("new");
  act(() => startTransition(() => set("suspend")));
  expect(getter()).toBe("new");
});
