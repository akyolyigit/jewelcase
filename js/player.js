// Playback controller.
//  - "sdk" mode: audio plays in this browser via the Web Playback SDK (desktop browsers with DRM).
//  - "remote" mode: this page is a remote for another Spotify Connect device (phone app, speaker, ...).
import { Spotify, SpotifyError } from './api.js';
import { getToken } from './auth.js';
import { PLAYER_NAME } from './config.js';

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';

function canUseSdk() {
  if (!window.isSecureContext || !navigator.requestMediaKeySystemAccess) return false;
  // Spotify's SDK does not support mobile browsers.
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return false; // iPadOS
  return true;
}

function fromApiItem(item) {
  if (!item) return null;
  if (item.type === 'episode') {
    return {
      uri: item.uri, id: item.id, type: 'episode', name: item.name, duration: item.duration_ms,
      artists: [{ name: item.show?.name, uri: item.show?.uri, url: item.show?.external_urls?.spotify }],
      album: { name: item.show?.name, uri: item.show?.uri, images: item.images || item.show?.images || [], url: item.show?.external_urls?.spotify },
      url: item.external_urls?.spotify,
    };
  }
  return {
    uri: item.uri, id: item.id, type: 'track', name: item.name, duration: item.duration_ms,
    artists: (item.artists || []).map(a => ({ name: a.name, uri: a.uri, url: a.external_urls?.spotify })),
    album: { name: item.album?.name, uri: item.album?.uri, id: item.album?.id, images: item.album?.images || [], url: item.album?.external_urls?.spotify },
    url: item.external_urls?.spotify,
  };
}
const uriToUrl = uri => {
  const m = /^spotify:(track|album|artist|playlist|episode|show):([A-Za-z0-9]+)$/.exec(uri || '');
  return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : undefined;
};
function fromSdkTrack(t) {
  if (!t) return null;
  return {
    uri: t.uri, id: t.id, type: t.type === 'episode' ? 'episode' : 'track', name: t.name, duration: t.duration_ms,
    artists: (t.artists || []).map(a => ({ name: a.name, uri: a.uri, url: uriToUrl(a.uri) })),
    album: { name: t.album?.name, uri: t.album?.uri, id: t.album?.uri?.split(':')[2], images: t.album?.images || [], url: uriToUrl(t.album?.uri) },
    url: uriToUrl(t.uri),
  };
}

