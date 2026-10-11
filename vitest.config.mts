import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    // Every test file shares the same local Supabase database.
    fileParallelism: false,
  },
});
