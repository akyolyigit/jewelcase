// Offline preview: invented music, no Spotify data, no network calls.
const TRACKS = [
  { name: 'Silver Tide', album: 'Tidal Glass', artist: 'The Paper Moons', duration: 214000, palette: ['#7c6cff', '#141a3d', '#7af0d4'] },
  { name: 'Low Orbit', album: 'Tidal Glass', artist: 'The Paper Moons', duration: 187000, palette: ['#7c6cff', '#141a3d', '#7af0d4'] },
  { name: 'Marmalade Hours', album: 'Sunroom', artist: 'Ines Valo', duration: 241000, palette: ['#ff8a3d', '#3a160b', '#ffe08a'] },
  { name: 'Neon Fern', album: 'Greenhouse Static', artist: 'Kodo & the Weather', duration: 199000, palette: ['#38d27a', '#0c2a1a', '#e2ff7a'] },
];

export function demoShelf() {
  const seen = new Map();
  for (const t of TRACKS) if (!seen.has(t.album)) seen.set(t.album, { key: 'demo:' + t.album, type: 'demo', title: t.album, subtitle: t.artist, kind: 'Album', palette: t.palette, start: TRACKS.indexOf(t) });
  const extra = [
    ['Night Bus Lullabies', 'Playlist', ['#5a8cff', '#0b1430', '#ffb3d9']],
    ['Concrete Bloom', 'Album', ['#ff5f7a', '#2b0b14', '#ffd27a']],
    ['Slow Sundays', 'Playlist', ['#c9a36b', '#2a1d10', '#fff0d6']],
    ['Polaroid Summer', 'Album', ['#ffb347', '#3d1f00', '#8ae6ff']],
    ['Deep Work', 'Playlist', ['#4ad9e4', '#062a30', '#c8b6ff']],
  ];
  return [...seen.values(), ...extra.map(([title, kind, palette], i) => ({ key: 'demo:x' + i, type: 'demo', title, subtitle: kind === 'Playlist' ? 'by you' : 'Various', kind, palette, start: i % TRACKS.length }))];
}

export class DemoPlayer extends EventTarget {
  constructor() { super(); this.i = 0; this.state = { item: null, playing: false, progress: 0, duration: 0, at: performance.now(), shuffle: false, repeat: 'off', device: { id: 'demo', name: 'Demo deck', volume: 60 }, context: null }; }
  get position() { const s = this.state; return Math.min(s.duration, s.progress + (s.playing ? performance.now() - s.at : 0)); }
  emit(t, d) { this.dispatchEvent(new CustomEvent(t, { detail: d })); }
  load(i, play = true) {
    this.i = (i + TRACKS.length) % TRACKS.length; const t = TRACKS[this.i];
    const prev = this.state.item?.uri;
    Object.assign(this.state, {
      item: { uri: 'demo:' + this.i, name: t.name, type: 'track', duration: t.duration, artists: [{ name: t.artist }], album: { name: t.album, uri: 'demo:' + t.album, images: [] }, palette: t.palette },
      duration: t.duration, progress: 0, playing: play, at: performance.now(), context: 'demo:' + t.album,
    });
    this.emit('state', { ...this.state, trackChanged: prev !== this.state.item.uri });
  }
  start() { this.load(0, false); clearInterval(this.timer); this.timer = setInterval(() => { if (this.state.playing && this.position >= this.state.duration - 50) this.next(); }, 500); }
  stop() { clearInterval(this.timer); }
  push() { this.state.at = performance.now(); this.emit('state', { ...this.state, trackChanged: false }); }
  togglePlay() { this.state.progress = this.position; this.state.playing = !this.state.playing; this.push(); }
  next() { this.load(this.i + 1); }
  previous() { if (this.position > 3000) { this.state.progress = 0; this.push(); } else this.load(this.i - 1); }
  seek(ms) { this.state.progress = ms; this.push(); }
  setVolume(v) { this.state.device.volume = v; }
  toggleShuffle() { this.state.shuffle = !this.state.shuffle; this.state.progress = this.position; this.push(); }
  cycleRepeat() { const o = ['off', 'context', 'track']; this.state.repeat = o[(o.indexOf(this.state.repeat) + 1) % 3]; this.state.progress = this.position; this.push(); }
  playThis(body) { this.load(body?.start ?? 0); }
  transferTo() {}
}
