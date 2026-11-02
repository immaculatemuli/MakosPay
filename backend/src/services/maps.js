// The map tiles behind the "your car is coming" map (passenger app, marshal app, website). With a Google Maps key,
// Google's own map (Map Tiles API, 2D roadmap): its tiles need a session, made here and shared by everyone until it
// is close to expiring (about two weeks). Without a key, or if Google can't be reached, OpenStreetMap's tiles.
import { config } from '../config.js';

const OSM = { provider: 'osm', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap', max_zoom: 19 };
const RENEW_BEFORE_MS = 24 * 3600_000; // a new session a day before the old one runs out
const RETRY_AFTER_MS = 5 * 60_000; // Google unreachable: OpenStreetMap meanwhile, Google again after this

let session = null; // { token, expiresAt }
let failedAt = 0;

async function googleSession() {
  if (session && session.expiresAt - Date.now() > RENEW_BEFORE_MS) return session;
  if (Date.now() - failedAt < RETRY_AFTER_MS) return session; // (an older session still works until it expires)
  try {
    const res = await fetch(`${config.maps.googleBaseUrl}/v1/createSession?key=${encodeURIComponent(config.maps.googleKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType: 'roadmap', language: 'en-KE', region: 'KE' }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.session) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
    // `expiry` is in seconds since 1970.
    session = { token: body.session, expiresAt: Number(body.expiry) * 1000 || Date.now() + 13 * 24 * 3600_000 };
    return session;
  } catch (err) {
    failedAt = Date.now();
    console.error('[maps] could not start a Google map session, using OpenStreetMap:', err.message);
    return session && session.expiresAt > Date.now() ? session : null;
  }
}

/** The tiles to show: { provider, url (with {z}/{x}/{y}), attribution, max_zoom }. */
export async function mapTiles() {
  if (!config.maps.googleKey) return OSM;
  const s = await googleSession();
  if (!s) return OSM;
  return {
    provider: 'google',
    url: `${config.maps.googleBaseUrl}/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(s.token)}&key=${encodeURIComponent(config.maps.googleKey)}`,
    attribution: 'Map data © Google',
    max_zoom: 20,
  };
}

/** Tests only: forget the session. */
export const forgetMapSession = () => {
  session = null;
  failedAt = 0;
};
