import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./browser-tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:4173" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "npm run dev -- --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
