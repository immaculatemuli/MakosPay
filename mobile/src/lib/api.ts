import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const SERVER_KEY = 'farepay.serverUrl';

/**
 * Where the FarePay backend lives, by default:
 * - EXPO_PUBLIC_API_URL (set when building the installable app, or in mobile/.env), e.g. https://api.example.com
 * - Otherwise, during development, the computer running `expo start` (same machine as the backend), port 4000.
 * The person using the app can override it on the sign-in screen (e.g. when the tunnel address changes).
 */
function defaultBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${devHost ?? 'localhost'}:4000`;
}

export const DEFAULT_API_URL = defaultBaseUrl();
let apiUrl = DEFAULT_API_URL;

export const getApiUrl = () => apiUrl;

/** Loads the server address saved on this phone, if any. Call once at start-up. */
export async function loadApiUrl() {
  const saved = await SecureStore.getItemAsync(SERVER_KEY).catch(() => null);
  if (saved) apiUrl = saved;
}

/** Saves a server address on this phone (empty = go back to the default). */
export async function setApiUrl(url: string) {
  const clean = url.trim().replace(/\/+$/, '');
  apiUrl = clean || DEFAULT_API_URL;
  if (clean) await SecureStore.setItemAsync(SERVER_KEY, clean);
  else await SecureStore.deleteItemAsync(SERVER_KEY);
}

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

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** `timeoutMs`: how long to wait for the server (longer for sending a photo on a slow network). */
export async function api<T>(path: string, options: { method?: Method; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(apiUrl + path, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(authToken && { Authorization: `Bearer ${authToken}` }),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', `Can't reach the FarePay server (${apiUrl}). Check your internet connection, or the server address on the sign-in screen.`);
  } finally {
    clearTimeout(timeout);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // No FarePay error in the answer: something in between replied instead (e.g. the tunnel is down or its address
    // changed, which gives Cloudflare's 530 page). Treat it like the server being unreachable.
    if (!data?.error && res.status >= 500) {
      throw new ApiError(0, 'NETWORK', `Can't reach the FarePay server (${apiUrl}). The server address may have changed: check "Server address" on the sign-in screen.`);
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
