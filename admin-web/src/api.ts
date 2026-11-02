// Talks to the FarePay API at the same address as the dashboard. The sign-in is an HttpOnly cookie the
// browser sends by itself (this code never sees it); every request carries the dashboard's header, which the
// API requires for changes made with the cookie.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

let onSignedOut: () => void = () => {};
/** Called when the API says the sign-in has ended (expired, password changed, account switched off). */
export const whenSignedOut = (fn: () => void) => {
  onSignedOut = fn;
};

export async function api<T>(path: string, { method = 'GET', body }: { method?: Method; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'x-farepay-client': 'office-web', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the FarePay server. Check the connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/web/login')) onSignedOut();
    if (res.status >= 500 && !data?.error) throw new ApiError(res.status, 'SERVER', 'The FarePay server had a problem. Please try again.');
    // "Invalid request" alone says nothing: show what was wrong (e.g. the password rule) instead.
    const details: { message: string }[] | undefined = data?.error?.code === 'VALIDATION_ERROR' ? data.error.details : undefined;
    const message = details?.length ? details.map((d) => d.message).join('. ') : data?.error?.message;
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');
