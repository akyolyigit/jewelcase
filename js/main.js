import * as Auth from './auth.js';
import { Spotify, SpotifyError } from './api.js';
import { Player } from './player.js';
import { DemoPlayer, demoShelf } from './demo.js';
import { createScene } from './scene.js';
import { paletteFromSeed } from './textures.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ------------------------------------------------------------------ helpers */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}
const icon = id => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; };
const fmt = ms => { if (!Number.isFinite(ms) || ms < 0) ms = 0; const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function pickImage(images, px = 300) {
  if (!images?.length) return null;
  const withW = images.filter(i => i.width);
  if (!withW.length) return images[0].url;
  const sorted = [...withW].sort((a, b) => a.width - b.width);
  return (sorted.find(i => i.width >= px) || sorted[sorted.length - 1]).url;
}
const artistNames = arr => (arr || []).map(a => a.name).filter(Boolean).join(', ');

function toast(message, { error = false, action, actionLabel, ms = 5200 } = {}) {
  const el = h('div', { class: 'toast' + (error ? ' error' : ''), role: error ? 'alert' : 'status' }, h('span', {}, message));
  if (action) el.append(h('button', { class: 'chip', onclick: () => { action(); el.remove(); } }, actionLabel));
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}
function reportError(e) {
  console.warn(e);
  if (e instanceof Auth.AuthError) { if (e.code === 'expired' || e.code === 'no_refresh') return; toast(e.message, { error: true }); return; }
  if (e?.name === 'AbortError') return;
  toast(e?.message || 'Something went wrong.', { error: true });
}

/* ------------------------------------------------------------------ palette from cover art (colours only; the image itself is never altered) */
const paletteCache = new Map(); // in-memory, current session only
async function samplePalette(url, seed) {
  if (!url) return paletteFromSeed(seed);
  if (paletteCache.has(url)) return paletteCache.get(url);
  try {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url;
    await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 36;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 36, 36);
    const d = g.getImageData(0, 0, 36, 36).data;
    const px = [];
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
      const max = Math.max(r, gg, b), min = Math.min(r, gg, b), l = (max + min) / 2;
      const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
      let hue = 0;
      if (max !== min) { hue = max === r ? ((gg - b) / (max - min)) % 6 : max === gg ? (b - r) / (max - min) + 2 : (r - gg) / (max - min) + 4; hue *= 60; if (hue < 0) hue += 360; }
      px.push({ r, g: gg, b, l, s, h: hue });
    }
    const avg = list => { const n = list.length || 1; return list.reduce((a, p) => [a[0] + p.r / n, a[1] + p.g / n, a[2] + p.b / n], [0, 0, 0]); };
    const toHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
    const scoreV = p => p.s * (1 - Math.abs(p.l - 0.52) * 1.6);
    const byV = [...px].sort((a, b) => scoreV(b) - scoreV(a));
    const vib = byV.slice(0, Math.max(8, px.length / 12));
    const vibrant = avg(vib);
    const vh = vib[0]?.h ?? 0;
    const dark = avg([...px].sort((a, b) => a.l - b.l).slice(0, px.length / 3)).map(v => v * 0.9 + 0.03);
    const hueDist = p => { const x = Math.abs(p.h - vh); return Math.min(x, 360 - x); };
    const accentPool = px.filter(p => p.s > 0.25 && p.l > 0.3 && p.l < 0.85).sort((a, b) => hueDist(b) - hueDist(a)).slice(0, 20);
    let accent = accentPool.length >= 5 ? avg(accentPool) : vibrant.map(v => Math.min(1, v * 1.35 + 0.12));
    let v = vibrant; if (Math.max(...v) < 0.25) v = v.map(x => x + 0.25); // keep it visible on black
    const pal = [toHex(v), toHex(dark), toHex(accent)];
    paletteCache.set(url, pal);
    return pal;
  } catch { return paletteFromSeed(seed); }
}
function applyCssPalette(p) { const r = document.documentElement.style; r.setProperty('--c1', p[0]); r.setProperty('--c2', p[1]); r.setProperty('--c3', p[2]); }

