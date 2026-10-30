import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';
import { insertTexture, labelTexture, grooveAnisotropyTexture, shadowTexture, paletteFromSeed } from './textures.js';

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

export function createScene(canvas, { onShelfPick, onShelfHover, onDiscFlip } = {}) {
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
  const camTarget = new THREE.Vector3(0, -0.12, 0);

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
  const discClear = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: 0.06, transmission: 1, thickness: 0.02, ior: 1.58, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
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
  const labelMat = new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.55, metalness: 0, envMapIntensity: 0.45, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  const label = new THREE.Mesh(discRing(0.225, 0.59), labelMat); label.position.z = T + 0.0006; discSpin.add(label);
  const edge = new THREE.Mesh(new THREE.CylinderGeometry(DISC_R, DISC_R, T * 2, 128, 1, true), discMirror); edge.rotation.x = Math.PI / 2; discSpin.add(edge);
  const holeEdge = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, T * 2, 48, 1, true), discClear); holeEdge.rotation.x = Math.PI / 2; discSpin.add(holeEdge);
  disc.userData.pickable = true;

  /* ---------- jewel case ---------- */
  const W = 1.42, H = 1.25;
  const jewel = new THREE.Group();
  const tray = new THREE.Mesh(new RoundedBoxGeometry(W - 0.06, H, 0.06, 3, 0.012), plasticDark); tray.position.set(0.03, 0, -0.03); jewel.add(tray);
  // rosette (centre hub teeth)
  const rosette = new THREE.Group();
  const hubRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.009, 10, 48), plasticDark); rosette.add(hubRing);
  for (let i = 0; i < 12; i++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.045, 0.012), plasticDark);
    const a = i / 12 * Math.PI * 2; tooth.position.set(Math.cos(a) * 0.075, Math.sin(a) * 0.075, 0.003); tooth.rotation.z = a + Math.PI / 2; rosette.add(tooth);
  }
  rosette.position.set(0.03, 0, 0.0); jewel.add(rosette);
  // tray ridge (circular recess rim)
  const recess = new THREE.Mesh(new THREE.TorusGeometry(DISC_R + 0.015, 0.008, 8, 128), plasticDark); recess.position.set(0.03, 0, 0.003); jewel.add(recess);
  // spine
  const spine = new THREE.Mesh(new RoundedBoxGeometry(0.06, H, 0.1, 3, 0.012), glass); spine.position.set(-W / 2 + 0.03, 0, -0.005); jewel.add(spine);

  // lid (hinged at the left edge)
  const lidPivot = new THREE.Group(); lidPivot.position.set(-W / 2, 0, 0.03); jewel.add(lidPivot);
  const lid = new THREE.Group(); lid.position.x = W / 2; lidPivot.add(lid);
  const lidGlass = new THREE.Mesh(new RoundedBoxGeometry(W, H, 0.022, 3, 0.008), glass); lid.add(lidGlass);
  const insertMat = new THREE.MeshPhysicalMaterial({ roughness: 0.62, metalness: 0, sheen: 0.3, side: THREE.DoubleSide });
  const insert = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), insertMat); insert.position.set(0.05, 0, -0.0135); lid.add(insert);
  // insert back (inside of booklet)
  const insertBack = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshStandardMaterial({ color: '#f1ece2', roughness: 0.9 }));
  insertBack.rotation.y = Math.PI; insertBack.position.set(0.05, 0, -0.0145); lid.add(insertBack);

  const hero = new THREE.Group(); hero.add(jewel); hero.add(disc); scene.add(hero);
  disc.position.set(0.03, 0, 0.012);

  // contact shadow
  const shadowTex = shadowTexture();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.7), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

  /* ---------- shelf ---------- */
  const shelf = new THREE.Group(); scene.add(shelf);
  const plank = new THREE.Mesh(new RoundedBoxGeometry(9, 0.03, 0.42, 2, 0.012), new THREE.MeshPhysicalMaterial({ color: '#cfe0ff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, clearcoat: 1, depthWrite: false }));
  const plankEdge = new THREE.Mesh(new THREE.BoxGeometry(9, 0.004, 0.004), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 }));
  plankEdge.position.set(0, 0.015, 0.21); shelf.add(plankEdge);
  shelf.add(plank);
  const shelfRow = new THREE.Group(); shelf.add(shelfRow);
  const miniTrayGeo = new RoundedBoxGeometry(W, H, 0.09, 2, 0.012);
  const miniFrontGeo = new THREE.PlaneGeometry(1.24, 1.24);
  const miniGlass = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0, depthWrite: false });
  const miniGlassGeo = new RoundedBoxGeometry(W, H, 0.012, 2, 0.006);
  let shelfItems = [];
  let shelfScroll = 0, shelfScrollTarget = 0;
  const SPACING = 0.56, MINI = 0.33;

  function clearShelf() {
    for (const it of shelfItems) { it.group.removeFromParent(); it.tex?.dispose(); it.front.material.dispose(); }
    shelfItems = [];
  }

  /* ---------- state ---------- */
  const st = {
    playing: false, open: 0, out: 0, spin: 0, spinVel: 0,
    flip: 0, flipTarget: 0, swapPending: null, currentKey: null, t: 0,
    mouse: new THREE.Vector2(), hover: null, dragging: false, dragAngle: 0, dragVel: 0, highlightKey: null,
  };
  let labelTex = null, insertTex = null;

  function applyPalette(p) {
    bgUniforms.uA.value.set(p[0]); bgUniforms.uB.value.set(p[1]); bgUniforms.uC.value.set(p[2]);
    rimA.color.set(p[0]); rimB.color.set(p[2]);
  }

  function applyPrint(np) {
    labelTex?.dispose(); insertTex?.dispose();
    labelTex = labelTexture({ track: np.trackName, album: np.albumName, artists: np.artists, palette: np.palette, seed: np.key });
    insertTex = insertTexture({ title: np.albumName || np.trackName, subtitle: np.artists, kind: np.kind || 'Album', palette: np.palette, seed: np.key });
    labelMat.map = labelTex; labelMat.needsUpdate = true;
    insertMat.map = insertTex; insertMat.needsUpdate = true;
    applyPalette(np.palette);
  }

  /* ---------- layout ---------- */
  let layout = { portrait: false };
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const portrait = w / h < 0.95;
    layout.portrait = portrait;
    // keep the composition's width in frame
    const sceneHalfW = portrait ? 1.35 : 2.25;
    const halfFovV = THREE.MathUtils.degToRad(camera.fov / 2);
    const distW = sceneHalfW / (Math.tan(halfFovV) * camera.aspect);
    const distH = (portrait ? 2.25 : 1.75) / Math.tan(halfFovV);
    layout.dist = Math.max(distW, distH);
    camera.updateProjectionMatrix();
    bgUniforms.uAspect.value = camera.aspect;
    hero.position.set(portrait ? -0.42 : 0.12, portrait ? 0.3 : 0.16, 0);
    hero.rotation.y = portrait ? 0.22 : 0.32;
    hero.scale.setScalar(portrait ? 0.82 : 1);
    shelf.position.set(portrait ? 0 : 0.55, portrait ? -0.98 : -1.06, 0.35);
    shelf.scale.setScalar(portrait ? 0.92 : 1);
    shadow.position.set(hero.position.x + 0.4 * hero.scale.x, hero.position.y - 0.8 * hero.scale.x, 0.05);
  }
  addEventListener('resize', resize);

  /* ---------- picking & interaction ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([disc, ...shelfItems.map(s => s.group)], true);
    for (const h of hits) {
      let o = h.object;
      while (o) { if (o === disc) return { type: 'disc' }; if (o.userData.shelfIndex !== undefined) return { type: 'shelf', index: o.userData.shelfIndex }; o = o.parent; }
    }
    return null;
  }
  function screenPos(obj) {
    const v = new THREE.Vector3(); obj.getWorldPosition(v); v.y += 0.26; v.project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  }
  function discScreenCenter() {
    const v = new THREE.Vector3(); disc.getWorldPosition(v); v.project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  }

  let downAt = null, lastTap = 0, dragShelf = null;
  canvas.addEventListener('pointermove', e => {
    st.mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (st.dragging) {
      const c = discScreenCenter(); const a = Math.atan2(e.clientY - c.y, e.clientX - c.x);
      let d = a - st.dragAngle; if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
      st.spin -= d * (st.flip > 0.5 ? -1 : 1); st.dragVel = -d * 60; st.dragAngle = a; return;
    }
    if (dragShelf) {
      const dx = e.clientX - dragShelf.x; dragShelf.x = e.clientX; dragShelf.moved += Math.abs(dx);
      shelfScrollTarget -= dx / canvas.clientWidth * 5.5; clampShelf(); return;
    }
    const p = pick(e.clientX, e.clientY);
    const idx = p?.type === 'shelf' ? p.index : null;
    if (idx !== st.hover) {
      st.hover = idx;
      onShelfHover?.(idx === null ? null : shelfItems[idx].data, idx === null ? null : screenPos(shelfItems[idx].group));
    }
    canvas.style.cursor = p ? (p.type === 'disc' ? 'grab' : 'pointer') : 'default';
  });
  canvas.addEventListener('pointerdown', e => {
    const p = pick(e.clientX, e.clientY);
    downAt = { x: e.clientX, y: e.clientY, p };
    if (p?.type === 'disc') {
      st.dragging = true; const c = discScreenCenter(); st.dragAngle = Math.atan2(e.clientY - c.y, e.clientX - c.x);
      canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing';
    } else if (e.clientY > canvas.getBoundingClientRect().top + canvas.clientHeight * 0.55) {
      dragShelf = { x: e.clientX, moved: 0 }; canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointerup', e => {
    const moved = downAt ? Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) : 99;
    if (st.dragging) {
      st.dragging = false; st.spinVel = THREE.MathUtils.clamp(st.dragVel, -30, 30);
      if (moved < 6) { // tap on disc: double-tap flips it over
        const now = performance.now(); if (now - lastTap < 350) { st.flipTarget = st.flipTarget ? 0 : 1; onDiscFlip?.(st.flipTarget); } lastTap = now;
      }
    } else if (moved < 6 && downAt?.p?.type === 'shelf') {
      onShelfPick?.(shelfItems[downAt.p.index].data);
    }
    dragShelf = null; downAt = null;
  });
  canvas.addEventListener('pointerleave', () => { if (st.hover !== null) { st.hover = null; onShelfHover?.(null); } });
  canvas.addEventListener('wheel', e => {
    if (e.clientY < canvas.getBoundingClientRect().top + canvas.clientHeight * 0.55) return;
    shelfScrollTarget += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.004; clampShelf(); e.preventDefault();
  }, { passive: false });

  function clampShelf() { shelfScrollTarget = THREE.MathUtils.clamp(shelfScrollTarget, 0, Math.max(0, (shelfItems.length - 1) * SPACING)); }

  /* ---------- animation loop ---------- */
  let last = performance.now();
  let running = true;
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { last = performance.now(); loop(); } });

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const now = performance.now(); const dt = Math.min((now - last) / 1000, 0.05); last = now;
    st.t += dt;
    bgUniforms.uTime.value = st.t;
    bgUniforms.uEnergy.value = damp(bgUniforms.uEnergy.value, st.playing ? 1 : 0, 1.5, dt);

    // camera parallax
    const d = layout.dist || 6;
    camera.position.x = damp(camera.position.x, st.mouse.x * 0.35, 2.5, dt);
    camera.position.y = damp(camera.position.y, 0.15 + st.mouse.y * 0.2, 2.5, dt);
    camera.position.z = d;
    camera.lookAt(camTarget);

    // choreography: lid opens, disc travels in/out of the tray, lid closes.
    // Album change = disc goes home, insert + label are reprinted, disc comes back out.
    const want = st.currentKey && !st.swapPending ? 1 : 0;
    const moving = Math.abs(st.out - want) > 0.002;
    st.open = damp(st.open, moving ? 1 : 0, moving ? 5 : 3, dt);
    if (moving && st.open > 0.82) { const step = dt / 1.05; st.out += THREE.MathUtils.clamp(want - st.out, -step, step); }
    if (st.swapPending && st.out <= 0.002) { applyPrint(st.swapPending); st.swapPending = null; }

    lidPivot.rotation.y = -1.38 * ease(THREE.MathUtils.clamp(st.open, 0, 1));
    const o = ease(THREE.MathUtils.clamp(st.out, 0, 1));
    const lift = Math.sin(Math.PI * Math.min(1, st.out * 1.4)) * 0.45;
    const bob = Math.sin(st.t * 1.3) * 0.018 * o;
    disc.position.set(0.03 + 1.12 * o, 0.03 * o + bob, 0.012 + 0.72 * o + lift);
    disc.rotation.set(Math.sin(st.t * 0.7) * 0.035 * o, -0.42 * o, 0);

    // spin with inertia (≈ 0.55 rev/s when playing)
    if (!st.dragging) {
      const targetVel = st.playing && st.out > 0.95 ? -3.4 : 0;
      st.spinVel = damp(st.spinVel, targetVel, st.playing ? 1.1 : 0.7, dt);
      st.spin += st.spinVel * dt;
    }
    discSpin.rotation.z = st.spin;
    st.flip = damp(st.flip, st.flipTarget, 4, dt);
    discFlip.rotation.y = Math.PI * ease(st.flip);

    // hero idle float
    jewel.position.y = Math.sin(st.t * 0.8) * 0.012;
    rimA.intensity = 5 + (st.playing ? Math.sin(st.t * 2.1) * 1.2 + 1.5 : 0);

    // shelf coverflow
    shelfScroll = damp(shelfScroll, shelfScrollTarget, 6, dt);
    for (const it of shelfItems) {
      const x = it.index * SPACING - shelfScroll;
      const dist = Math.abs(x);
      const hovered = st.hover === it.index;
      const active = it.data.key === st.highlightKey;
      it.lift = damp(it.lift, hovered ? 1 : active ? 0.5 : 0, 8, dt);
      it.group.position.set(x, 0.0175 + MINI * H / 2 + it.lift * 0.08, -dist * 0.06);
      it.group.rotation.y = THREE.MathUtils.clamp(-x * 0.28, -0.7, 0.7) * (1 - it.lift * 0.8);
      it.group.rotation.x = -0.06 * it.lift;
      const vis = THREE.MathUtils.clamp(1 - (dist - 2.6) / 0.8, 0, 1);
      it.group.scale.setScalar(MINI * (0.75 + 0.25 * vis));
      it.group.visible = vis > 0.01;
    }
    renderer.render(scene, camera);
  }

  resize();
  loop();

  /* ---------- public API ---------- */
  return {
    /** np: {key, trackName, albumName, artists, palette, kind} */
    setNowPlaying(np) {
      if (!np) { st.currentKey = null; return; }
      if (!np.palette) np.palette = paletteFromSeed(np.key);
      if (st.currentKey === null && !labelTex) { applyPrint(np); }
      else if (np.key !== st.currentKey) { st.swapPending = np; }
      else { applyPrint(np); } // same album, new track title on the label
      st.currentKey = np.key;
    },
    refreshPrint(np) { if (np && np.key === st.currentKey && !st.swapPending) applyPrint(np); },
    setPlaying(p) { st.playing = !!p; },
    setHighlight(key) { st.highlightKey = key; },
    /** items: [{key, title, subtitle, kind, palette, ...data}] */
    setShelf(items) {
      clearShelf();
      items.forEach((data, index) => {
        const group = new THREE.Group(); group.userData.shelfIndex = index;
        const trayM = new THREE.Mesh(miniTrayGeo, plasticDark);
        const tex = insertTexture({ title: data.title, subtitle: data.subtitle, kind: data.kind, palette: data.palette || paletteFromSeed(data.key), seed: data.key }, 512);
        const front = new THREE.Mesh(miniFrontGeo, new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.6 })); front.position.set(0.05, 0, 0.047);
        const g = new THREE.Mesh(miniGlassGeo, miniGlass); g.position.z = 0.056;
        group.add(trayM, front, g);
        shelfRow.add(group);
        shelfItems.push({ group, front, tex, data, index, lift: 0 });
      });
      shelfScrollTarget = shelfScroll = Math.min(3, Math.floor((items.length - 1) / 2)) * SPACING;
      clampShelf();
    },
    updateShelfPalette(key, palette) {
      const it = shelfItems.find(s => s.data.key === key); if (!it) return;
      it.data.palette = palette; it.tex.dispose();
      it.tex = insertTexture({ title: it.data.title, subtitle: it.data.subtitle, kind: it.data.kind, palette, seed: it.data.key }, 512);
      it.front.material.map = it.tex; it.front.material.needsUpdate = true;
    },
    flip() { st.flipTarget = st.flipTarget ? 0 : 1; },
    scrollShelf(dir) { shelfScrollTarget += dir * SPACING * 3; clampShelf(); },
    focusShelf(key) { const it = shelfItems.find(s => s.data.key === key); if (it) { shelfScrollTarget = it.index * SPACING; clampShelf(); } },
    renderer,
  };
}
