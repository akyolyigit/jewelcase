// Your Spotify app's Client ID (from developer.spotify.com/dashboard).
// A Client ID is public by design. NEVER put a Client Secret in this project:
// this app uses Authorization Code with PKCE, which needs no secret.
// Leave empty to enter it on the setup screen instead (stored only in this browser).
export const CLIENT_ID = '9edae3a5d4744b07901508fc41a792ae';

// Minimum scopes for the features this app actually has:
//  streaming, user-read-email, user-read-private  -> required by the Web Playback SDK
//  user-read-playback-state                       -> read what's playing + list devices
//  user-modify-playback-state                     -> play / pause / skip / seek / volume / transfer
//  playlist-read-private                          -> list your playlists on the shelf
//  user-library-read                              -> saved albums, liked songs, "is this saved?"
//  user-library-modify                            -> the heart button (PUT/DELETE /me/library)
export const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'user-library-read',
  'user-library-modify',
];

export const PLAYER_NAME = 'Jewelcase Player';