/* ------------------------------------------------------------------ setup screen */
function showSetup(err) {
  $('#app').hidden = true; $('#setup').hidden = false;
  const cid = Auth.getClientId();
  $('#client-id').value = cid;
  $('#redirect-uri').textContent = Auth.redirectUri();
  const problem = Auth.redirectUriProblem();
  $('#redirect-warning').hidden = !problem; $('#redirect-warning').textContent = problem || '';
  $('#setup-error').hidden = !err; $('#setup-error').textContent = err || '';
}
$('#copy-redirect').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(Auth.redirectUri()); $('#copy-redirect').textContent = 'Copied'; setTimeout(() => $('#copy-redirect').textContent = 'Copy', 1500); }
  catch { const r = document.createRange(); r.selectNodeContents($('#redirect-uri')); getSelection().removeAllRanges(); getSelection().addRange(r); }
});
$('#login').addEventListener('click', async () => {
  const id = $('#client-id').value.trim();
  if (!/^[0-9a-f]{32}$/i.test(id)) { $('#setup-error').hidden = false; $('#setup-error').textContent = 'That doesn\'t look like a Client ID (32 letters and numbers, from your app\'s Settings page).'; return; }
  Auth.setClientId(id);
  try { await Auth.login({ remember: $('#remember').checked }); } catch (e) { $('#setup-error').hidden = false; $('#setup-error').textContent = e.message; }
});
$('#demo').addEventListener('click', () => startApp(true));
$('#exit-demo').addEventListener('click', () => location.reload());

/* ------------------------------------------------------------------ app */
let player, scene, demo = false, nowNp = null, likedKnown = new Map(), meProfile = null;

function startApp(isDemo) {
  demo = isDemo;
  $('#setup').hidden = true; $('#app').hidden = false; $('#demo-ribbon').hidden = !demo;

  scene = scene || createScene($('#stage'), {
    onShelfPick: item => playShelfItem(item),
    onShelfHover: (item, pos) => showTip(item, pos),
    onControl: a => {
      if (a === 'play') player.togglePlay(); else if (a === 'next') player.next(); else if (a === 'prev') player.previous();
      else if (a === 'shuffle') player.toggleShuffle(); else if (a === 'repeat') player.cycleRepeat(); else if (a === 'love') toggleLike();
    },
    onVolume: v => setVolume(v),
    onSeek: frac => { const d = player.state.duration || 0; if (d) player.seek(frac * d); },
  });

  player = demo ? new DemoPlayer() : new Player();
  player.addEventListener('state', e => renderState(e.detail));
  player.addEventListener('error', e => reportError(e.detail));
  player.addEventListener('need-device', () => { toast('No active Spotify device. Choose where to play.', { action: openDevices, actionLabel: 'Devices' }); });
  player.addEventListener('sdk-unavailable', e => {
    if (e.detail) toast('This browser can\'t play Spotify audio itself, so the page works as a remote for your Spotify app.', { ms: 7000 });
  });
  player.addEventListener('autoplay-blocked', () => toast('Your browser blocked autoplay. Press play to start audio.', { action: () => player.togglePlay(), actionLabel: 'Play' }));
  player.addEventListener('devices-changed', () => { if (!$('#pop-devices').hidden) openDevices(); });
  player.start();

  if (demo) { scene.setShelf(demoShelf()); renderAccount({ display_name: 'Demo listener' }); }
  else { loadShelf(); Spotify.me().then(renderAccount).catch(reportError); }
  requestAnimationFrame(tick);
}

window.addEventListener('spotify:ratelimited', e => toast(`Spotify asked us to slow down. Retrying in ${Math.ceil(e.detail.delay / 1000)}s…`, { ms: Math.min(8000, e.detail.delay + 500) }));
Auth.onSignedOut(reason => { player?.stop(); if (reason === 'expired') showSetup('Your Spotify session expired. Please connect again.'); else showSetup(); });

function renderAccount(me) {
  meProfile = me;
  $('#account-name').textContent = me?.display_name ? `Signed in as ${me.display_name}` : 'Signed in';
  const btn = $('#btn-account'); const img = pickImage(me?.images, 64);
  $('#avatar-initial').textContent = (me?.display_name || '·').trim().charAt(0).toUpperCase();
  btn.querySelector('img')?.remove();
  if (img) btn.append(h('img', { src: img, alt: '' }));
}

