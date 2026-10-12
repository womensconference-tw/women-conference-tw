import { createClient } from "@supabase/supabase-js";
import { inject } from "vitest";

const auth = { persistSession: false, autoRefreshToken: false };

/** A visitor with no login, as on the public site. */
export function anonClient() {
  return createClient(inject("supabaseUrl"), inject("supabasePublishableKey"), { auth });
}

/** Bypasses RLS. Only for arranging test fixtures. */
export function adminClient() {
  return createClient(inject("supabaseUrl"), inject("supabaseSecretKey"), { auth });
}

/** Unwraps a fixture step's result. Fixture steps must never fail silently, or the shared database is left in a bad state. */
export function must<T>(result: { data: T; error: null } | { error: Error }): T {
  if (result.error) throw result.error;
  return (result as { data: T }).data;
}
