import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * `Authorization: Bearer <supabase jwt>` — the native client's only way in.
 *
 * The web app authenticates from Supabase's SSR cookies. A phone has no cookie
 * jar: it holds an access token and must present it on every request. This is
 * that path, and it is deliberately the smallest surface that can do the job.
 */

export interface BearerUser {
  id: string;
  email: string;
}

/**
 * One space, one token, nothing else.
 *
 * Strictness is the point. `"Bearer a b"` is two tokens and we have no idea
 * which the caller meant; a header with surrounding whitespace is a client bug
 * that would otherwise be papered over here and resurface as a signature
 * failure upstream. Anything ambiguous is rejected rather than guessed at, and
 * the scheme word is matched case-insensitively because RFC 7235 says it is.
 */
const BEARER = /^bearer (\S+)$/i;

export function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const match = BEARER.exec(header);
  return match ? match[1] : null;
}

export type BearerVerifier = (token: string) => Promise<BearerUser | null>;

/**
 * One client, reused.
 *
 * Safe to share because `persistSession: false` means it holds no session of
 * its own — the token is passed explicitly to `getUser(token)`, so two
 * concurrent requests for two different users cannot read each other's state.
 * Built lazily so importing this module never requires the env vars; only
 * actually verifying a token does.
 */
let client: SupabaseClient | null = null;

function verifierClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are not set — cannot verify a bearer token.");
    }
    client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

/**
 * Ask Supabase who this token belongs to.
 *
 * `auth.getUser(token)` validates the signature and the expiry server-side.
 * Decoding the JWT here and trusting its `sub` would be faster and would also
 * accept any token a caller cared to forge, since nothing in an undecoded
 * payload is authenticated. The anon key is used on purpose: this call needs no
 * privilege beyond "resolve a token", and a service-role key in this path would
 * be a far larger blast radius for no benefit.
 */
const supabaseVerifier: BearerVerifier = async (token) => {
  const { data, error } = await verifierClient().auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
};

let verifier: BearerVerifier = supabaseVerifier;

/**
 * Swap the verifier. Exists so the auth tests never touch the network — the
 * resolution-order rules are the part worth testing, and they are untestable
 * if proving them requires a live GoTrue.
 *
 * Pass null to restore the real one.
 */
export function setVerifier(next: BearerVerifier | null): void {
  verifier = next ?? supabaseVerifier;
}

export async function userFromBearer(token: string): Promise<BearerUser | null> {
  if (!token) return null;
  try {
    return await verifier(token);
  } catch (err) {
    // A verification round trip that threw tells us nothing about who the
    // caller is, so it is not an authenticated request. Failing closed here
    // means a Supabase outage reads as "signed out", never as "signed in as
    // somebody".
    console.error("[auth] bearer verification failed", err);
    return null;
  }
}