/* ------------------------------------------------------------------ now playing */
let lastPick = null; // { key, at } — lets a Liked Songs disc stay put when playback has no context
function sourceKeyFor(s, item) {
  if (s.context) return s.context;
  if (lastPick && Date.now() - lastPick.at < 10 * 60_000) return lastPick.key;
  return item.album?.uri || item.uri;
}
function pushTransport() {
  const s = player.state, item = s.item;
  scene.setPlaying(s.playing);
  scene.setTransport({
    playing: s.playing, shuffle: s.shuffle, repeat: s.repeat, liked: item ? !!likedKnown.get(item.uri) : false,
    volume: s.device?.volume, device: s.device?.name ? `▸ ${s.device.name}` : '',
    title: item?.name, sub: item ? [artistNames(item.artists), item.album?.name].filter(Boolean).join(' — ') : '', dur: fmt(s.duration),
  });
  const btn = $('#a11y-play'); btn.textContent = s.playing ? 'Pause' : 'Play';
  $('#device-name').textContent = s.device?.name || 'Devices'; $('#device-pill').classList.toggle('active', !!s.device);
  $('#a11y-like').setAttribute('aria-pressed', String(item ? !!likedKnown.get(item.uri) : false));
}
function renderState(s) {
  const item = s.item;
  pushTransport();
  if (!s.trackChanged && nowNp) return;
  if (!item) { scene.setNowPlaying(null); $('#np-pill').hidden = true; return; }

  const art = pickImage(item.album?.images, 640);
  const pill = $('#np-pill'); pill.hidden = false;
  const t = $('#np-title'); t.textContent = item.name; t.title = item.name; item.url ? t.href = item.url : t.removeAttribute('href');
  const ar = $('#np-artists'); ar.replaceChildren(...(item.artists || []).flatMap((a, i) => [i ? ', ' : '', a.url ? h('a', { href: a.url, target: '_blank', rel: 'noopener' }, a.name) : a.name])); ar.title = artistNames(item.artists);
  const os = $('#open-spotify'); item.url ? os.href = item.url : os.removeAttribute('href');
  document.title = `${item.name} · ${artistNames(item.artists)} — Jewelcase`;

  const key = item.album?.uri || item.uri;
  const sourceKey = sourceKeyFor(s, item);
  const np = { key, sourceKey, art, trackName: item.name, albumName: item.album?.name, artists: artistNames(item.artists), kind: item.type === 'episode' ? 'Podcast' : 'Album', palette: item.palette || paletteCache.get(art) || null };
  nowNp = np;
  scene.setNowPlaying(np);
  scene.setHighlight(sourceKey);
  if (np.palette) applyCssPalette(np.palette);
  if (!item.palette) samplePalette(art, key).then(p => { if (nowNp !== np) return; np.palette = p; applyCssPalette(p); scene.refreshPrint(np); });

  if (!demo && item.uri && !likedKnown.has(item.uri)) {
    Spotify.libraryContains([item.uri]).then(r => { likedKnown.set(item.uri, !!r?.[0]); if (player.state.item?.uri === item.uri) pushTransport(); }).catch(reportError);
  }
}

let lastSec = -1;
function tick() {
  requestAnimationFrame(tick);
  if (!player) return;
  const pos = player.position, dur = player.state.duration || 0;
  const sec = Math.floor(pos / 1000);
  scene.setProgress(dur ? pos / dur : 0, fmt(pos));
  if (sec !== lastSec) { lastSec = sec; }
}

