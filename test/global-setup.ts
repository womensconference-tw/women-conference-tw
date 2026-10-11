import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    supabaseUrl: string;
    supabasePublishableKey: string;
    supabaseSecretKey: string;
  }
}

// Reads the local stack's URL and keys from the Supabase CLI so tests need no env file.
export default function setup(project: TestProject) {
  let output: string;
  try {
    output = execFileSync("npx", ["supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("本機 Supabase 沒有在執行。請先執行 `npm run db:start`。");
  }

  const status = JSON.parse(output.slice(output.indexOf("{")));
  project.provide("supabaseUrl", status.API_URL);
  project.provide("supabasePublishableKey", status.PUBLISHABLE_KEY);
  project.provide("supabaseSecretKey", status.SECRET_KEY);
}
