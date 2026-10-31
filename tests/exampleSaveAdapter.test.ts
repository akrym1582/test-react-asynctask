import { expect, it } from "vitest";
import { createMemorySaveAdapter } from "../src/exampleSaveAdapter";
it("uses stable requestId with the fake idempotency contract", async () => {
  const adapter = createMemorySaveAdapter<{ name: string }>();
  const context = { signal: new AbortController().signal, requestId: "id" };
  await adapter.save({ name: "x" }, context);
  await adapter.save({ name: "x" }, context);
  expect(adapter.getCount()).toBe(1);
  expect(await adapter.lookup("id")).toBe("saved");
  await expect(adapter.save({ name: "y" }, context)).rejects.toThrow();
});
