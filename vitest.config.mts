import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // test/setup.ts gives every test a temporary DATA_DIR. Tests that check log lines capture them with logTo() or createLogger(); the rest print nothing.
  test: {
    environment: "node",
    setupFiles: ["test/setup.ts"],
    exclude: ["**/node_modules/**", ".next/**", "packages/**", "e2e/**"],
    env: { NOTEFEED_LOG_LEVEL: "silent" },
  },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