/* ------------------------------------------------------------------ transport */
let volTimer = null;
function setVolume(v) {
  if (player.state.device) player.state.device.volume = v;
  clearTimeout(volTimer); volTimer = setTimeout(() => player.setVolume(v), 220); // one request per pause in turning
}
async function toggleLike() {
  if (demo) { toast('Sign in to save songs to Your Library.', { ms: 2500 }); return; }
  const uri = player.state.item?.uri; if (!uri) return;
  const was = !!likedKnown.get(uri); likedKnown.set(uri, !was); pushTransport();
  try { was ? await Spotify.libraryRemove([uri]) : await Spotify.librarySave([uri]); toast(was ? 'Removed from Your Library' : 'Saved to Your Library', { ms: 2200 }); }
  catch (e) { likedKnown.set(uri, was); pushTransport(); reportError(e); }
}
// visually hidden controls: keyboard + screen readers
$('#a11y-play').addEventListener('click', () => player.togglePlay());
$('#a11y-prev').addEventListener('click', () => player.previous());
$('#a11y-next').addEventListener('click', () => player.next());
$('#a11y-shuffle').addEventListener('click', () => player.toggleShuffle());
$('#a11y-repeat').addEventListener('click', () => player.cycleRepeat());
$('#a11y-like').addEventListener('click', () => toggleLike());
$('#a11y-vol').addEventListener('change', e => { scene.setVolume(+e.target.value); setVolume(+e.target.value); });
document.addEventListener('keydown', e => {
  if (!player || e.target.closest('input, textarea') || e.metaKey || e.ctrlKey) return;
  if (e.code === 'Space') { e.preventDefault(); player.togglePlay(); }
  else if (e.key === 'n') player.next(); else if (e.key === 'p') player.previous();
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { const v = Math.max(0, Math.min(100, (player.state.device?.volume ?? 60) + (e.key === 'ArrowUp' ? 5 : -5))); scene.setVolume(v); setVolume(v); e.preventDefault(); }
  else if (e.key === '/') { e.preventDefault(); openSheet('search'); }
  else if (e.key === 'Escape') closeAll();
});

/* ------------------------------------------------------------------ shelf */
async function loadShelf() {
  try {
    const [albums, playlists, liked] = await Promise.all([Spotify.savedAlbums(20), Spotify.myPlaylists(20), Spotify.savedTracks(1)]);
    const items = [];
    if (liked?.total) items.push({ key: 'liked', type: 'liked', title: 'Liked Songs', subtitle: `${liked.total} songs`, kind: 'Collection', palette: ['#8f7cff', '#2a1f6b', '#cfe8ff'], art: null });
    for (const it of albums?.items || []) { const a = it.album; if (!a) continue; items.push({ key: a.uri, type: 'album', uri: a.uri, id: a.id, title: a.name, subtitle: artistNames(a.artists), kind: 'Album', images: a.images, art: pickImage(a.images, 300), url: a.external_urls?.spotify }); }
    for (const p of playlists?.items || []) { if (!p) continue; items.push({ key: p.uri, type: 'playlist', uri: p.uri, id: p.id, title: p.name, subtitle: `by ${p.owner?.display_name || 'Spotify'}`, kind: 'Playlist', images: p.images, art: pickImage(p.images, 300), url: p.external_urls?.spotify }); }
    if (!items.length) { toast('Your shelf is empty. Save some albums in Spotify, or use Search.', { ms: 7000 }); return; }
    scene.setShelf(items);
    // colour each case from its cover, a few at a time
    let i = 0;
    const worker = async () => { while (i < items.length) { const it = items[i++]; if (!it.images) continue; const p = await samplePalette(pickImage(it.images, 64), it.key); scene.updateShelfPalette(it.key, p); } };
    await Promise.all([worker(), worker(), worker()]);
  } catch (e) { reportError(e); }
}

function showTip(item, pos) {
  const tip = $('#shelf-tip');
  if (!item || !pos) { tip.hidden = true; return; }
  const img = pickImage(item.images, 160);
  $('#tip-art').hidden = !img; if (img) { $('#tip-art').src = img; $('#tip-art').alt = `Cover of ${item.title}`; }
  $('#tip-title').textContent = item.title; $('#tip-sub').textContent = `${item.kind} · ${item.subtitle || ''}`;
  tip.classList.toggle('side', !!pos.side);
  if (pos.side) { tip.style.left = pos.x + 'px'; tip.style.top = pos.y + 'px'; }
  else { tip.style.left = Math.max(150, Math.min(innerWidth - 150, pos.x)) + 'px'; tip.style.top = (pos.y - 10) + 'px'; }
  tip.hidden = false;
}

async function playShelfItem(item) {
  showTip(null);
  lastPick = { key: item.key, at: Date.now() };
  scene.insertFromShelf(item);
  if (item.type === 'liked') {
    try { const r = await Spotify.savedTracks(50); const uris = (r?.items || []).map(x => x.track?.uri).filter(Boolean); if (uris.length) player.playThis({ uris }); }
    catch (e) { reportError(e); }
  } else if (item.type === 'demo') player.playThis({ start: item.start });
  else player.playThis({ context_uri: item.uri });
}

