# Jewelcase

A skeuomorphic, personal web player for Spotify: a 3D CD that spins in a glass jewel case, a shelf of your albums and playlists, glass buttons and shader lighting. Plain HTML/JS with three.js. No build step and no backend.

> Personal, non-commercial project. Not affiliated with or endorsed by Spotify. Requires Spotify Premium.

## Setup

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app.
   - APIs used: **Web API** and **Web Playback SDK**
   - Redirect URI: the exact URL where this site is served, e.g. `https://<you>.github.io/<repo>/`. The setup screen shows it with a copy button.
   - Under **User Management**, add the Spotify e-mail address of every person who will use it (Development Mode allows up to 5).
2. Open the site and paste the app's **Client ID**. You can also hard-code it in `js/config.js`.
   **Never** use the Client Secret: this app uses Authorization Code with PKCE and doesn't need one.
3. Click **Connect with Spotify**.

To run it locally, use `python3 -m http.server 8888 --bind 127.0.0.1`, open `http://127.0.0.1:8888/`, and register that URL as an additional redirect URI. Spotify doesn't accept `localhost`.

## How it plays

- **Desktop Chrome / Edge / Firefox:** audio plays in the page through the Web Playback SDK. The page only takes over playback when nothing else is playing.
- **Phones and tablets:** Spotify's SDK doesn't support mobile browsers, so the page works as a remote for the Spotify app or any Spotify Connect device. Pick the device from the device menu.

## How it follows Spotify's rules

- **OAuth:** Authorization Code with PKCE (`js/auth.js`) and `state` verification. The access token is kept in memory only. The refresh token is kept in `sessionStorage`, or in `localStorage` only if you tick "Stay signed in". Refresh tokens are rotated, and you're sent back to sign-in when a refresh fails.
- **Scopes:** only what's used (`js/config.js` lists why each one is needed).
- **Rate limits:** a 429 response honours `Retry-After`, with exponential backoff and jitter as a fallback. A shared cool-down gate pauses all requests. Polling slows when paused and stops when the tab is hidden.
- **Endpoints:** `/playlists/{id}/items` (not `/tracks`) and `/me/library*` (not the type-specific save/remove/contains endpoints). Search uses `limit=10`.
- **Errors:** Spotify's own error message or reason (e.g. `NO_ACTIVE_DEVICE`, `PREMIUM_REQUIRED`) is shown to the user.
- **Design guidelines:** album artwork is shown flat, uncropped, with rounded corners, and never animated, distorted or overlaid. The 3D discs and inserts are original typographic prints that use Spotify's metadata plus colours sampled from the cover. A Spotify logo and "Open in Spotify" links appear throughout.
- **Developer Terms:** no Spotify content is stored or cached beyond the current view, and nothing is used to train ML models.

## Credits

[three.js](https://threejs.org) (MIT, vendored in `vendor/three`). Spotify icon from [Simple Icons](https://simpleicons.org).
