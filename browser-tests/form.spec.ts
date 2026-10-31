import { test, expect } from "@playwright/test";
for (const method of ["click", "enter", "space"] as const) {
  // 確認する状況: 実ブラウザーで氏名を入力し、クリック・入力欄のEnter・保存ボタンのSpaceの各操作で送信します。
  // 期待する結果: 入力しただけでは保存せず、各操作によって空白除去・大文字化されたALICEと住所を保存します。
  test(`保存操作=${method}で正規化済みの入力値を保存する`, async ({ page }) => {
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
// 確認する状況: 合成compositionイベントとEnterを送り、変換中・確定直後・独立した次のEnterを比較します。
// 期待する結果: 変換中と確定直後は保存せず、次のEnterで正規化済みBOBを保存します。実OSの日本語IMEの検証とは区別します。
test("実ブラウザーでも変換確定Enterと保存Enterを区別する", async ({ page }) => {
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
