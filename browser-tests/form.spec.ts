import { test, expect } from "@playwright/test";
for (const method of ["click", "enter", "space"] as const) {
  test(`normalized snapshot via ${method}`, async ({ page }) => {
    await page.goto("/");
    const input = page.getByLabel("氏名");
    await input.fill(" alice ");
    if (method === "click")
      await page.getByRole("button", { name: "保存", exact: true }).click();
    else if (method === "enter") await input.press("Enter");
    else {
      await input.press("Tab");
      await page.getByRole("button", { name: "保存", exact: true }).focus();
      await page.keyboard.press("Space");
    }
    await expect(page.getByTestId("saved")).toHaveText(
      JSON.stringify({ name: "ALICE", address: "" }),
    );
  });
}
test("composition events suppress Enter but allow a separate submission", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByLabel("氏名");
  await input.fill(" bob ");
  await input.dispatchEvent("compositionstart");
  await input.press("Enter");
  await expect(page.getByTestId("saved")).toBeEmpty();
  await input.dispatchEvent("compositionend");
  await input.press("Enter");
  await expect(page.getByTestId("saved")).toBeEmpty();
  await input.press("Enter");
  await expect(page.getByTestId("saved")).toHaveText(
    JSON.stringify({ name: "BOB", address: "" }),
  );
});
