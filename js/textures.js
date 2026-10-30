// Print designs for the 3D props: cover-art prints (owner's choice — note this deviates from
// Spotify's artwork guidelines) plus procedural typographic fallbacks used while art loads
// or when no artwork is available.
import * as THREE from 'three';

const DISPLAY = '"Fraunces", "Iowan Old Style", Georgia, serif';
const SANS = '"Manrope", "Helvetica Neue", Arial, sans-serif';

export function hashString(s = '') {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let t = seed >>> 0;
  return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}

/** Fallback palette derived from an id when the cover can't be sampled. */
export function paletteFromSeed(seed) {
  const r = rng(hashString(seed));
  const h = r() * 360;
  return [
    `hsl(${h} 70% 55%)`,
    `hsl(${(h + 40 + r() * 80) % 360} 65% 38%)`,
    `hsl(${(h + 180 + r() * 40) % 360} 80% 70%)`,
  ].map(c => '#' + new THREE.Color().setStyle(c).getHexString());
}

function lum(hex) { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }
function inkOn(hex) { return lum(hex) > 0.45 ? '#121212' : '#fbf7ef'; }

function fitText(ctx, text, maxW, size, weight, family, min = 18) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${family}`; if (ctx.measureText(text).width <= maxW) break; s -= 2; } while (s > min);
  return s;
}
function wrap(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); keep[maxLines - 1] = keep[maxLines - 1].replace(/\s*\S*$/, '') + '…'; return keep; }
  return lines;
}

function canvasTex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Booklet / insert print for a jewel case (square, 1024px).
 * @param {{title:string, subtitle?:string, kind?:string, palette:string[], seed:string}} o
 */
export function insertTexture({ title, subtitle = '', kind = 'ALBUM', palette, seed }, size = 1024) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const R = rng(hashString(seed || title));
  const [a, b, d] = palette;
  const S = size / 1024;

  // Paper base
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, a); grad.addColorStop(1, b);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);

  // Generative motif: one of three print styles, chosen by seed
  const style = Math.floor(R() * 3);
  g.save();
  if (style === 0) { // concentric rings, offset
    const cx = size * (0.55 + R() * 0.35), cy = size * (0.15 + R() * 0.35);
    for (let i = 14; i > 0; i--) {
      g.beginPath(); g.arc(cx, cy, i * 46 * S, 0, Math.PI * 2);
      g.fillStyle = i % 2 ? d : 'rgba(0,0,0,0.0)'; g.globalAlpha = 0.22 + (i % 3) * 0.08; g.fill();
    }
  } else if (style === 1) { // bauhaus blocks
    g.globalAlpha = 0.9;
    g.fillStyle = d; g.fillRect(size * 0.58, 0, size * 0.42, size * 0.42);
    g.beginPath(); g.arc(size * 0.58, size * 0.42, size * 0.2, Math.PI, Math.PI * 1.5); g.lineTo(size * 0.58, size * 0.42); g.fillStyle = b; g.fill();
    g.globalAlpha = 0.5; g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(size * 0.79, size * 0.21, size * 0.08, 0, Math.PI * 2); g.fill();
  } else { // halftone sweep
    g.fillStyle = d;
    const step = 28 * S;
    for (let y = 0; y < size * 0.62; y += step) for (let x = 0; x < size; x += step) {
      const r = (Math.sin(x / size * 3 + R() * 0.2) * 0.5 + 0.5) * (1 - y / (size * 0.62)) * step * 0.48;
      g.globalAlpha = 0.75; g.beginPath(); g.arc(x + step / 2, y + step / 2, Math.max(0.5, r), 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();

  // Paper grain
  const img = g.getImageData(0, 0, size, size); const px = img.data;
  for (let i = 0; i < px.length; i += 4) { const n = (Math.random() - 0.5) * 14; px[i] += n; px[i + 1] += n; px[i + 2] += n; }
  g.putImageData(img, 0, 0);

  // Typography
  const ink = inkOn(b);
  const pad = 72 * S;
  g.fillStyle = ink; g.textBaseline = 'alphabetic';
  g.font = `700 ${22 * S}px ${SANS}`; g.globalAlpha = 0.85;
  g.fillText(kind.toUpperCase().split('').join(' '), pad, size * 0.62 + 10 * S);
  g.globalAlpha = 1;
  g.fillRect(pad, size * 0.62 + 26 * S, 64 * S, 4 * S);

  let ts = 112 * S; g.font = `600 ${ts}px ${DISPLAY}`;
  let lines = wrap(g, title, size - pad * 2, 3);
  while (lines.some(l => g.measureText(l).width > size - pad * 2) && ts > 40 * S) { ts -= 4 * S; g.font = `600 ${ts}px ${DISPLAY}`; lines = wrap(g, title, size - pad * 2, 3); }
  if (lines.length === 3) { ts *= 0.82; g.font = `600 ${ts}px ${DISPLAY}`; lines = wrap(g, title, size - pad * 2, 3); }
  let y = size * 0.62 + 40 * S + ts;
  for (const l of lines) { g.fillText(l, pad, y); y += ts * 1.02; }

  if (subtitle) {
    fitText(g, subtitle, size - pad * 2, 38 * S, 500, SANS);
    g.globalAlpha = 0.85; g.fillText(subtitle, pad, Math.min(size - pad, y + 18 * S));
  }
  return canvasTex(c);
}

/**
 * Printed disc face. Transparent where there is no ink, so the iridescent
 * aluminium layer shows through and the spin reads clearly.
 */
export function labelTexture({ track, album, artists, palette, seed }, size = 1024) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const cx = size / 2, cy = size / 2;
  const S = size / 1024;
  const R = rng(hashString(seed || album || track));
  const [a, b, d] = palette;
  // Disc geometry mapping: full texture = disc radius 0.6 units -> 512px
  const px = r => (r / 0.6) * (size / 2);
  const rIn = px(0.235), rOut = px(0.585);

  // Main ink band (a ring with a gap of bare metal)
  const sweep = Math.PI * (1.25 + R() * 0.55);
  const start = R() * Math.PI * 2;
  g.beginPath(); g.arc(cx, cy, rOut, start, start + sweep); g.arc(cx, cy, rIn + 40 * S, start + sweep, start, true); g.closePath();
  const grad = g.createLinearGradient(0, 0, size, size); grad.addColorStop(0, a); grad.addColorStop(1, b);
  g.fillStyle = grad; g.fill();

  // Thin rings
  g.lineWidth = 3 * S; g.strokeStyle = d; g.globalAlpha = 0.9;
  for (const r of [rIn + 10 * S, rIn + 22 * S, rOut - 8 * S]) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
  g.globalAlpha = 1;

  // Accent dot
  const ang = start + sweep + 0.35;
  g.fillStyle = d; g.beginPath(); g.arc(cx + Math.cos(ang) * (rOut - 70 * S), cy + Math.sin(ang) * (rOut - 70 * S), 34 * S, 0, Math.PI * 2); g.fill();

  // Curved text helper
  function arcText(text, radius, startAngle, fontPx, weight, family, color, spacing = 1.0) {
    g.save(); g.font = `${weight} ${fontPx}px ${family}`; g.fillStyle = color; g.textBaseline = 'middle';
    let a0 = startAngle;
    for (const ch of text) {
      const w = g.measureText(ch).width * spacing;
      const da = w / radius;
      g.save(); g.translate(cx, cy); g.rotate(a0 + da / 2); g.translate(0, -radius); g.fillText(ch, -w / 2 / spacing, 0); g.restore();
      a0 += da;
    }
    g.restore();
    return a0;
  }

  const ink = inkOn(a);
  const titleText = (track || album || '').toUpperCase();
  const maxChars = 46;
  const shownTitle = titleText.length > maxChars ? titleText.slice(0, maxChars - 1) + '…' : titleText;
  // Title follows the ink band; artist + album on the inner ring
  arcText(shownTitle, rOut - 46 * S, start + Math.PI / 2 + 0.12, 40 * S, 800, SANS, ink, 1.08);
  const sub = [artists, album].filter(Boolean).join('  ·  ');
  const subShown = sub.length > 70 ? sub.slice(0, 69) + '…' : sub;
  arcText(subShown, rIn + 48 * S, start + Math.PI / 2 + 0.1, 24 * S, 600, SANS, ink, 1.12);

  return canvasTex(c);
}

/** Tangential anisotropy direction map for the brushed/grooved CD look. */
export function grooveAnisotropyTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1) - 0.5, v = y / (size - 1) - 0.5;
    const len = Math.hypot(u, v) || 1;
    // direction perpendicular to the radius (tangent to the grooves)
    const dx = -v / len, dy = u / len;
    const i = (y * size + x) * 4;
    data[i] = (dx * 0.5 + 0.5) * 255; data[i + 1] = (dy * 0.5 + 0.5) * 255; data[i + 2] = 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  return t;
}

/** Soft radial shadow blob. */
export function shadowTexture(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.18)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ---------- cover-art prints (user preference: cover on the CD and in the case) ---------- */
const loader = new THREE.ImageLoader(); loader.setCrossOrigin('anonymous');
const imgCache = new Map(); // in-memory for this session only
export function loadImage(url) {
  if (!url) return Promise.reject(new Error('no url'));
  if (!imgCache.has(url)) {
    const p = loader.loadAsync(url);
    p.catch(() => imgCache.delete(url));
    imgCache.set(url, p);
    if (imgCache.size > 80) imgCache.delete(imgCache.keys().next().value);
  }
  return imgCache.get(url);
}

/** Square cover texture for a jewel-case insert. */
export function coverTexture(img) {
  const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

/** Cover art printed on the disc's label ring (the square art spans the disc's diameter). */
export function discArtTexture(img, palette, size = 1024) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const cx = size / 2, px = r => (r / 0.6) * (size / 2);
  const rIn = px(0.225), rOut = px(0.592);
  g.save();
  g.beginPath(); g.arc(cx, cx, rOut, 0, Math.PI * 2); g.arc(cx, cx, rIn, 0, Math.PI * 2, true); g.clip('evenodd');
  g.drawImage(img, 0, 0, size, size);
  g.restore();
  // printed edge rings, like a real picture disc
  g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.beginPath(); g.arc(cx, cx, rIn + 2, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = palette?.[2] || 'rgba(255,255,255,0.5)'; g.globalAlpha = 0.6;
  g.beginPath(); g.arc(cx, cx, rIn + 10, 0, Math.PI * 2); g.stroke();
  return canvasTex(c);
}