/* ------------------------------------------------------------------ sheets */
function closeAll() { $$('.sheet, .popover').forEach(s => s.hidden = true); }
function openSheet(name) {
  const el = $('#sheet-' + name); const wasOpen = !el.hidden; closeAll(); if (wasOpen) return;
  el.hidden = false;
  if (name === 'search') setTimeout(() => $('#q').focus(), 50);
  if (name === 'library') showLibraryTab(currentTab);
}
$$('[data-close]').forEach(b => b.addEventListener('click', closeAll));
$('#btn-search').addEventListener('click', () => openSheet('search'));
$('#btn-library').addEventListener('click', () => openSheet('library'));
$('#btn-devices').addEventListener('click', () => { const open = !$('#pop-devices').hidden; closeAll(); if (!open) openDevices(); });
$('#device-pill').addEventListener('click', () => { const open = !$('#pop-devices').hidden; closeAll(); if (!open) openDevices(); });
$('#btn-account').addEventListener('click', () => { const open = !$('#pop-account').hidden; closeAll(); $('#pop-account').hidden = open; });
$('#btn-signout').addEventListener('click', () => { closeAll(); if (demo) location.reload(); else Auth.signOut('user'); });
document.addEventListener('pointerdown', e => {
  if (e.target.closest('.sheet, .popover, .topbar, .deck, .toast, .device-pill')) return;
  if (!$('#pop-devices').hidden || !$('#pop-account').hidden) { $('#pop-devices').hidden = true; $('#pop-account').hidden = true; }
});

function rowFor({ img, title, sub, dur, url, playing, onplay }) {
  const r = h('div', { class: 'row' + (playing ? ' playing' : ''), tabindex: 0, role: 'button', onclick: e => { if (!e.target.closest('.r-open')) onplay(); }, onkeydown: e => { if (e.key === 'Enter') onplay(); } },
    img ? h('img', { src: img, alt: '', loading: 'lazy', width: 48, height: 48 }) : h('div', { class: 'ph' }),
    h('div', { style: 'min-width:0' }, h('div', { class: 'r-title', title }, title), h('div', { class: 'r-sub', title: sub }, sub)),
    h('span', { class: 'r-dur' }, dur ? fmt(dur) : ''),
    url ? h('a', { class: 'r-open', href: url, target: '_blank', rel: 'noopener', title: 'Open in Spotify', 'aria-label': 'Open in Spotify' }, icon('spotify-icon')) : h('span'));
  return r;
}
const skeletons = n => Array.from({ length: n }, () => h('div', { class: 'skeleton' }));

/* ---- search ---- */
let searchCtl = null, searchTimer = null;
$('#q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('#q').value.trim();
  if (!q) { $('#search-results').replaceChildren(h('p', { class: 'muted center' }, 'Search Spotify for songs and albums.')); return; }
  searchTimer = setTimeout(() => runSearch(q), 380); // debounce: one request per pause in typing
});
async function runSearch(q) {
  if (demo) { $('#search-results').replaceChildren(h('p', { class: 'note' }, 'Search needs a Spotify connection. Sign in to search the catalogue.')); return; }
  searchCtl?.abort(); searchCtl = new AbortController();
  const box = $('#search-results'); box.replaceChildren(...skeletons(5));
  try {
    const r = await Spotify.search(q, searchCtl.signal);
    const tracks = r?.tracks?.items?.filter(Boolean) || [], albums = r?.albums?.items?.filter(Boolean) || [];
    const out = [];
    if (tracks.length) out.push(h('div', { class: 'section-title' }, 'Songs'), ...tracks.map(t => rowFor({
      img: pickImage(t.album?.images, 64), title: t.name, sub: `${artistNames(t.artists)} · ${t.album?.name || ''}`, dur: t.duration_ms, url: t.external_urls?.spotify,
      playing: player.state.item?.uri === t.uri,
      onplay: () => player.playThis(t.album?.uri ? { context_uri: t.album.uri, offset: { uri: t.uri } } : { uris: [t.uri] }),
    })));
    if (albums.length) out.push(h('div', { class: 'section-title' }, 'Albums'), ...albums.map(a => rowFor({
      img: pickImage(a.images, 64), title: a.name, sub: `${artistNames(a.artists)} · ${(a.release_date || '').slice(0, 4)}`, url: a.external_urls?.spotify,
      onplay: () => player.playThis({ context_uri: a.uri }),
    })));
    box.replaceChildren(...(out.length ? out : [h('p', { class: 'muted center' }, `No results for “${q}”.`)]));
  } catch (e) { if (e.name !== 'AbortError') { box.replaceChildren(h('p', { class: 'note' }, e.message)); } }
}

