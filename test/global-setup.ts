import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    supabaseUrl: string;
    supabasePublishableKey: string;
    supabaseSecretKey: string;
    supabaseDbUrl: string;
    mailpitUrl: string;
  }
}

// Resets the local database to migrations + seed, so every run (including each watch-mode
// rerun) starts clean even if an earlier run was interrupted, then hands the stack's URL
// and keys to the tests.
export default async function setup(project: TestProject) {
  let output: string;
  try {
    output = supabase("status", "-o", "json");
  } catch {
    throw new Error("本機 Supabase 沒有在執行。請先執行 `npm run db:start`。");
  }
  const status = JSON.parse(output.slice(output.indexOf("{")));
  const reset = () => {
    supabase("db", "reset");
    return waitForApi(status.API_URL, status.SECRET_KEY);
  };
  await reset();
  project.onTestsRerun(reset);

  project.provide("supabaseUrl", status.API_URL);
  project.provide("supabasePublishableKey", status.PUBLISHABLE_KEY);
  project.provide("supabaseSecretKey", status.SECRET_KEY);
  project.provide("supabaseDbUrl", status.DB_URL);
  project.provide("mailpitUrl", status.MAILPIT_URL);
}

function supabase(...args: string[]): string {
  return execFileSync("npx", ["supabase", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// After a reset the API reloads its schema cache for a moment and answers
// "Could not query the database for the schema cache"; wait it out so the first test doesn't fail.
async function waitForApi(url: string, key: string) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const response = await fetch(`${url}/rest/v1/conferences?select=id&limit=1`, {
        headers: { apikey: key, authorization: `Bearer ${key}` },
      });
      if (response.ok) return;
    } catch {
      // Not accepting connections yet.
    }
    if (Date.now() > deadline) throw new Error("本機 Supabase 重設後 API 一直沒有回應。");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
