import { test, expect } from "@playwright/test";
for (const method of ["click", "enter", "space"] as const) {
  test(`normalized snapshot via ${method}`, async ({ page }) => {
    await page.goto("/");
    const input = page.getByLabel("氏名");
    // 通常のキー入力とIMEの変換入力は、別のケースとして検証します。
    // Firefoxのfill()は内部でcompositionイベントを発生させるため、
    // 直後のEnterが「変換確定」として抑止されます。ここでは1文字ずつ
    // keydown/keyupを送信し、通常入力後の最初のEnterで保存できるか確認します。
    await input.pressSequentially(" alice ");
    await expect(input).toHaveValue(" alice ");
    await expect(page.getByTestId("saved")).toBeEmpty();
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
  // テスト自身が送るcompositionイベントだけでIMEの状態を切り替えます。
  await input.pressSequentially(" bob ");
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
