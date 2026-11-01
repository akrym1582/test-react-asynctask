import { expect, test } from "@playwright/test";

for (const automatic of [false, true]) {
  // 確認する状況: タスク登録なしの同期blurで空白除去・大文字化してsetStateし、保存ボタンを実クリックします。
  // falseは自然なblurに続く通常のonClick、trueは自然なblurを防いでrunAfterTasksの自動blurを使います。
  // 期待する結果: blur前の値は未整形で、blur後の最新stateでALICEを1回保存します。イベント合成や待機を挟んだ別操作で代用しません。
  test(`同期blur後の最新stateを保存する（自動blur=${automatic}）`, async ({
    page,
  }) => {
    await page.goto(
      `/browser-tests/fixtures/synchronous-blur.html${automatic ? "?automatic" : ""}`,
    );
    const input = page.getByLabel("同期入力");
    await input.pressSequentially(" alice ");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(" alice ");
    await expect(page.getByTestId("events")).toHaveText("[]");
    await expect(page.getByTestId("saved")).toBeEmpty();

    // blurとclickの間でテスト側が待たないよう、実クリックを1回だけ行います。
    await page.getByRole("button", { name: "保存", exact: true }).click();

    await expect(input).toHaveValue("ALICE");
    await expect(page.getByTestId("saved")).toHaveText("ALICE");
    await expect(page.getByTestId("events")).toHaveText(
      JSON.stringify(["blur:ALICE", "save:ALICE"]),
    );
  });
}
