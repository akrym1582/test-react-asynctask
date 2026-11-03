import { expect, test } from "@playwright/test";

for (const mode of ["sync", "microtask", "timer0", "timer10"]) {
  test(
    mode + " blur followed by ordinary Save click",
    async ({ page, browserName }) => {
      test.setTimeout(120_000);
      await page.goto("/browser-tests/blur-timing.html?mode=" + mode);
      const input = page.getByRole("textbox");
      const button = page.getByRole("button", { name: "Save" });
      const trials = 100;
      let stale = 0;
      for (let i = 1; i <= trials; i++) {
        const raw = "trial-" + i;
        const normalized = raw.toUpperCase();
        await input.fill(raw);
        await button.click();
        await expect(page.getByTestId("blurs")).toHaveText(String(i));
        await expect(page.getByTestId("saved")).toHaveText(
          new RegExp("^trial-" + i + "$", "i"),
        );
        const saved = await page.getByTestId("saved").textContent();
        if (saved === raw) stale++;
        else expect(saved).toBe(normalized);
        // Isolate the next trial from any outstanding normalization.
        await expect(input).toHaveValue(normalized);
      }
      console.log(
        "BLUR_MEASURE",
        JSON.stringify({ browserName, mode, stale, trials }),
      );
    },
  );
}
