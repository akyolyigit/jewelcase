import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';
import { createDeck, PW, PH } from './deck.js';
import { insertTexture, labelTexture, grooveAnisotropyTexture, shadowTexture, paletteFromSeed, loadImage, coverTexture, discArtTexture } from './textures.js';

const DISC_R = 0.6;
const damp = THREE.MathUtils.damp;
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Ring geometry with UVs mapped to the full disc radius (so every ring shares one texture space). */
function discRing(inner, outer, segs = 128) {
  const geo = new THREE.RingGeometry(inner, outer, segs, 1);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / DISC_R / 2 + 0.5, pos.getY(i) / DISC_R / 2 + 0.5);
  return geo;
}

/* ---------------- Background shader: slow liquid light in the album palette ---------------- */
const bgVert = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const bgFrag = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform float uTime, uEnergy, uAspect;
  uniform vec3 uA, uB, uC;
  // hash / noise
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
  float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
  void main(){
    vec2 p = vUv - .5; p.x *= uAspect;
    float t = uTime * (0.03 + 0.05 * uEnergy);
    vec2 q = vec2(fbm(p*1.6 + t), fbm(p*1.6 - t + 4.1));
    float f = fbm(p*2.2 + q*1.8 + t*0.6);
    vec3 col = vec3(0.025, 0.024, 0.032);
    col = mix(col, uB * 0.55, smoothstep(0.25, 0.85, f));
    col = mix(col, uA * 0.8, smoothstep(0.55, 1.0, f + q.x*0.3) * 0.75);
    col += uC * 0.18 * smoothstep(0.6, 1.0, q.y) * (0.6 + 0.4*uEnergy);
    // studio light from above
    col += vec3(0.07) * smoothstep(0.9, 0.0, length(p - vec2(0.0, 0.55)));
    // vignette + grain
    col *= 1.0 - 0.75 * smoothstep(0.35, 1.05, length(p * vec2(0.8, 1.0)));
    col += (h(vUv * 1000.0 + uTime) - 0.5) * 0.018;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

export function createScene(canvas, { onShelfPick, onShelfHover, onControl, onVolume, onSeek } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  const mobile = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.6 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
  scene.environmentIntensity = 0.9;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  const camTarget = new THREE.Vector3(0, 0, 0);

  /* ---------- background ---------- */
  const bgUniforms = {
    uTime: { value: 0 }, uEnergy: { value: 0 }, uAspect: { value: 1 },
    uA: { value: new THREE.Color('#5b3cc4') }, uB: { value: new THREE.Color('#1c2b5a') }, uC: { value: new THREE.Color('#ff9a62') },
  };
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: bgVert, fragmentShader: bgFrag, uniforms: bgUniforms, depthWrite: false, depthTest: false }));
  bg.frustumCulled = false; bg.renderOrder = -1000; scene.add(bg);

  /* ---------- lights ---------- */
  const key = new THREE.DirectionalLight('#ffffff', 1.6); key.position.set(2.5, 4, 5); scene.add(key);
  const rimA = new THREE.PointLight('#8a6cff', 6, 8, 2); rimA.position.set(-2.6, 1.4, 1.2); scene.add(rimA);
  const rimB = new THREE.PointLight('#ff8a5c', 5, 8, 2); rimB.position.set(2.8, -0.6, 1.6); scene.add(rimB);

  /* ---------- materials ---------- */
  const anisoMap = grooveAnisotropyTexture();
  const discMetal = new THREE.MeshPhysicalMaterial({
    color: '#b9bfcc', metalness: 1, roughness: 0.2, envMapIntensity: 0.85,
    iridescence: 1, iridescenceIOR: 1.8,
    anisotropy: 0.9, anisotropyMap: anisoMap, clearcoat: 1, clearcoatRoughness: 0.05,
    side: THREE.FrontSide,
  });
  if ('iridescenceThicknessMinimum' in discMetal) { discMetal.iridescenceThicknessMinimum = 220; discMetal.iridescenceThicknessMaximum = 900; }
  else discMetal.iridescenceThicknessRange = [220, 900];
  const discClear = new THREE.MeshPhysicalMaterial({ color: '#dfe6f0', metalness: 0, roughness: 0.06, transparent: true, opacity: 0.35, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false });
  const discMirror = new THREE.MeshPhysicalMaterial({ color: '#d7dbe3', metalness: 1, roughness: 0.05, side: THREE.DoubleSide });
  const plasticDark = new THREE.MeshPhysicalMaterial({ color: '#0b0b0f', metalness: 0, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', metalness: 0, roughness: 0.03, transmission: 1, thickness: 0.06, ior: 1.5,
    clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, attenuationColor: new THREE.Color('#e8f2ff'), attenuationDistance: 2.5,
  });

  /* ---------- the CD ---------- */
  const disc = new THREE.Group();            // positioned/animated
  const discFlip = new THREE.Group();        // flip (show data side)
  const discSpin = new THREE.Group();        // rotation around its axis
  disc.add(discFlip); discFlip.add(discSpin);
  const T = 0.006; // half thickness
  const top = new THREE.Mesh(discRing(0.17, DISC_R), discMetal); top.position.z = T; discSpin.add(top);
  const bottom = new THREE.Mesh(discRing(0.17, DISC_R), discMetal); bottom.rotation.y = Math.PI; bottom.position.z = -T; discSpin.add(bottom);
  const hubF = new THREE.Mesh(discRing(0.075, 0.17, 64), discClear); hubF.position.z = T * 0.9; discSpin.add(hubF);
  const hubB = hubF.clone(); hubB.rotation.y = Math.PI; hubB.position.z = -T * 0.9; discSpin.add(hubB);
  const stack = new THREE.Mesh(discRing(0.17, 0.225, 64), discMirror); stack.position.z = T * 1.02; discSpin.add(stack);
  const labelMat = new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.38, metalness: 0, envMapIntensity: 0.55, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  const label = new THREE.Mesh(discRing(0.225, 0.59), labelMat); label.position.z = T + 0.0006; discSpin.add(label);
  const edge = new THREE.Mesh(new THREE.CylinderGeometry(DISC_R, DISC_R, T * 2, 128, 1, true), discMirror); edge.rotation.x = Math.PI / 2; discSpin.add(edge);
  const holeEdge = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, T * 2, 48, 1, true), discClear); holeEdge.rotation.x = Math.PI / 2; discSpin.add(holeEdge);
  disc.userData.pickable = true;
  disc.visible = false; scene.add(disc);

  /* ---------- the player ---------- */
  const deck = createDeck();
  const player = new THREE.Group(); player.add(deck.group); scene.add(player);
  const shadowTex = shadowTexture();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(PW * 1.2, 0.8), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, -PH / 2 - 0.08, 0.05); player.add(shadow);

  /* ---------- shelf / album stack ---------- */
  const shelf = new THREE.Group(); scene.add(shelf);
  const plank = new THREE.Mesh(new RoundedBoxGeometry(9, 0.03, 0.42, 2, 0.012), new THREE.MeshPhysicalMaterial({ color: '#cfe0ff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, clearcoat: 1, depthWrite: false }));
  const plankEdge = new THREE.Mesh(new THREE.BoxGeometry(9, 0.004, 0.004), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 }));
  plankEdge.position.set(0, 0.015, 0.21); shelf.add(plank, plankEdge);
  const W = 1.42, H = 1.25;
  const miniTrayGeo = new RoundedBoxGeometry(W, H, 0.09, 2, 0.012);
  const miniFrontGeo = new THREE.PlaneGeometry(1.24, 1.24);
  const miniGlass = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0, depthWrite: false });
  const miniGlassGeo = new RoundedBoxGeometry(W, H, 0.012, 2, 0.006);
  let shelfItems = [];
  let shelfScroll = 0, shelfScrollTarget = 0;
  const SPACING = 0.56, MINI = 0.33;
  function clearShelf() { for (const it of shelfItems) { it.group.removeFromParent(); it.tex?.dispose(); it.front.material.dispose(); } shelfItems = []; }

  /* ---------- state ---------- */
  const st = {
    t: 0, playing: false, spin: 0, spinVel: 0, door: 0, mouse: new THREE.Vector2(), hover: null, highlightKey: null,
    docked: null,          // np currently in the player
    flight: null,          // { dir:'in'|'out', np, t, from:{pos,quat,scale}, toItem }
    queue: null,           // np waiting to fly in
    press: null, knobDrag: null, volume: 60, volumeShown: 60, progress: 0,
  };
  let labelTex = null;

  function applyPalette(p) {
    bgUniforms.uA.value.set(p[0]); bgUniforms.uB.value.set(p[1]); bgUniforms.uC.value.set(p[2]);
    rimA.color.set(p[0]); rimB.color.set(p[2]); deck.setPalette(p);
  }
  function printDisc(np) {
    labelTex?.dispose();
    labelTex = np.img ? discArtTexture(np.img, np.palette) : labelTexture({ track: np.trackName, album: np.albumName, artists: np.artists, palette: np.palette, seed: np.key });
    labelMat.map = labelTex; labelMat.needsUpdate = true;
    np.printedWith = np.img ? 'art' : 'gen';
  }
  function prepareArt(np) {
    if (!np.art || np.img || np.artPending) return;
    np.artPending = true; np.artDeadline = performance.now() + 2000;
    loadImage(np.art).then(img => { np.img = img; np.artPending = false; if (st.docked === np || st.flight?.np === np) printDisc(np); })
      .catch(() => { np.artPending = false; });
  }

  /* ---------- layout ---------- */
  const layout = { portrait: false, vertical: false, dist: 6, halfW: 3, halfH: 2 };
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const portrait = w / h < 0.95;
    layout.portrait = portrait; layout.vertical = !portrait;
    const halfFovV = THREE.MathUtils.degToRad(camera.fov / 2);
    layout.dist = 7;
    const halfH = Math.tan(halfFovV) * layout.dist, halfW = halfH * camera.aspect;
    layout.halfW = halfW; layout.halfH = halfH;
    camera.updateProjectionMatrix();
    bgUniforms.uAspect.value = camera.aspect;
    if (portrait) {
      const sc = Math.min((halfW * 2 * 0.94) / PW, (halfH * 2 * 0.5) / PH);
      player.scale.setScalar(sc);
      player.position.set(0, halfH * 0.16, 0);
      shelf.scale.setScalar(Math.min(1.25, halfW / 1.3)); shelf.position.set(0, -halfH * 0.5, 0.35);
    } else {
      const col = Math.min(1.6, halfW * 0.34);          // world width of the album stack column
      layout.col = col;
      const availW = halfW * 2 - col - 0.3, availH = halfH * 2 - 1.2;
      const sc = Math.min(availW / (PW + 0.3), availH / (PH + 0.25), 1.7);
      player.scale.setScalar(sc);
      player.position.set(-halfW + col + availW / 2 + 0.1, -0.12, 0);
      shelf.scale.setScalar(1); shelf.position.set(-halfW + col * 0.5, 0, 0.4);
    }
    plank.visible = plankEdge.visible = !layout.vertical;
    if (shelfItems.length) clampShelf();
  }
  addEventListener('resize', resize);

  /* ---------- picking & interaction ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function setRay(x, y) { const r = canvas.getBoundingClientRect(); ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
  function pick(x, y) {
    setRay(x, y);
    const hits = ray.intersectObjects([...deck.pickables, ...shelfItems.map(s => s.group)], true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData.control) return { type: 'control', ctl: o.userData.control, point: h.point };
        if (o.userData.shelfIndex !== undefined) return { type: 'shelf', index: o.userData.shelfIndex };
        o = o.parent;
      }
    }
    return null;
  }
  const toScreen = v => { const p = v.clone().project(camera); const r = canvas.getBoundingClientRect(); return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; };
  function itemScreenPos(obj) { const v = new THREE.Vector3(); obj.getWorldPosition(v); if (layout.vertical) v.x += 0.34; else v.y += 0.26; return toScreen(v); }
  function knobAngleAt(x, y) { const c = new THREE.Vector3(); deck.knob.getWorldPosition(c); const s = toScreen(c); return Math.atan2(x - s.x, -(y - s.y)); }
  function seekFracAt(point) {
    const local = deck.progress.worldToLocal(point.clone());
    let a = Math.atan2(local.x, local.y); if (a < 0) a += Math.PI * 2;
    return a / (Math.PI * 2);
  }
  function inShelfZone(e) { const r = canvas.getBoundingClientRect(); return layout.vertical ? e.clientX < r.left + r.width * (layout.col / (layout.halfW * 2)) + 20 : e.clientY > r.top + r.height * 0.72; }
  function clampShelf() {
    let max = (shelfItems.length - 1) * SPACING;
    if (layout.vertical) { const fit = Math.floor((layout.halfH * 2 - 1.04) / 0.52); max = Math.max(0, shelfItems.length - fit) * SPACING; }
    shelfScrollTarget = THREE.MathUtils.clamp(shelfScrollTarget, 0, Math.max(0, max));
  }

  let downAt = null, dragShelf = null;
  canvas.addEventListener('pointermove', e => {
    st.mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (st.knobDrag) {
      const a = knobAngleAt(e.clientX, e.clientY);
      let d = a - st.knobDrag.a; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      st.knobDrag.a = a;
      st.volume = THREE.MathUtils.clamp(st.volume + d / (Math.PI * 1.5) * 100, 0, 100);
      onVolume?.(Math.round(st.volume)); return;
    }
    if (dragShelf) {
      if (layout.vertical) { const dy = e.clientY - dragShelf.y; dragShelf.y = e.clientY; shelfScrollTarget += dy / canvas.clientHeight * 6; }
      else { const dx = e.clientX - dragShelf.x; dragShelf.x = e.clientX; shelfScrollTarget -= dx / canvas.clientWidth * 5.5; }
      dragShelf.moved += 1; clampShelf(); return;
    }
    const p = pick(e.clientX, e.clientY);
    const idx = p?.type === 'shelf' ? p.index : null;
    if (idx !== st.hover) {
      st.hover = idx;
      onShelfHover?.(idx === null ? null : shelfItems[idx].data, idx === null ? null : { ...itemScreenPos(shelfItems[idx].group), side: layout.vertical });
    }
    canvas.style.cursor = p ? (p.type === 'control' && p.ctl.userData.action === 'volume' ? 'grab' : 'pointer') : 'default';
  });
  canvas.addEventListener('pointerdown', e => {
    const p = pick(e.clientX, e.clientY);
    downAt = { x: e.clientX, y: e.clientY, p };
    if (p?.type === 'control') {
      const a = p.ctl.userData.action;
      if (a === 'volume') { st.knobDrag = { a: knobAngleAt(e.clientX, e.clientY) }; canvas.style.cursor = 'grabbing'; }
      else if (a === 'seek') { onSeek?.(seekFracAt(p.point)); }
      else { st.press = p.ctl; p.ctl.userData.pressed = true; }
      canvas.setPointerCapture(e.pointerId);
    } else if (inShelfZone(e)) { dragShelf = { x: e.clientX, y: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); }
  });
  canvas.addEventListener('pointerup', e => {
    const moved = downAt ? Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) : 99;
    if (st.press) {
      const p = pick(e.clientX, e.clientY);
      if (p?.ctl === st.press) onControl?.(st.press.userData.action);
      st.press.userData.pressed = false; st.press = null;
    } else if (st.knobDrag) { st.knobDrag = null; canvas.style.cursor = 'grab'; }
    else if (moved < 8 && downAt?.p?.type === 'shelf') { const it = shelfItems[downAt.p.index]; onShelfPick?.(it.data); }
    dragShelf = null; downAt = null;
  });
  canvas.addEventListener('pointercancel', () => { if (st.press) { st.press.userData.pressed = false; st.press = null; } st.knobDrag = null; dragShelf = null; });
  canvas.addEventListener('pointerleave', () => { if (st.hover !== null) { st.hover = null; onShelfHover?.(null); } });
  canvas.addEventListener('wheel', e => {
    if (pick(e.clientX, e.clientY)?.ctl === deck.knob) { st.volume = THREE.MathUtils.clamp(st.volume - e.deltaY * 0.05, 0, 100); onVolume?.(Math.round(st.volume)); e.preventDefault(); return; }
    if (!inShelfZone(e)) return;
    shelfScrollTarget += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.004; clampShelf(); e.preventDefault();
  }, { passive: false });

  /* ---------- disc flights ---------- */
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  function itemTransform(item) {
    const g = item.group; g.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    g.matrixWorld.decompose(pos, quat, scl);
    pos.add(new THREE.Vector3(0.05, 0, 0.06).multiplyScalar(scl.x).applyQuaternion(quat));
    return { pos, quat, scale: scl.x * 0.95 };
  }
  function offscreenTransform() {
    return { pos: new THREE.Vector3(layout.vertical ? -layout.halfW - 1 : 0, layout.vertical ? 0 : -layout.halfH - 1.2, 1), quat: new THREE.Quaternion(), scale: 0.4 };
  }
  function anchorTransform() {
    deck.anchor.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    deck.anchor.matrixWorld.decompose(pos, quat, scl);
    return { pos, quat, scale: scl.x };
  }
  const findItem = key => shelfItems.find(s => s.data.key === key);
  function startIn(np) {
    const item = findItem(np.sourceKey) || findItem(np.key);
    const from = item && item.group.visible ? itemTransform(item) : offscreenTransform();
    if (item && !item.group.visible) { shelfScrollTarget = item.index * SPACING; clampShelf(); }
    printDisc(np);
    st.flight = { dir: 'in', np, t: 0, from, item };
    disc.visible = true;
  }
  function startOut() {
    const np = st.docked; st.docked = null;
    const item = findItem(np.sourceKey) || findItem(np.key);
    st.flight = { dir: 'out', np, t: 0, from: anchorTransform(), item };
  }
  function flightTarget(f) {
    if (f.dir === 'in') return anchorTransform();
    return f.item && f.item.group.visible ? itemTransform(f.item) : offscreenTransform();
  }
  function stepFlight(dt) {
    const f = st.flight; if (!f) return;
    // inbound waits for the door to open before entering the window
    const dur = 1.25;
    f.t = Math.min(1, f.t + dt / dur);
    const to = flightTarget(f);
    const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - Math.pow(-2 * f.t + 2, 3) / 2;
    const ctrl = f.from.pos.clone().lerp(to.pos, 0.5).add(new THREE.Vector3(0, 0.9, 1.6));
    const a = f.from.pos.clone().lerp(ctrl, e), b = ctrl.clone().lerp(to.pos, e);
    disc.position.copy(a.lerp(b, e));
    // last stretch: straight in along the window normal so it slots behind the door
    if (f.dir === 'in' && f.t > 0.8) { const k = (f.t - 0.8) / 0.2; const n = new THREE.Vector3(0, 0, 1).applyQuaternion(to.quat).multiplyScalar(0.5 * (1 - k) * to.scale); disc.position.copy(to.pos).add(n).lerp(disc.position, (1 - k) * 0.3); }
    disc.quaternion.slerpQuaternions(f.from.quat, to.quat, e);
    disc.scale.setScalar(THREE.MathUtils.lerp(f.from.scale, to.scale, e));
    st.spin += dt * (f.dir === 'in' ? -14 : 14) * (1 - e * 0.6);
    if (f.t >= 1) {
      if (f.dir === 'in') { st.docked = f.np; st.flight = null; }
      else { disc.visible = false; st.flight = null; if (st.queue) { const q = st.queue; st.queue = null; startIn(q); } }
    }
  }
  function dockedPose() {
    const t = anchorTransform();
    disc.position.copy(t.pos); disc.quaternion.copy(t.quat); disc.scale.setScalar(t.scale);
  }

  /* ---------- animation loop ---------- */
  let last = performance.now(), running = true;
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { last = performance.now(); loop(); } });
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const now = performance.now(); const dt = Math.min((now - last) / 1000, 0.05); last = now;
    st.t += dt;
    bgUniforms.uTime.value = st.t;
    bgUniforms.uEnergy.value = damp(bgUniforms.uEnergy.value, st.playing ? 1 : 0, 1.5, dt);

    camera.position.x = damp(camera.position.x, st.mouse.x * 0.22, 2.5, dt);
    camera.position.y = damp(camera.position.y, 0.05 + st.mouse.y * 0.14, 2.5, dt);
    camera.position.z = layout.dist; camera.lookAt(0, 0, 0);

    // player idle tilt follows the pointer a little
    player.rotation.y = damp(player.rotation.y, (layout.portrait ? 0 : -0.1) + st.mouse.x * 0.06, 3, dt);
    player.rotation.x = damp(player.rotation.x, -0.04 - st.mouse.y * 0.04, 3, dt);

    // queue handling: wait for art (max 2s) before a disc flies in
    if (!st.flight && st.queue && !st.docked && (!st.queue.artPending || now > st.queue.artDeadline)) { const q = st.queue; st.queue = null; startIn(q); }

    // door: open while a disc is travelling near the player
    const f = st.flight;
    const doorWant = f ? (f.dir === 'in' ? (f.t > 0.25 ? 1 : 0) : (f.t < 0.55 ? 1 : 0)) : 0;
    st.door = damp(st.door, doorWant, 6, dt);
    deck.doorPivot.rotation.x = -1.45 * st.door;

    if (f) stepFlight(dt); else if (st.docked) dockedPose();

    // spin (≈ 0.55 rev/s), with inertia
    const targetVel = st.docked && st.playing ? -3.4 : 0;
    st.spinVel = damp(st.spinVel, targetVel, st.playing ? 1.1 : 0.7, dt);
    if (!f) st.spin += st.spinVel * dt;
    discSpin.rotation.z = st.spin;

    // buttons
    for (const c of deck.controls) {
      c.userData.press = damp(c.userData.press, c.userData.pressed ? 1 : 0, 25, dt);
      c.userData.cap.position.z = -0.035 * c.userData.press;
    }
    deck.knobSpin.rotation.z = -(-Math.PI * 0.75 + (st.volume / 100) * Math.PI * 1.5);
    deck.volRing.material.uniforms.uValue.value = st.volume / 100;
    deck.progress.material.uniforms.uValue.value = st.progress;
    deck.progress.material.uniforms.uTime.value = st.t; deck.volRing.material.uniforms.uTime.value = st.t;
    deck.progress.material.uniforms.uPlaying.value = st.playing ? 1 : 0;
    deck.playMat.emissiveIntensity = 0.15 + (st.playing ? 0.12 + Math.sin(st.t * 2.2) * 0.08 : 0);
    deck.display.draw(now);

    // album stack
    shelfScroll = damp(shelfScroll, shelfScrollTarget, 6, dt);
    for (const it of shelfItems) {
      const hovered = st.hover === it.index;
      const active = it.data.key === st.highlightKey;
      it.lift = damp(it.lift, hovered ? 1 : active ? 0.55 : 0, 8, dt);
      if (layout.vertical) {
        const SP = 0.52, MS = 0.36;
        const topY = layout.halfH - 0.62, botY = -layout.halfH + 0.42, midY = (topY + botY) / 2;
        const y = topY - (it.index * SP - shelfScroll * (SP / SPACING));
        it.group.position.set(0.18 * it.lift, y, -Math.abs(y - midY) * 0.12 + it.lift * 0.14);
        it.group.rotation.set(THREE.MathUtils.clamp((y - midY) * 0.22, -0.5, 0.5) * (1 - it.lift * 0.8), 0.42 * (1 - it.lift * 0.7), 0);
        const over = Math.max(y - topY, botY - y, 0);
        const vis = THREE.MathUtils.clamp(1 - over / 0.35, 0, 1);
        it.group.scale.setScalar(MS * (0.8 + 0.2 * vis)); it.group.visible = vis > 0.01;
      } else {
        const x = it.index * SPACING - shelfScroll, dist = Math.abs(x);
        it.group.position.set(x, 0.0175 + MINI * H / 2 + it.lift * 0.08, -dist * 0.06);
        it.group.rotation.set(-0.06 * it.lift, THREE.MathUtils.clamp(-x * 0.28, -0.7, 0.7) * (1 - it.lift * 0.8), 0);
        const vis = THREE.MathUtils.clamp(1 - (dist - 2.6) / 0.8, 0, 1);
        it.group.scale.setScalar(MINI * (0.75 + 0.25 * vis)); it.group.visible = vis > 0.01;
      }
    }
    renderer.render(scene, camera);
  }
  resize(); loop();
  deck.display.set({ msg: 'NO DISC' });

  /* ---------- public API ---------- */
  return {
    /** np: { key (album uri), sourceKey (context uri or album uri), art, trackName, albumName, artists, palette } */
    setNowPlaying(np) {
      if (!np) { if (st.docked && !st.flight) startOut(); st.queue = null; deck.display.set({ msg: 'NO DISC' }); return; }
      if (!np.palette) np.palette = paletteFromSeed(np.key);
      applyPalette(np.palette);
      const current = st.queue || (st.flight?.dir === 'in' ? st.flight.np : st.docked);
      if (current && current.sourceKey === np.sourceKey) {
        // same disc (album/playlist): reprint if the art changed (e.g. next track of a playlist)
        Object.assign(current, { trackName: np.trackName, artists: np.artists, albumName: np.albumName, palette: np.palette });
        if (current.art !== np.art) { current.art = np.art; current.img = null; current.key = np.key; prepareArt(current); printDisc(current); }
        return;
      }
      prepareArt(np);
      st.queue = np;
      if (st.docked && !st.flight) startOut();
    },
    refreshPrint(np) {
      const cur = st.docked || st.flight?.np || st.queue;
      if (cur && np && cur.sourceKey === np.sourceKey) { cur.palette = np.palette; applyPalette(np.palette); if (!cur.img) printDisc(cur); }
    },
    setPlaying(p) { st.playing = !!p; deck.setPlayIcon(p); },
    setHighlight(key) { st.highlightKey = key; },
    setTransport({ playing, shuffle, repeat, liked, volume, device, title, sub, dur }) {
      deck.setLeds({ shuffle, repeat, love: liked });
      if (Number.isFinite(volume) && !st.knobDrag) st.volume = volume;
      deck.display.set({ msg: title ? null : (device ? 'READY' : 'NO DISC'), title, sub, dur, playing, shuffle, repeat, device });
    },
    setProgress(frac, timeText) { st.progress = THREE.MathUtils.clamp(frac || 0, 0, 1); deck.display.set({ time: timeText }); },
    setVolume(v) { st.volume = v; },
    /** items: [{key, title, subtitle, kind, palette, art}] */
    setShelf(items) {
      clearShelf();
      items.forEach((data, index) => {
        const group = new THREE.Group(); group.userData.shelfIndex = index;
        const trayM = new THREE.Mesh(miniTrayGeo, plasticDark);
        const tex = insertTexture({ title: data.title, subtitle: data.subtitle, kind: data.kind, palette: data.palette || paletteFromSeed(data.key), seed: data.key }, 512);
        const front = new THREE.Mesh(miniFrontGeo, new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.5 })); front.position.set(0.05, 0, 0.047);
        const g = new THREE.Mesh(miniGlassGeo, miniGlass); g.position.z = 0.056;
        group.add(trayM, front, g); shelf.add(group);
        const it = { group, front, tex, data, index, lift: 0 };
        shelfItems.push(it);
        if (data.art) loadImage(data.art).then(img => { if (!shelfItems.includes(it)) return; it.tex?.dispose(); it.tex = coverTexture(img); it.hasArt = true; it.front.material.map = it.tex; it.front.material.needsUpdate = true; }).catch(() => {});
      });
      shelfScrollTarget = shelfScroll = layout.vertical ? 0 : Math.min(3, Math.floor((items.length - 1) / 2)) * SPACING;
      clampShelf();
    },
    updateShelfPalette(key, palette) {
      const it = findItem(key); if (!it) return;
      it.data.palette = palette; if (it.hasArt) return; it.tex.dispose();
      it.tex = insertTexture({ title: it.data.title, subtitle: it.data.subtitle, kind: it.data.kind, palette, seed: it.data.key }, 512);
      it.front.material.map = it.tex; it.front.material.needsUpdate = true;
    },
    scrollShelf(dir) { shelfScrollTarget += dir * SPACING * 3; clampShelf(); },
    focusShelf(key) { const it = findItem(key); if (it) { shelfScrollTarget = it.index * SPACING; clampShelf(); } },
    /** Start the insert animation immediately when the user picks an album (before Spotify confirms). */
    insertFromShelf(item) {
      const np = { key: item.key, sourceKey: item.key, art: item.art, trackName: item.title, albumName: item.title, artists: item.subtitle, palette: item.palette || paletteFromSeed(item.key) };
      this.setNowPlaying(np);
    },
    renderer,
  };
}