/* ---- library ---- */
let currentTab = 'playlists';
$$('.tab').forEach(t => t.addEventListener('click', () => showLibraryTab(t.dataset.tab)));
async function showLibraryTab(tab, offset = 0) {
  currentTab = tab;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const body = $('#library-body');
  if (demo) { body.replaceChildren(h('p', { class: 'note' }, 'Your playlists, saved albums and liked songs appear here after you sign in.')); return; }
  if (!offset) body.replaceChildren(...skeletons(6));
  try {
    let rows = [], page;
    if (tab === 'playlists') {
      page = await Spotify.myPlaylists(30, offset);
      rows = (page?.items || []).filter(Boolean).map(p => rowFor({
        img: pickImage(p.images, 64), title: p.name, sub: `Playlist · ${p.owner?.display_name || ''}${(p.items?.total ?? p.tracks?.total) != null ? ` · ${p.items?.total ?? p.tracks?.total} items` : ''}`,
        url: p.external_urls?.spotify, playing: player.state.context === p.uri, onplay: () => openPlaylist(p),
      }));
    } else if (tab === 'albums') {
      page = await Spotify.savedAlbums(30, offset);
      rows = (page?.items || []).map(x => x.album).filter(Boolean).map(a => rowFor({
        img: pickImage(a.images, 64), title: a.name, sub: `Album · ${artistNames(a.artists)}`, url: a.external_urls?.spotify,
        playing: player.state.context === a.uri, onplay: () => openAlbum(a),
      }));
    } else {
      page = await Spotify.savedTracks(50, offset);
      const tracks = (page?.items || []).map(x => x.track).filter(Boolean);
      rows = tracks.map((t, i) => rowFor({
        img: pickImage(t.album?.images, 64), title: t.name, sub: artistNames(t.artists), dur: t.duration_ms, url: t.external_urls?.spotify,
        playing: player.state.item?.uri === t.uri, onplay: () => player.playThis({ uris: tracks.slice(i).map(x => x.uri) }),
      }));
    }
    if (!offset) body.replaceChildren();
    body.querySelector('.more')?.remove();
    if (!rows.length && !offset) body.append(h('p', { class: 'muted center' }, 'Nothing here yet.'));
    body.append(...rows);
    if (page?.next) body.append(h('button', { class: 'chip more', style: 'display:block;margin:12px auto', onclick: () => showLibraryTab(tab, offset + (page.limit || rows.length)) }, 'Load more'));
  } catch (e) { body.replaceChildren(h('p', { class: 'note' }, e.message)); }
}
function detailHeader({ img, title, sub, url, onplay }) {
  return h('div', {},
    h('button', { class: 'chip back-btn', onclick: () => showLibraryTab(currentTab) }, '‹ Back'),
    h('div', { class: 'pl-header' },
      img ? h('img', { src: img, alt: `Cover of ${title}` }) : h('div', { class: 'ph' }),
      h('div', { style: 'min-width:0' }, h('div', { class: 't' }, title), h('div', { class: 's' }, sub),
        h('div', { style: 'display:flex;gap:8px;align-items:center' },
          h('button', { class: 'chip', onclick: onplay }, '▶ Play'),
          url ? h('a', { class: 'open-spotify', href: url, target: '_blank', rel: 'noopener' }, icon('spotify-icon'), 'Open in Spotify') : null))));
}
async function openPlaylist(p) {
  const body = $('#library-body');
  body.replaceChildren(detailHeader({ img: pickImage(p.images, 300), title: p.name, sub: `Playlist by ${p.owner?.display_name || ''}`, url: p.external_urls?.spotify, onplay: () => player.playThis({ context_uri: p.uri }) }), ...skeletons(5));
  try {
    const page = await Spotify.playlistItems(p.id, 50);
    body.querySelectorAll('.skeleton').forEach(s => s.remove());
    const entries = (page?.items || []).map(x => x.item ?? x.track).filter(t => t && t.uri);
    if (!entries.length) { body.append(h('p', { class: 'note' }, 'Spotify only lists the songs of playlists you own or collaborate on. Press Play to listen to it.')); return; }
    body.append(...entries.map(t => rowFor({
      img: pickImage(t.album?.images || t.images, 64), title: t.name, sub: artistNames(t.artists) || t.show?.name || '', dur: t.duration_ms, url: t.external_urls?.spotify,
      playing: player.state.item?.uri === t.uri, onplay: () => player.playThis({ context_uri: p.uri, offset: { uri: t.uri } }),
    })));
  } catch (e) {
    body.querySelectorAll('.skeleton').forEach(s => s.remove());
    body.append(h('p', { class: 'note' }, e instanceof SpotifyError && e.status === 403 ? 'Spotify only lists the songs of playlists you own or collaborate on. Press Play to listen to it.' : e.message));
  }
}
async function openAlbum(a) {
  const body = $('#library-body');
  body.replaceChildren(detailHeader({ img: pickImage(a.images, 300), title: a.name, sub: `${artistNames(a.artists)} · ${(a.release_date || '').slice(0, 4)}`, url: a.external_urls?.spotify, onplay: () => player.playThis({ context_uri: a.uri }) }), ...skeletons(5));
  try {
    const page = await Spotify.albumTracks(a.id, 50);
    body.querySelectorAll('.skeleton').forEach(s => s.remove());
    body.append(...(page?.items || []).map(t => rowFor({
      img: null, title: `${t.track_number}. ${t.name}`, sub: artistNames(t.artists), dur: t.duration_ms, url: t.external_urls?.spotify,
      playing: player.state.item?.uri === t.uri, onplay: () => player.playThis({ context_uri: a.uri, offset: { uri: t.uri } }),
    })));
    body.querySelectorAll('.row .ph').forEach(p => p.remove());
    body.querySelectorAll('.row').forEach(r => r.style.gridTemplateColumns = '1fr auto auto');
  } catch (e) { body.querySelectorAll('.skeleton').forEach(s => s.remove()); body.append(h('p', { class: 'note' }, e.message)); }
}