export class Player extends EventTarget {
  constructor() {
    super();
    this.state = { item: null, playing: false, progress: 0, duration: 0, at: performance.now(), shuffle: false, repeat: 'off', device: null, context: null };
    this.sdk = null; this.sdkDeviceId = null; this.mode = 'remote';
    this.pollTimer = null; this.stopped = false;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.poll(0); });
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  error(e) { this.emit('error', e); }

  get position() { const s = this.state; return Math.min(s.duration || 0, s.progress + (s.playing ? performance.now() - s.at : 0)); }
  get targetDevice() { return this.state.device?.id || this.sdkDeviceId || undefined; }
  get sdkActive() { return this.mode === 'sdk' && this.sdk && this.state.device?.id === this.sdkDeviceId; }

  setState(patch) {
    const prevUri = this.state.item?.uri;
    Object.assign(this.state, patch, { at: performance.now() });
    this.emit('state', { ...this.state, trackChanged: this.state.item?.uri !== prevUri });
  }

  async start() {
    this.poll(0);
    if (canUseSdk()) this.loadSdk(); else this.emit('sdk-unavailable');
  }
  stop() { this.stopped = true; clearTimeout(this.pollTimer); try { this.sdk?.disconnect(); } catch {} }

  /* ---------------- Web Playback SDK ---------------- */
  loadSdk() {
    window.onSpotifyWebPlaybackSDKReady = () => {
      const p = new window.Spotify.Player({
        name: PLAYER_NAME,
        getOAuthToken: cb => { getToken().then(cb).catch(e => this.error(e)); },
        volume: 0.6,
        enableMediaSession: true,
      });
      this.sdk = p;
      p.addListener('ready', async ({ device_id }) => {
        this.sdkDeviceId = device_id;
        this.emit('devices-changed');
        // Only take over if nothing else is currently playing — never hijack a phone/speaker.
        try {
          const cur = await Spotify.playbackState();
          if (!cur || !cur.device) await Spotify.transfer(device_id, false);
          setTimeout(() => this.poll(0), 800);
        } catch (e) { this.error(e); }
      });
      p.addListener('not_ready', () => { this.sdkDeviceId = null; this.mode = 'remote'; this.emit('devices-changed'); this.poll(0); });
      p.addListener('player_state_changed', s => {
        if (!s) { // playback moved to another device
          if (this.mode === 'sdk') { this.mode = 'remote'; this.poll(0); }
          return;
        }
        this.mode = 'sdk';
        const item = fromSdkTrack(s.track_window?.current_track);
        this.setState({
          item, playing: !s.paused, progress: s.position, duration: s.duration || item?.duration || 0,
          shuffle: s.shuffle, repeat: ['off', 'context', 'track'][s.repeat_mode] || 'off',
          device: { id: this.sdkDeviceId, name: 'This browser', type: 'Computer', volume: this.state.device?.volume ?? 60 },
          context: s.context?.uri || null,
        });
        this.schedulePoll(); // keep a slow heartbeat for context/device info
      });
      p.addListener('initialization_error', ({ message }) => { this.sdk = null; this.emit('sdk-unavailable', message); });
      p.addListener('authentication_error', ({ message }) => this.error(new SpotifyError(401, `Spotify couldn't authorise in-browser playback: ${message}`, 'AUTH')));
      p.addListener('account_error', ({ message }) => this.error(new SpotifyError(403, `In-browser playback needs Spotify Premium (${message}).`, 'PREMIUM_REQUIRED')));
      p.addListener('playback_error', ({ message }) => this.error(new SpotifyError(0, `Playback error: ${message}`, 'PLAYBACK')));
      p.addListener('autoplay_failed', () => this.emit('autoplay-blocked'));
      p.connect().then(ok => { if (!ok) this.emit('sdk-unavailable', 'connect failed'); });
    };
    const s = document.createElement('script'); s.src = SDK_URL; s.async = true;
    s.onerror = () => this.emit('sdk-unavailable', 'Could not load the Spotify Web Playback SDK.');
    document.head.appendChild(s);
  }

  /* ---------------- Remote state polling ---------------- */
  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (this.stopped || document.hidden) return;
    const delay = this.mode === 'sdk' ? 30_000 : this.state.playing ? 4_000 : 9_000;
    this.pollTimer = setTimeout(() => this.poll(), delay);
  }
  async poll(delay) {
    if (delay !== undefined) { clearTimeout(this.pollTimer); this.pollTimer = setTimeout(() => this.poll(), delay); return; }
    if (this.stopped || document.hidden) return;
    try {
      const s = await Spotify.playbackState();
      if (!s) {
        if (this.mode !== 'sdk') this.setState({ playing: false, device: null });
      } else if (!(this.mode === 'sdk' && s.device?.id === this.sdkDeviceId)) {
        this.mode = s.device?.id && s.device.id === this.sdkDeviceId ? 'sdk' : 'remote';
        this.setState({
          item: fromApiItem(s.item) ?? this.state.item, playing: !!s.is_playing, progress: s.progress_ms ?? 0,
          duration: s.item?.duration_ms ?? 0, shuffle: !!s.shuffle_state, repeat: s.repeat_state || 'off',
          device: s.device ? { id: s.device.id, name: s.device.name, type: s.device.type, volume: s.device.volume_percent, supportsVolume: s.device.supports_volume } : null,
          context: s.context?.uri || null,
        });
      } else {
        // SDK is active; just refresh device volume/context
        this.state.context = s.context?.uri || this.state.context;
      }
    } catch (e) {
      if (!(e instanceof SpotifyError && e.status === 0)) this.error(e);
    }
    this.schedulePoll();
  }
  /** Re-sync shortly after a command (player commands are asynchronous on Spotify's side). */
  resync() { this.poll(650); }

  /* ---------------- Commands ---------------- */
  activate() { try { this.sdk?.activateElement?.(); } catch {} } // must run inside a user gesture

  async togglePlay() {
    this.activate();
    if (this.sdkActive) return this.sdk.togglePlay();
    const playing = this.state.playing;
    this.setState({ playing: !playing, progress: this.position });
    try { playing ? await Spotify.pause(this.targetDevice) : await Spotify.play(this.targetDevice); }
    catch (e) { this.setState({ playing }); this.handleCommandError(e); }
    this.resync();
  }
  async next() { if (this.sdkActive) return this.sdk.nextTrack(); try { await Spotify.next(this.targetDevice); } catch (e) { this.handleCommandError(e); } this.resync(); }
  async previous() { if (this.sdkActive) return this.sdk.previousTrack(); try { await Spotify.previous(this.targetDevice); } catch (e) { this.handleCommandError(e); } this.resync(); }
  async seek(ms) {
    this.setState({ progress: ms });
    if (this.sdkActive) return this.sdk.seek(ms);
    try { await Spotify.seek(ms, this.targetDevice); } catch (e) { this.handleCommandError(e); } this.resync();
  }
  async setVolume(pct) {
    if (this.sdkActive) { this.state.device.volume = pct; return this.sdk.setVolume(pct / 100); }
    try { await Spotify.volume(pct, this.targetDevice); if (this.state.device) this.state.device.volume = pct; } catch (e) { this.handleCommandError(e); }
  }
  async toggleShuffle() {
    const v = !this.state.shuffle; this.setState({ shuffle: v, progress: this.position });
    try { await Spotify.shuffle(v, this.targetDevice); } catch (e) { this.setState({ shuffle: !v }); this.handleCommandError(e); } this.resync();
  }
  async cycleRepeat() {
    const order = ['off', 'context', 'track']; const prev = this.state.repeat;
    const v = order[(order.indexOf(prev) + 1) % 3]; this.setState({ repeat: v, progress: this.position });
    try { await Spotify.repeat(v, this.targetDevice); } catch (e) { this.setState({ repeat: prev }); this.handleCommandError(e); } this.resync();
  }
  /** body: { context_uri, offset } or { uris } */
  async playThis(body) {
    this.activate();
    try { await Spotify.play(this.targetDevice, body); }
    catch (e) {
      if (e instanceof SpotifyError && (e.reason === 'NO_ACTIVE_DEVICE' || e.status === 404) && this.sdkDeviceId && this.targetDevice !== this.sdkDeviceId) {
        try { await Spotify.play(this.sdkDeviceId, body); } catch (e2) { this.handleCommandError(e2); }
      } else this.handleCommandError(e);
    }
    this.resync();
  }
  async transferTo(id) {
    this.activate();
    try { await Spotify.transfer(id, this.state.playing); } catch (e) { this.handleCommandError(e); }
    this.poll(900);
  }
  handleCommandError(e) {
    if (e instanceof SpotifyError && (e.reason === 'NO_ACTIVE_DEVICE' || (e.status === 404 && /device/i.test(e.message)))) this.emit('need-device', e);
    else this.error(e);
  }
}
