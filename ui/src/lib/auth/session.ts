/**
 * Console session helpers (WP-3.4). The server holds identity in the HttpOnly
 * kc_session cookie; nothing about the user is kept in localStorage.
 */
import { sessionAuthTransport, setCsrfToken } from '../api/client';

export interface SessionUser {
  id: string;
  email?: string;
  tier?: string;
  role?: string;
  /** Linked sign-in providers from user_identities, e.g. ["google", "github"]. */
  providers?: string[];
  github_id?: string | null;
  github_username?: string | null;
  /** null until GitHub linking runs the Sybil assessment. */
  sybil_score?: number | null;
}

export interface SessionInfo {
  user: SessionUser | null;
  csrfToken?: string;
  notices?: string[];
  rights?: { privatePool: boolean; communityPool: boolean };
  claimable_legacy_accounts?: string[];
}

/** Keys earlier console versions stored; deleted on every load. */
export const LEGACY_STORAGE_KEYS = ['kc_user', 'kc_auth_token'] as const;

export function purgeLegacyStorage(): void {
  try {
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable (private mode); nothing to purge then.
  }
}

export async function fetchSession(): Promise<SessionInfo> {
  const res = await fetch('/api/session', { credentials: 'same-origin' });
  const body = res.ok ? ((await res.json()) as SessionInfo) : { user: null };
  setCsrfToken(body.csrfToken ?? null);
  return { ...body, user: body.user ?? null };
}

/** Exchanges a Firebase ID token; 'consent' means the C1–C3 screen comes next. */
export async function signInWithGoogleToken(idToken: string): Promise<'consent' | 'signed_in'> {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (HTTP ${res.status})`);
  const body = (await res.json()) as { next?: string };
  return body.next === 'consent' ? 'consent' : 'signed_in';
}

export async function submitConsent(): Promise<void> {
  const res = await fetch('/api/auth/consent', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ c1: true, c2: true, c3: true }),
  });
  if (!res.ok) throw new Error(`Consent was not recorded (HTTP ${res.status})`);
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: sessionAuthTransport.getHeaders('POST'),
  });
  setCsrfToken(null);
}