/* ---- devices ---- */
async function openDevices() {
  const pop = $('#pop-devices'); pop.hidden = false;
  const list = $('#device-list');
  if (demo) { list.replaceChildren(h('button', { class: 'row-btn active' }, icon('i-device'), h('span', {}, 'Demo deck', h('small', {}, 'Sign in to see your Spotify devices')))); return; }
  list.replaceChildren(h('div', { class: 'skeleton', style: 'height:44px' }));
  try {
    const r = await Spotify.devices();
    const devs = r?.devices || [];
    if (player.sdkDeviceId && !devs.some(d => d.id === player.sdkDeviceId)) devs.unshift({ id: player.sdkDeviceId, name: 'This browser', type: 'Computer', is_active: player.state.device?.id === player.sdkDeviceId });
    const rows = devs.map(d => h('button', { class: 'row-btn' + (d.is_active ? ' active' : ''), disabled: d.is_restricted || !d.id, onclick: () => { closeAll(); player.transferTo(d.id); } },
      icon('i-device'), h('span', {}, d.id === player.sdkDeviceId ? 'This browser' : d.name, h('small', {}, `${d.type}${d.is_active ? ' · playing' : ''}${d.is_restricted ? ' · can\'t be controlled' : ''}`))));
    list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'note' }, 'No devices found. Open Spotify on your phone or computer, then try again.')]));
  } catch (e) { list.replaceChildren(h('p', { class: 'note' }, e.message)); }
}

/* ------------------------------------------------------------------ boot */
(async () => {
  try {
    const signedIn = await Auth.init();
    if (signedIn) startApp(false); else showSetup();
  } catch (e) { showSetup(e.message); }
})();
