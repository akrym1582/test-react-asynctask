import { expect, it } from "vitest";
import { createMemorySaveAdapter } from "../src/exampleSaveAdapter";
// 確認する状況: メモリ上のadapterへ同じID・同じデータで2回保存し、そのIDで別データも保存しようとします。
// 期待する結果: 保存件数は1件で結果照会はsavedとなり、同じIDを別データへ流用した要求は失敗します。実サーバーの検証ではありません。
it("同じrequestIdの同一データは二重保存せず異なるデータは拒否する", async () => {
  const adapter = createMemorySaveAdapter<{ name: string }>();
  const context = { signal: new AbortController().signal, requestId: "id" };
  await adapter.save({ name: "x" }, context);
  await adapter.save({ name: "x" }, context);
  expect(adapter.getCount()).toBe(1);
  expect(await adapter.lookup("id")).toBe("saved");
  await expect(adapter.save({ name: "y" }, context)).rejects.toThrow();
});
