import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { inject } from "vitest";

const auth = { persistSession: false, autoRefreshToken: false };

/** A visitor with no login, as on the public site. */
export function anonClient() {
  return createClient(inject("supabaseUrl"), inject("supabasePublishableKey"), { auth });
}

/** The website server, as in createServiceClient: the only caller allowed to look up, change or cancel registrations. */
export function serverClient() {
  return createClient(inject("supabaseUrl"), inject("supabaseSecretKey"), { auth });
}

/** Bypasses RLS. Only for arranging test fixtures. */
export function adminClient() {
  return createClient(inject("supabaseUrl"), inject("supabaseSecretKey"), { auth });
}

/** A direct database connection, for holding a transaction open mid-way. Call `end()` when done. */
export function databaseClient() {
  return postgres(inject("supabaseDbUrl"), { max: 1, onnotice: () => {} });
}

/** Unwraps a fixture step's result. Fixture steps must never fail silently, or the shared database is left in a bad state. */
export function must<T>(result: { data: T; error: null } | { error: Error }): T {
  if (result.error) throw result.error;
  return (result as { data: T }).data;
}

/** A staff member signed in through a magic link, as after clicking the link in the sign-in email. */
export async function signedInClient(email: string) {
  const link = must(await adminClient().auth.admin.generateLink({ type: "magiclink", email }));
  const client = anonClient();
  must(await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "email" }));
  return client;
}

/** The latest email the local mail catcher received for `to`, or null. */
export async function latestEmailTo(to: string): Promise<{ subject: string; html: string } | null> {
  const url = inject("mailpitUrl");
  const search = await fetch(`${url}/api/v1/search?limit=1&query=${encodeURIComponent(`to:"${to}"`)}`);
  const { messages } = (await search.json()) as { messages: { ID: string; Subject: string }[] };
  if (messages.length === 0) return null;
  const message = await fetch(`${url}/api/v1/message/${messages[0].ID}`);
  const { HTML } = (await message.json()) as { HTML: string };
  return { subject: messages[0].Subject, html: HTML };
}
