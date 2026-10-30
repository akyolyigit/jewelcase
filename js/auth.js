// Authorization Code with PKCE — https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
// Refreshing — https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens
//
// Token storage policy:
//  - access token: memory only (never written to storage)
//  - refresh token: sessionStorage (cleared when the tab closes), or localStorage only
//    if the user explicitly ticks "Stay signed in on this device".
//  - PKCE verifier + state: sessionStorage, deleted right after the code exchange.
import { CLIENT_ID, SCOPES } from './config.js';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const K = { verifier: 'jc.pkce.verifier', state: 'jc.pkce.state', refresh: 'jc.refresh', remember: 'jc.remember', clientId: 'jc.clientId' };

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
const ss = { get: k => safe(() => sessionStorage.getItem(k)), set: (k, v) => safe(() => sessionStorage.setItem(k, v)), del: k => safe(() => sessionStorage.removeItem(k)) };
const ls = { get: k => safe(() => localStorage.getItem(k)), set: (k, v) => safe(() => localStorage.setItem(k, v)), del: k => safe(() => localStorage.removeItem(k)) };

export class AuthError extends Error {
  constructor(message, code) { super(message); this.name = 'AuthError'; this.code = code; }
}

/** Exact redirect URI for this deployment, e.g. https://you.github.io/spotify-player/ */
export function redirectUri() {
  const path = location.pathname.replace(/index\.html$/, '');
  return location.origin + path;
}

export function redirectUriProblem() {
  const u = new URL(redirectUri());
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && u.hostname === '127.0.0.1') return null; // loopback for local dev
  if (u.hostname === 'localhost') return 'Spotify does not accept "localhost". Open this page at http://127.0.0.1 instead.';
  return 'Spotify requires an HTTPS address (or http://127.0.0.1 for local testing).';
}

export function getClientId() { return (CLIENT_ID || ls.get(K.clientId) || '').trim(); }
export function setClientId(id) { ls.set(K.clientId, id.trim()); }

function randomString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}
async function challengeFrom(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

let accessToken = null;
let expiresAt = 0;
let refreshInFlight = null;
const listeners = new Set();
export function onSignedOut(fn) { listeners.add(fn); }

function storeRefresh(token) {
  const remember = ls.get(K.remember) === '1';
  if (remember) { ls.set(K.refresh, token); ss.del(K.refresh); }
  else { ss.set(K.refresh, token); ls.del(K.refresh); }
}
function readRefresh() { return ss.get(K.refresh) || ls.get(K.refresh); }

export async function login({ remember = false } = {}) {
  const clientId = getClientId();
  if (!clientId) throw new AuthError('Add your Client ID first.', 'no_client_id');
  const problem = redirectUriProblem();
  if (problem) throw new AuthError(problem, 'bad_redirect');
  remember ? ls.set(K.remember, '1') : ls.del(K.remember);

  const verifier = randomString(64);
  const state = randomString(24);
  ss.set(K.verifier, verifier);
  ss.set(K.state, state);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: await challengeFrom(verifier),
    redirect_uri: redirectUri(),
    state,
  });
  location.assign(`${AUTHORIZE_URL}?${params}`);
}

async function tokenRequest(body) {
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
  } catch {
    throw new AuthError('Could not reach Spotify. Check your connection and try again.', 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Token endpoint errors look like { error, error_description }
    const desc = data.error_description || data.error || `HTTP ${res.status}`;
    throw new AuthError(`Spotify sign-in failed: ${desc}`, data.error || `http_${res.status}`);
  }
  accessToken = data.access_token;
  expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  if (data.refresh_token) storeRefresh(data.refresh_token); // rotation: always keep the newest
  return accessToken;
}

/**
 * Call on page load. Completes a redirect if one is pending, otherwise restores the session
 * from a stored refresh token. Returns true when signed in.
 */
export async function init() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  const returnedState = url.searchParams.get('state');
  if (code || err) {
    const expected = ss.get(K.state);
    const verifier = ss.get(K.verifier);
    ss.del(K.state); ss.del(K.verifier);
    history.replaceState(null, '', redirectUri() + location.hash); // strip ?code= from the address bar
    if (err) throw new AuthError(err === 'access_denied' ? 'You cancelled the Spotify sign-in.' : `Spotify sign-in error: ${err}`, err);
    if (!expected || returnedState !== expected || !verifier) throw new AuthError('Sign-in could not be verified (state mismatch). Please try again.', 'state_mismatch');
    await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), client_id: getClientId(), code_verifier: verifier });
    return true;
  }
  if (readRefresh()) {
    try { await refresh(); return true; } catch { return false; }
  }
  return false;
}

export function refresh() {
  if (refreshInFlight) return refreshInFlight;
  const rt = readRefresh();
  if (!rt) { signOut('expired'); return Promise.reject(new AuthError('Your session ended. Please sign in again.', 'no_refresh')); }
  refreshInFlight = tokenRequest({ grant_type: 'refresh_token', refresh_token: rt, client_id: getClientId() })
    .catch(e => {
      // invalid_grant = refresh token revoked/expired -> must authorize again
      if (e.code !== 'network') signOut('expired');
      throw e.code === 'network' ? e : new AuthError('Your Spotify session expired. Please sign in again.', 'expired');
    })
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

/** A valid access token, refreshed ~60s before it expires. */
export async function getToken() {
  if (accessToken && Date.now() < expiresAt - 60_000) return accessToken;
  return refresh();
}

export function signOut(reason = 'user') {
  accessToken = null; expiresAt = 0;
  ss.del(K.refresh); ls.del(K.refresh);
  listeners.forEach(fn => fn(reason));
}

export const isSignedIn = () => !!accessToken;
