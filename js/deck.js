// The physical CD player: an original design. A brushed-aluminium slab with a porthole
// window behind a hinged glass door, a VFD display, push buttons, a volume knob and an
// LED progress ring around the window.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';

export const PW = 3.2, PH = 2.0, PD = 0.32;
const FZ = PD / 2;                // front face z
export const WIN = { x: -0.66, y: 0, r: 0.74 };

/* ---------- icons (drawn with Path2D) ---------- */
const ICONS = {
  play: { d: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z', fill: true },
  pause: { d: 'M7.2 5h3.6a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7.2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm6 0h3.6a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3.6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', fill: true },
  next: { d: 'M5 6.2v11.6a.9.9 0 0 0 1.38.76L15 13v4.8a1 1 0 0 0 1 1h1.5a1 1 0 0 0 1-1V6.2a1 1 0 0 0-1-1H16a1 1 0 0 0-1 1V11L6.38 5.44A.9.9 0 0 0 5 6.2z', fill: true },
  prev: { d: 'M5 6.2v11.6a.9.9 0 0 0 1.38.76L15 13v4.8a1 1 0 0 0 1 1h1.5a1 1 0 0 0 1-1V6.2a1 1 0 0 0-1-1H16a1 1 0 0 0-1 1V11L6.38 5.44A.9.9 0 0 0 5 6.2z', fill: true, flip: true },
  shuffle: { d: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5', fill: false },
  repeat: { d: 'M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3', fill: false },
  heart: { d: 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z', fill: true },
  eject: { d: 'M12 4 4 14h16zM4 17h16v3H4z', fill: true },
};
function iconTexture(name, color = '#ffffff', size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const ic = ICONS[name];
  g.translate(size / 2, size / 2); g.scale(size / 24 * 0.52, size / 24 * 0.52); if (ic.flip) g.scale(-1, 1); g.translate(-12, -12);
  const p = new Path2D(ic.d);
  g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 2;
  if (ic.fill) { g.fillStyle = color; g.fill(p); } else { g.strokeStyle = color; g.lineWidth = 2.3; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(p); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/* ---------- engraved labels ---------- */
function engravingTexture(labels, w = 2048, h = 1280) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const l of labels) {
    g.font = `${l.weight || 700} ${l.size}px "Manrope", "Helvetica Neue", Arial, sans-serif`;
    if (l.spacing) g.letterSpacing = l.spacing + 'px';
    const x = (l.x / PW + 0.5) * w, y = (0.5 - l.y / PH) * h;
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillText(l.text, x, y + 2); // highlight edge
    g.fillStyle = 'rgba(20,22,28,0.72)'; g.fillText(l.text, x, y);
    g.letterSpacing = '0px';
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/* ---------- arc ring shader (progress + volume) ---------- */
const ringVert = /* glsl */`varying vec2 vUv; varying vec3 vPos; void main(){ vUv = uv; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const ringFrag = /* glsl */`
  precision highp float; varying vec3 vPos;
  uniform float uValue, uStart, uSweep, uTime, uInner, uOuter, uPlaying;
  uniform vec3 uColor, uColor2;
  #define PI 3.14159265
  void main(){
    float r = length(vPos.xy);
    float a = atan(vPos.x, vPos.y);                 // 0 at top, clockwise positive
    float t = mod(a - uStart + 2.0*PI, 2.0*PI) / uSweep;
    float inArc = step(t, 1.0);
    float on = inArc * step(t, uValue);
    float band = smoothstep(uInner, uInner + 0.006, r) * (1.0 - smoothstep(uOuter - 0.006, uOuter, r));
    // segmented LED look
    float seg = smoothstep(0.08, 0.2, abs(fract(t * 96.0) - 0.5) * 2.0);
    vec3 col = mix(uColor, uColor2, t);
    float head = exp(-pow((t - uValue) * 40.0, 2.0)) * on * (0.6 + 0.4 * sin(uTime * 6.0)) * uPlaying;
    vec3 lit = col * (1.4 + head * 2.0);
    vec3 off = vec3(0.06, 0.065, 0.075);
    vec3 c = mix(off, lit, on) * mix(1.0, seg, 0.55);
    float alpha = band * inArc * (on > 0.5 ? 1.0 : 0.85);
    gl_FragColor = vec4(c, alpha);
    #include <colorspace_fragment>
  }`;
function arcRing(inner, outer, startRad, sweepRad) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: ringVert, fragmentShader: ringFrag, transparent: true, depthWrite: false,
    uniforms: { uValue: { value: 0 }, uStart: { value: startRad }, uSweep: { value: sweepRad }, uTime: { value: 0 }, uInner: { value: inner }, uOuter: { value: outer }, uPlaying: { value: 0 }, uColor: { value: new THREE.Color('#7af0ff') }, uColor2: { value: new THREE.Color('#c58cff') } },
  });
  return new THREE.Mesh(new THREE.RingGeometry(inner, outer, 160, 1), mat);
}

/* ---------- VFD display ---------- */
class Display {
  constructor() {
    this.c = document.createElement('canvas'); this.c.width = 1024; this.c.height = 360;
    this.g = this.c.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.c); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.data = {}; this.sig = ''; this.scroll = 0; this.lastDraw = 0;
  }
  set(d) { Object.assign(this.data, d); }
  draw(now) {
    const d = this.data;
    const titleW = this._titleW || 0;
    const needsScroll = titleW > 940;
    const sig = JSON.stringify([d.title, d.sub, d.time, d.dur, d.playing, d.shuffle, d.repeat, d.device, d.msg, needsScroll ? Math.floor(now / 50) : 0]);
    if (sig === this.sig) return; this.sig = sig;
    const g = this.g, W = 1024, H = 360;
    g.clearRect(0, 0, W, H);
    const glow = '#86fff0', dim = 'rgba(134,255,240,0.09)';
    g.fillStyle = '#05100f'; g.fillRect(0, 0, W, H);
    // VFD mesh grid
    g.fillStyle = 'rgba(134,255,240,0.03)'; for (let x = 0; x < W; x += 6) g.fillRect(x, 0, 1, H);
    g.shadowColor = glow; g.shadowBlur = 14; g.fillStyle = glow;
    const mono = '"SFMono-Regular", ui-monospace, Menlo, Consolas, monospace';
    if (d.msg) {
      g.font = `700 64px ${mono}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(d.msg, W / 2, H / 2); this.tex.needsUpdate = true; return;
    }
    // Title (marquee if long)
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = `700 76px "Manrope", "Helvetica Neue", Arial, sans-serif`;
    const title = (d.title || '').toUpperCase();
    this._titleW = g.measureText(title).width;
    g.save(); g.beginPath(); g.rect(40, 20, W - 80, 110); g.clip();
    if (this._titleW > W - 80) {
      const gap = 120, span = this._titleW + gap; const off = (now / 22) % span;
      g.fillText(title, 40 - off, 106); g.fillText(title, 40 - off + span, 106);
    } else g.fillText(title, 40, 106);
    g.restore();
    g.font = `600 40px "Manrope", "Helvetica Neue", Arial, sans-serif`;
    let sub = d.sub || ''; while (sub && g.measureText(sub).width > W - 80) sub = sub.slice(0, -2) + '…';
    g.globalAlpha = 0.85; g.fillText(sub, 40, 172); g.globalAlpha = 1;
    // Bottom status row
    g.font = `700 54px ${mono}`;
    g.fillText(`${d.time || '0:00'}`, 40, 300);
    g.globalAlpha = 0.6; g.font = `600 36px ${mono}`; g.fillText(`/ ${d.dur || '0:00'}`, 40 + g.measureText('00:00').width * 1.45, 300); g.globalAlpha = 1;
    const ind = (txt, on, x) => { g.font = `800 30px ${mono}`; g.fillStyle = on ? glow : dim; g.shadowBlur = on ? 14 : 0; g.fillText(txt, x, 300); g.fillStyle = glow; g.shadowBlur = 14; };
    ind(d.playing ? '▶ PLAY' : '❚❚ PAUSE', true, 560);
    ind('SHUF', d.shuffle, 770);
    ind(d.repeat === 'track' ? 'RPT1' : 'RPT', d.repeat && d.repeat !== 'off', 880);
    g.font = `600 26px ${mono}`; g.globalAlpha = 0.55; g.textAlign = 'right';
    let dev = (d.device || '').toUpperCase(); if (dev.length > 26) dev = dev.slice(0, 25) + '…';
    g.fillText(dev, W - 40, 236); g.globalAlpha = 1; g.textAlign = 'left';
    this.tex.needsUpdate = true;
  }
}

/* ---------- button geometry: rounded cap via lathe ---------- */
function capGeometry(r, h) {
  const pts = [];
  pts.push(new THREE.Vector2(0, 0));
  pts.push(new THREE.Vector2(r, 0));
  const bev = Math.min(r * 0.35, h * 0.8);
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; pts.push(new THREE.Vector2(r - bev + Math.cos(a) * bev, h - bev + Math.sin(a) * bev)); }
  for (let i = 1; i <= 6; i++) { const t = i / 6; pts.push(new THREE.Vector2((r - bev) * (1 - t), h + Math.sin(t * Math.PI / 2) * h * 0.08)); }
  const geo = new THREE.LatheGeometry(pts, 64);
  geo.rotateX(Math.PI / 2); // axis -> +z
  return geo;
}

export function createDeck({ envIntensity = 1 } = {}) {
  const deck = new THREE.Group();

  /* materials */
  const alu = new THREE.MeshPhysicalMaterial({ color: '#a4a8b0', metalness: 1, roughness: 0.36, envMapIntensity: 0.75, anisotropy: 0.75, anisotropyRotation: 0, clearcoat: 0.35, clearcoatRoughness: 0.25 });
  const aluDark = new THREE.MeshPhysicalMaterial({ color: '#3a3d44', metalness: 1, roughness: 0.38, clearcoat: 0.5 });
  const chrome = new THREE.MeshPhysicalMaterial({ color: '#e8ebf0', metalness: 1, roughness: 0.08 });
  const cavity = new THREE.MeshPhysicalMaterial({ color: '#0b0c10', metalness: 0.3, roughness: 0.55, clearcoat: 0.6 });
  // transparent (not transmissive) glass: cheap enough for phones, still catches reflections
  const glass = new THREE.MeshPhysicalMaterial({ color: '#eaf4ff', metalness: 0, roughness: 0.02, transparent: true, opacity: 0.16, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 1.6, depthWrite: false });
  const btnGlass = new THREE.MeshPhysicalMaterial({ color: '#2a2d36', metalness: 0.2, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.4, sheenColor: new THREE.Color('#ffffff') });
  const playMat = new THREE.MeshPhysicalMaterial({ color: '#7c5cff', metalness: 0.1, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03, emissive: new THREE.Color('#7c5cff'), emissiveIntensity: 0.18 });

  /* body */
  const body = new THREE.Mesh(new RoundedBoxGeometry(PW, PH, PD, 4, 0.16), alu); deck.add(body);
  const back = new THREE.Mesh(new RoundedBoxGeometry(PW - 0.12, PH - 0.12, 0.08, 4, 0.04), aluDark); back.position.z = -FZ - 0.02; deck.add(back);
  // engraved labels
  const lab = [
    { text: 'PREV', x: 0.34, y: -0.245, size: 24, spacing: 6 },
    { text: 'PLAY / PAUSE', x: 0.82, y: -0.31, size: 24, spacing: 6 },
    { text: 'NEXT', x: 1.3, y: -0.245, size: 24, spacing: 6 },
    { text: 'SHUFFLE', x: 0.3, y: -0.84, size: 22, spacing: 5 },
    { text: 'REPEAT', x: 0.6, y: -0.84, size: 22, spacing: 5 },
    { text: 'LOVE', x: 0.9, y: -0.84, size: 22, spacing: 5 },
    { text: 'VOLUME', x: 1.27, y: -0.925, size: 22, spacing: 5 },
    { text: 'JEWELCASE  ·  CD-01', x: WIN.x, y: -0.9, size: 26, spacing: 10, weight: 800 },
  ];
  const engr = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshStandardMaterial({ map: engravingTexture(lab), transparent: true, depthWrite: false, roughness: 0.6 }));
  engr.position.z = FZ + 0.001; deck.add(engr);

  /* porthole */
  const win = new THREE.Group(); win.position.set(WIN.x, WIN.y, FZ); deck.add(win);
  const well = new THREE.Mesh(new THREE.CircleGeometry(WIN.r, 96), cavity); well.position.z = 0.002; win.add(well);
  const wellWall = new THREE.Mesh(new THREE.CylinderGeometry(WIN.r, WIN.r, 0.12, 96, 1, true), new THREE.MeshPhysicalMaterial({ color: '#16171c', metalness: 0.6, roughness: 0.4, side: THREE.BackSide }));
  wellWall.rotation.x = Math.PI / 2; wellWall.position.z = 0.06; win.add(wellWall);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(WIN.r + 0.012, 0.028, 24, 160), chrome); bezel.position.z = 0.12; win.add(bezel);
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.07, 48), chrome); spindle.rotation.x = Math.PI / 2; spindle.position.z = 0.05; win.add(spindle);
  const progress = arcRing(WIN.r + 0.07, WIN.r + 0.13, 0, Math.PI * 2); progress.position.z = 0.003; win.add(progress);
  // anchor where a docked disc sits
  const anchor = new THREE.Object3D(); anchor.position.z = 0.055; win.add(anchor);
  // glass door, hinged at the top
  const doorPivot = new THREE.Group(); doorPivot.position.set(0, WIN.r + 0.04, 0.135); win.add(doorPivot);
  const door = new THREE.Mesh(new THREE.CylinderGeometry(WIN.r + 0.02, WIN.r + 0.02, 0.028, 128), glass);
  door.rotation.x = Math.PI / 2; door.position.y = -(WIN.r + 0.04); doorPivot.add(door);
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.32, 24), chrome); hinge.rotation.z = Math.PI / 2; doorPivot.add(hinge);
  const doorTab = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.05, 0.04, 2, 0.015), chrome); doorTab.position.set(0, -(WIN.r * 2 + 0.07), 0.02); doorPivot.add(doorTab);

  /* display */
  const display = new Display();
  const dispFrame = new THREE.Mesh(new RoundedBoxGeometry(1.32, 0.52, 0.04, 3, 0.03), new THREE.MeshPhysicalMaterial({ color: '#0a0b0e', metalness: 0.4, roughness: 0.3, clearcoat: 1 }));
  dispFrame.position.set(0.82, 0.5, FZ + 0.005); deck.add(dispFrame);
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(1.22, 0.43), new THREE.MeshBasicMaterial({ map: display.tex, toneMapped: false }));
  disp.position.set(0.82, 0.5, FZ + 0.027); deck.add(disp);
  const dispGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.45), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.08, roughness: 0.02, clearcoat: 1, depthWrite: false }));
  dispGlass.position.set(0.82, 0.5, FZ + 0.03); deck.add(dispGlass);

  /* buttons */
  const controls = [];
  function button(action, icon, x, y, r, mat = btnGlass, h = 0.07) {
    const g = new THREE.Group(); g.position.set(x, y, FZ);
    const well = new THREE.Mesh(new THREE.RingGeometry(r * 1.0, r * 1.14, 64), new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.6 })); well.position.z = 0.002; g.add(well);
    const cap = new THREE.Mesh(capGeometry(r, h), mat); g.add(cap);
    const iconMat = new THREE.MeshBasicMaterial({ map: iconTexture(icon), transparent: true, depthWrite: false, toneMapped: false });
    const ic = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.25, r * 1.25), iconMat); ic.position.z = h + 0.012; cap.add(ic);
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.018, 24), new THREE.MeshBasicMaterial({ color: '#2a2f33', toneMapped: false }));
    led.position.set(0, -r - 0.07, 0.003); g.add(led);
    g.userData = { action, press: 0, pressed: false, cap, icon: ic, iconName: icon, led, r };
    cap.userData.control = g; ic.userData.control = g;
    deck.add(g); controls.push(g);
    return g;
  }
  const bPrev = button('prev', 'prev', 0.34, -0.08, 0.13);
  const bPlay = button('play', 'play', 0.82, -0.08, 0.19, playMat, 0.09);
  const bNext = button('next', 'next', 1.3, -0.08, 0.13);
  const bShuf = button('shuffle', 'shuffle', 0.3, -0.6, 0.095);
  const bRep = button('repeat', 'repeat', 0.6, -0.6, 0.095);
  const bLove = button('love', 'heart', 0.9, -0.6, 0.095);
  bPlay.userData.led.visible = bPrev.userData.led.visible = bNext.userData.led.visible = false;

  /* volume knob */
  const knob = new THREE.Group(); knob.position.set(1.27, -0.59, FZ); deck.add(knob);
  const knobBody = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.215, 0.13, 72, 1), new THREE.MeshPhysicalMaterial({ color: '#d6d9df', metalness: 1, roughness: 0.22, anisotropy: 0.9, anisotropyRotation: Math.PI / 2 }));
  knobBody.rotation.x = Math.PI / 2; knobBody.position.z = 0.065; knob.add(knobBody);
  const knobTop = new THREE.Mesh(new THREE.CircleGeometry(0.19, 72), new THREE.MeshPhysicalMaterial({ color: '#e3e6ea', metalness: 1, roughness: 0.15, clearcoat: 1 }));
  knobTop.position.z = 0.131; knob.add(knobTop);
  // grip ridges
  const ridges = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.03, 0.12), aluDark, 36);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler();
  for (let i = 0; i < 36; i++) {
    const a = i / 36 * Math.PI * 2;
    m4.compose(new THREE.Vector3(Math.sin(a) * 0.212, Math.cos(a) * 0.212, 0.065), q4.setFromEuler(e4.set(0, 0, -a)), new THREE.Vector3(1, 1, 1));
    ridges.setMatrixAt(i, m4);
  }
  knob.add(ridges);
  const knobSpin = new THREE.Group(); knob.add(knobSpin);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.02, 24), new THREE.MeshBasicMaterial({ color: '#86fff0', toneMapped: false }));
  dot.position.set(0, 0.14, 0.133); knobSpin.add(dot);
  const volRing = arcRing(0.245, 0.275, -Math.PI * 0.75, Math.PI * 1.5); volRing.position.z = 0.003; knob.add(volRing);
  knobBody.userData.control = knob; knobTop.userData.control = knob; dot.userData.control = knob;
  knob.userData = { action: 'volume' };
  progress.userData.control = { userData: { action: 'seek' } };

  /* feet */
  for (const x of [-1.1, 1.1]) {
    const foot = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.08, 0.36, 2, 0.03), aluDark);
    foot.position.set(x, -PH / 2 - 0.03, -0.02); deck.add(foot);
  }

  const pickables = [...controls.flatMap(c => [c.userData.cap, c.userData.icon]), knobBody, knobTop, progress];

  return {
    group: deck, anchor, doorPivot, display, controls, knob, knobSpin, progress, volRing, pickables, playMat,
    setPlayIcon(playing) {
      const ic = bPlay.userData.icon; const want = playing ? 'pause' : 'play';
      if (bPlay.userData.iconName !== want) { ic.material.map.dispose(); ic.material.map = iconTexture(want); ic.material.needsUpdate = true; bPlay.userData.iconName = want; }
    },
    setLeds({ shuffle, repeat, love }) {
      bShuf.userData.led.material.color.set(shuffle ? '#86fff0' : '#2a2f33');
      bRep.userData.led.material.color.set(repeat === 'track' ? '#ffd27a' : repeat === 'context' ? '#86fff0' : '#2a2f33');
      bLove.userData.led.material.color.set(love ? '#ff6fa8' : '#2a2f33');
      bLove.userData.icon.material.color.set(love ? '#ff8fbd' : '#ffffff');
    },
    setPalette(p) {
      playMat.color.set(p[0]); playMat.emissive.set(p[0]);
      progress.material.uniforms.uColor.value.set(p[0]).lerp(new THREE.Color('#ffffff'), 0.25);
      progress.material.uniforms.uColor2.value.set(p[2]);
      volRing.material.uniforms.uColor.value.set('#86fff0'); volRing.material.uniforms.uColor2.value.set(p[2]);
    },
  };
}
