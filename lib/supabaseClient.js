import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL;
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY;

const configErrorMessage =
  "Missing Supabase config. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env, then restart Vite.";

function decodeJwtRole(token) {
  if (!token) {
    return null;
  }

  const [, payload] = token.split(".");
  if (!payload) {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(normalized);
    const claims = JSON.parse(json);
    return claims?.role || null;
  } catch (error) {
    return null;
  }
}

function assertAnonKey(key) {
  const role = decodeJwtRole(key);
  if (role && role !== "anon") {
    throw new Error(
      "Invalid Supabase key for the browser. Use the anon key (role=anon), not the service role key."
    );
  }
}

assertAnonKey(supabaseAnonKey);

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      })
    : null;

function ensureSupabaseConfigured() {
  if (!supabase) {
    throw new Error(configErrorMessage);
  }

  return supabase;
}

export async function getCurrentSession() {
  const client = ensureSupabaseConfigured();
  const { data, error } = await client.auth.getSession();

  if (error) {
    throw new Error(error.message);
  }

  return data.session;
}

export async function redirectIfAuthenticated(redirectTo = "/dashboard") {
  const session = await getCurrentSession();

  if (session) {
    window.location.replace(redirectTo);
    return true;
  }

  return false;
}

export async function requireAuthenticatedSession(redirectTo = "/login") {
  const session = await getCurrentSession();

  if (!session) {
    window.location.replace(redirectTo);
    return null;
  }

  return session;
}

export function getSupabaseConfigError() {
  return supabase ? null : configErrorMessage;
}
