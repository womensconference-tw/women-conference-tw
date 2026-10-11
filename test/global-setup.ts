import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    supabaseUrl: string;
    supabasePublishableKey: string;
    supabaseSecretKey: string;
  }
}

// Resets the local database to migrations + seed, so every run starts clean even if
// an earlier run was interrupted, then hands the stack's URL and keys to the tests.
export default function setup(project: TestProject) {
  let output: string;
  try {
    output = supabase("status", "-o", "json");
  } catch {
    throw new Error("本機 Supabase 沒有在執行。請先執行 `npm run db:start`。");
  }
  supabase("db", "reset");

  const status = JSON.parse(output.slice(output.indexOf("{")));
  project.provide("supabaseUrl", status.API_URL);
  project.provide("supabasePublishableKey", status.PUBLISHABLE_KEY);
  project.provide("supabaseSecretKey", status.SECRET_KEY);
}

function supabase(...args: string[]): string {
  return execFileSync("npx", ["supabase", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
