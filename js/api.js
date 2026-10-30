// Thin Spotify Web API client.
//  - 401 -> refresh token once, retry; if that fails the user is sent back to sign-in.
//  - 429 -> honour Retry-After; otherwise exponential backoff with jitter. A shared
//           cool-down gate pauses *all* requests so nothing hammers the API.
//  - 5xx -> bounded exponential backoff.
//  - Every error surfaces Spotify's own message (error.message / reason).
// Nothing returned from here is persisted: content lives in memory for the current view only.
import { getToken, refresh, AuthError } from './auth.js';

const BASE = 'https://api.spotify.com/v1';
const MAX_RETRIES = 4;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let coolDownUntil = 0;

export class SpotifyError extends Error {
  constructor(status, message, reason, path) {
    super(message); this.name = 'SpotifyError'; this.status = status; this.reason = reason; this.path = path;
  }
}

const REASONS = {
  PREMIUM_REQUIRED: 'This needs Spotify Premium.',
  NO_ACTIVE_DEVICE: 'No active Spotify device. Start Spotify somewhere, or pick a device.',
  NO_PREV_TRACK: 'There is no previous track.',
  NO_NEXT_TRACK: 'There is no next track.',
  ALREADY_PAUSED: 'Already paused.',
  NOT_PAUSED: 'Already playing.',
  UNKNOWN: null,
};

function friendly(status, spotifyMsg, reason) {
  const r = reason && REASONS[reason];
  if (r) return r;
  const base = {
    400: 'Spotify rejected the request',
    401: 'Your session expired',
    403: 'Spotify refused this action',
    404: 'Not found on Spotify',
    429: 'Spotify is rate-limiting this app — slowing down',
    500: 'Spotify had an internal error',
    502: 'Spotify is temporarily unavailable',
    503: 'Spotify is temporarily unavailable',
  }[status] || `Spotify error ${status}`;
  return spotifyMsg ? `${base}: ${spotifyMsg}` : `${base}.`;
}

function backoff(attempt) {
  const base = Math.min(32_000, 1000 * 2 ** attempt);
  return base / 2 + Math.random() * base / 2; // "equal jitter"
}

/**
 * @param {string} method
 * @param {string} path      e.g. '/me/player/play'
 * @param {{query?:object, body?:any, signal?:AbortSignal}} [opts]
 */
export async function api(method, path, { query, body, signal } = {}) {
  const url = new URL(BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);

  let triedRefresh = false;
  for (let attempt = 0; ; attempt++) {
    const wait = coolDownUntil - Date.now();
    if (wait > 0) await sleep(wait);

    const token = await getToken();
    let res;
    try {
      res = await fetch(url, {
        method,
        signal,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (attempt < 2) { await sleep(backoff(attempt)); continue; }
      throw new SpotifyError(0, 'Could not reach Spotify. Check your internet connection.', 'NETWORK', path);
    }

    if (res.status === 204 || res.status === 202) return null;
    if (res.ok) {
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }

    let spotifyMsg = '', reason;
    try { const j = await res.json(); spotifyMsg = j?.error?.message || j?.error_description || ''; reason = j?.error?.reason; } catch {}

    if (res.status === 401 && !triedRefresh) {
      triedRefresh = true;
      try { await refresh(); continue; } catch (e) { throw e instanceof AuthError ? e : new AuthError('Please sign in again.', 'expired'); }
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const ra = Number(res.headers.get('Retry-After'));
      const delay = Number.isFinite(ra) && ra > 0 ? ra * 1000 + 250 : backoff(attempt);
      coolDownUntil = Math.max(coolDownUntil, Date.now() + delay);
      window.dispatchEvent(new CustomEvent('spotify:ratelimited', { detail: { delay } }));
      continue;
    }

    if ([500, 502, 503].includes(res.status) && attempt < 2) { await sleep(backoff(attempt)); continue; }

    throw new SpotifyError(res.status, friendly(res.status, spotifyMsg, reason), reason, path);
  }
}

/* ---------- Endpoints used by this app (paths per Spotify's OpenAPI spec) ---------- */
export const Spotify = {
  me: () => api('GET', '/me'),

  // Player
  playbackState: () => api('GET', '/me/player', { query: { additional_types: 'track,episode' } }),
  devices: () => api('GET', '/me/player/devices'),
  transfer: (deviceId, play = false) => api('PUT', '/me/player', { body: { device_ids: [deviceId], play } }),
  play: (deviceId, body) => api('PUT', '/me/player/play', { query: { device_id: deviceId }, body }),
  pause: deviceId => api('PUT', '/me/player/pause', { query: { device_id: deviceId } }),
  next: deviceId => api('POST', '/me/player/next', { query: { device_id: deviceId } }),
  previous: deviceId => api('POST', '/me/player/previous', { query: { device_id: deviceId } }),
  seek: (ms, deviceId) => api('PUT', '/me/player/seek', { query: { position_ms: Math.round(ms), device_id: deviceId } }),
  volume: (pct, deviceId) => api('PUT', '/me/player/volume', { query: { volume_percent: Math.round(pct), device_id: deviceId } }),
  shuffle: (state, deviceId) => api('PUT', '/me/player/shuffle', { query: { state, device_id: deviceId } }),
  repeat: (state, deviceId) => api('PUT', '/me/player/repeat', { query: { state, device_id: deviceId } }),

  // Library (generic URI-based endpoints; the type-specific ones are deprecated)
  libraryContains: uris => api('GET', '/me/library/contains', { query: { uris: uris.join(',') } }),
  librarySave: uris => api('PUT', '/me/library', { query: { uris: uris.join(',') } }),
  libraryRemove: uris => api('DELETE', '/me/library', { query: { uris: uris.join(',') } }),
  savedAlbums: (limit = 20, offset = 0) => api('GET', '/me/albums', { query: { limit, offset } }),
  savedTracks: (limit = 50, offset = 0) => api('GET', '/me/tracks', { query: { limit, offset } }),

  // Playlists (/items, not the deprecated /tracks)
  myPlaylists: (limit = 20, offset = 0) => api('GET', '/me/playlists', { query: { limit, offset } }),
  playlistItems: (id, limit = 50, offset = 0) => api('GET', `/playlists/${encodeURIComponent(id)}/items`, { query: { limit, offset, additional_types: 'track' } }),

  albumTracks: (id, limit = 50) => api('GET', `/albums/${encodeURIComponent(id)}/tracks`, { query: { limit } }),

  // Search: limit max is 10 for Development Mode apps
  search: (q, signal) => api('GET', '/search', { query: { q, type: 'track,album', limit: 10 }, signal }),
};
