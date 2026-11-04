import { expect, test } from "@playwright/test";

for (const provider of [false, true]) {
  test.describe(provider ? "Provider" : "global store", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(
        "/browser-tests/ownership.html" + (provider ? "?provider" : ""),
      );
    });

    test("leaving releases save, preserves peer work and ignores a late result after remount", async ({
      page,
    }) => {
      const button = (name: string) =>
        page.getByRole("button", { name, exact: true });
      const log = page.getByRole("listitem");
      await button("Start screen-1").click();
      await button("Background screen-1").click();
      await button("Background peer").click();
      await button("Save").click();
      await expect(button("Save")).toBeDisabled();
      await expect(log).toHaveCount(0);
      await button("Leave").click();
      await expect(log).toContainText([
        "abort screen-1",
        "abort screen-1-background",
        "saved",
      ]);
      await expect(button("Save")).toBeEnabled();
      await expect(page.getByTestId("pending")).toHaveText("true");
      await button("Return").click();
      await button("Start screen-2").click();
      await button("Save").click();
      await expect(button("Save")).toBeDisabled();
      await button("Finish screen-1").click();
      await button("Finish screen-1-background").click();
      await button("Finish peer-background").click();
      await expect(log.last()).toHaveText("commit peer-background");
      await expect(button("Save")).toBeDisabled();
      await button("Finish screen-2").click();
      await expect(button("Save")).toBeEnabled();
      await expect(page.getByTestId("pending")).toHaveText("false");
      await expect(log).toHaveText([
        "abort screen-1",
        "abort screen-1-background",
        "saved",
        "returned screen-1",
        "returned screen-1-background",
        "returned peer-background",
        "commit peer-background",
        "returned screen-2",
        "commit screen-2",
        "saved",
      ]);
    });

    test("old owner unmount preserves the replacement that save is waiting for", async ({
      page,
    }) => {
      const click = (name: string) =>
        page.getByRole("button", { name, exact: true }).click();
      const log = page.getByRole("listitem");
      await click("Start screen-1");
      await click("Save");
      await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
      await click("Start peer");
      await expect(log).toHaveText(["abort screen-1"]);
      await click("Leave");
      await click("Finish screen-1");
      await expect(log).toHaveText(["abort screen-1", "returned screen-1"]);
      await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
      await click("Finish peer");
      await expect(log).toHaveText([
        "abort screen-1",
        "returned screen-1",
        "returned peer",
        "commit peer",
        "saved",
      ]);
      await expect(page.getByTestId("pending")).toHaveText("false");
    });

    test("same-key failure survives the old owner's departure and clears when its owner leaves", async ({
      page,
    }) => {
      const click = (name: string) =>
        page.getByRole("button", { name, exact: true }).click();
      const log = page.getByRole("listitem");
      await click("Fail screen-1");
      await click("Save");
      await expect(log).toHaveText(["error Error: screen-1"]);
      await click("Fail peer");
      await click("Leave");
      await click("Save");
      await expect(log).toHaveText([
        "error Error: screen-1",
        "error Error: peer",
      ]);
      await click("Close peer");
      await click("Return");
      await click("Save");
      await expect(log).toHaveText([
        "error Error: screen-1",
        "error Error: peer",
        "saved",
      ]);
    });
  });
}
