/**
 * Public key takedown (QA-16): one request helper for ReportPage and ReportKeyModal, so
 * both show the server's real error code instead of always blaming Turnstile.
 */

export type ReportResult = { ok: true } | { ok: false; code: string; message: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function readError(body: unknown, status: number): { code: string; message: string } {
  const fallback = { code: `http_${status}`, message: `Request failed (HTTP ${status})` };
  if (typeof body !== 'object' || body === null || !('error' in body)) return fallback;
  const error = (body as { error: unknown }).error;
  if (typeof error === 'string') {
    // Bare codes such as "csrf_required" are their own message.
    return { code: /^[a-z0-9_]+$/.test(error) ? error : fallback.code, message: error };
  }
  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return {
      code: typeof code === 'string' && code ? code : fallback.code,
      message: typeof message === 'string' && message ? message : fallback.message,
    };
  }
  return fallback;
}

export async function submitKeyReport(
  leakedKey: string,
  turnstileToken: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init)
): Promise<ReportResult> {
  const res = await fetchImpl('/api/abuse/report-key', {
    method: 'POST',
    // The route is public and takes no session authority; send no cookies.
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', 'x-turnstile-token': turnstileToken },
    body: JSON.stringify({ leaked_key: leakedKey, turnstile_token: turnstileToken }),
  });
  if (res.ok) return { ok: true };
  let body: unknown = null;
  try {
    body = await res.json();
  } catch (err) {
    console.error('Key report error body was not JSON', err);
  }
  return { ok: false, ...readError(body, res.status) };
}

/** The text to show for a failed report: the server's message and its error code. */
export function describeReportError(result: ReportResult): string {
  if (result.ok) return '';
  return result.message === result.code
    ? `Report failed (${result.code}).`
    : `Report failed: ${result.message} (${result.code}).`;
}
