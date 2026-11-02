import Constants from 'expo-constants';

/**
 * Where the FarePay backend lives: EXPO_PUBLIC_API_URL and nothing else (no address saved on the phone, no guess).
 * Set per build profile in eas.json for the installable app, or in mobile/.env for `expo start`,
 * e.g. EXPO_PUBLIC_API_URL=http://192.168.1.20:4000 to use a backend on the laptop.
 */
const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');

export const getApiUrl = () => apiUrl;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let authToken: string | null = null;
let onUnauthorized: () => void = () => {};

export function configureAuth(token: string | null, handler?: () => void) {
  authToken = token;
  if (handler) onUnauthorized = handler;
}

/** What a picture from the server (e.g. a report photo) needs to be allowed to load. */
export const authHeaders = (): Record<string, string> => (authToken ? { Authorization: `Bearer ${authToken}` } : {});

/** This app's version, sent with every request: the server tells apps older than its minimum to update. */
export const versionHeader = { 'X-App-Version': Constants.expoConfig?.version ?? '0.0.0' };

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// The free server falls asleep when nobody uses it and takes up to a minute to wake. After a quiet spell, knock on
// /health (safe to repeat) until it answers before sending the real request, so that one is never lost or sent twice.
const QUIET_MS = 10 * 60_000;
const WAKE_FOR_MS = 75_000;
let lastHeard = 0;
let waking: Promise<void> | null = null;

async function wakeServer() {
  const until = Date.now() + WAKE_FOR_MS;
  while (Date.now() < until) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      if ((await fetch(`${apiUrl}/health`, { signal: controller.signal })).ok) {
        lastHeard = Date.now();
        return;
      }
    } catch {
      // Still asleep (or no internet): try again shortly.
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

/** `timeoutMs`: how long to wait for the server (longer for sending a photo on a slow network). */
export async function api<T>(path: string, options: { method?: Method; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  if (Date.now() - lastHeard > QUIET_MS) {
    waking ??= wakeServer().finally(() => {
      waking = null;
    });
    await waking;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(apiUrl + path, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...versionHeader,
        ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(authToken && { Authorization: `Bearer ${authToken}` }),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', `Can't reach the FarePay server (${apiUrl}). Check your internet connection.`);
  } finally {
    clearTimeout(timeout);
  }

  const data = await res.json().catch(() => null);
  if (data?.error || res.ok) lastHeard = Date.now(); // a FarePay answer: the server is awake
  if (!res.ok) {
    // No FarePay error in the answer: something in between replied instead (e.g. the tunnel is down or its address
    // changed, which gives Cloudflare's 530 page). Treat it like the server being unreachable.
    if (!data?.error && res.status >= 500) {
      throw new ApiError(0, 'NETWORK', `Can't reach the FarePay server (${apiUrl}). Please try again in a minute.`);
    }
    if (res.status === 401 && authToken) onUnauthorized();
    const err = data?.error;
    let message: string = err?.message ?? `Request failed (${res.status})`;
    if (err?.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
      message = err.details.map((d: { field: string; message: string }) => (d.field ? `${d.field}: ${d.message}` : d.message)).join('\n');
    }
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, message, err?.details);
  }
  return data as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');

export const authHeader = () => (authToken ? { Authorization: `Bearer ${authToken}` } : undefined);
