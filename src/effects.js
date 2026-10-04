// Impact effects: bullet holes per material, dust, sparks, splinters and
// chips, smoke puffs, blood sprays and decals, ejected shells, gun smoke after
// a burst, muzzle-flash lighting, bullet tracers, grenade and bomb explosions,
// and the pieces of broken windows and crates.

import * as THREE from '../lib/three.module.js';
import { IMPACT_COLOR, DECAL_KIND, IMPACT_FX } from './map.js';

const MAX_PARTICLES = 900;
const MAX_SMOKE = 48;
// how many decals of each kind stay on the walls (one instanced draw call per kind)
const DECAL_SLOTS = { concrete: 160, wood: 90, metal: 70, blood: 120, scorch: 16 };
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const dummy = new THREE.Object3D();
const MAX_SHELLS = 384;
const SHELL_LIFE = 10;   // seconds a case lies on the floor
const MAX_CHIPS = 160;   // wood splinters, bits of stone and tile
const MAX_SOFT = 420;    // dust, gun smoke
const MAX_GLOW = 260;    // sparks
const MAX_FIREBALLS = 8;
const MAX_GIBS = 72;
const MAX_TRACERS = 192;
const TRACER_SPEED = 7000; // units a second
const TRACER_LEN = 240;    // longest streak
const TRACER_PX = 2;       // half width in screen pixels, whatever the distance
const TRACER_COLOR = [1, 0.8, 0.22]; // a saturated yellow shows on sand and sky alike
const BRASS = new THREE.Color(0xd2a442);
const tmpCol = new THREE.Color();
const RED_SHELL = new THREE.Color(0xa0261c);

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();

// Soft camera-facing particles, all drawn in one call: impact dust, gun smoke
// and (added up) sparks. Each grows from s0 to s1, fades in quickly and out
// over its life, spins slowly and drifts with drag and a pull up or down.
class Billboards {
  constructor(scene, map, max, additive) {
    this.max = max;
    this.list = [];
    this.free = [];
    for (let i = 0; i < max; i++) {
      const b = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 1, s1: 1, a: 1, fadeIn: 0.1, ang: 0, spin: 0, drag: 0, grav: 0, r: 1, g: 1, b: 1, ground: -1e9 };
      this.free.push(b);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.center = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.data = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('center', this.center);
    geo.setAttribute('data', this.data);
    geo.setAttribute('tint', this.tint);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map } },
      vertexShader: `
        attribute vec3 center;
        attribute vec3 data; // size, alpha, angle
        attribute vec3 tint;
        varying vec2 vUv;
        varying float vA;
        varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * vec4(center, 1.0);
          float c = cos(data.z), s = sin(data.z);
          mv.xy += vec2(position.x * c - position.y * s, position.x * s + position.y * c) * data.x;
          gl_Position = projectionMatrix * mv;
          vUv = uv;
          vA = data.y;
          vC = tint;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        varying float vA;
        varying vec3 vC;
        void main() {
          vec4 t = texture2D(map, vUv);
          float a = t.a * vA;
          if (a < 0.004) discard;
          gl_FragColor = vec4(t.rgb * vC, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  // o: { x, y, z, vx, vy, vz, life, s0, s1, a, fadeIn, spin, drag, grav, col, ground }
  add(o) {
    let b = this.free.pop();
    if (!b) b = this.list.shift(); // full: the oldest goes
    b.x = o.x; b.y = o.y; b.z = o.z;
    b.vx = o.vx || 0; b.vy = o.vy || 0; b.vz = o.vz || 0;
    b.life = b.max = o.life;
    b.s0 = o.s0; b.s1 = o.s1 ?? o.s0;
    b.a = o.a ?? 1;
    b.fadeIn = o.fadeIn ?? 0.08;
    b.ang = Math.random() * Math.PI * 2;
    b.spin = o.spin ?? (Math.random() - 0.5) * 1.2;
    b.drag = o.drag ?? 1.5;
    b.grav = o.grav ?? 0;
    b.r = o.col[0]; b.g = o.col[1]; b.b = o.col[2];
    b.ground = o.ground ?? -1e9;
    this.list.push(b);
  }

  update(dt) {
    const C = this.center.array, D = this.data.array, T = this.tint.array;
    let n = 0;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.free.push(b);
        this.list[i] = null;
        continue;
      }
      const drag = Math.max(0, 1 - b.drag * dt);
      b.vx *= drag; b.vy *= drag; b.vz *= drag;
      b.vy -= b.grav * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.y < b.ground) {
        b.y = b.ground;
        b.vy *= -0.3;
      }
      b.ang += b.spin * dt;
      const t = 1 - b.life / b.max;
      const k = n * 3;
      C[k] = b.x; C[k + 1] = b.y; C[k + 2] = b.z;
      D[k] = b.s0 + (b.s1 - b.s0) * (1 - (1 - t) * (1 - t));
      D[k + 1] = b.a * Math.min(1, (t * b.max) / b.fadeIn) * (1 - t);
      D[k + 2] = b.ang;
      T[k] = b.r; T[k + 1] = b.g; T[k + 2] = b.b;
      n++;
    }
    if (n !== this.list.length) this.list = this.list.filter((b) => b);
    this.geo.instanceCount = n;
    if (n) {
      this.center.needsUpdate = true;
      this.data.needsUpdate = true;
      this.tint.needsUpdate = true;
    }
  }

  clear() {
    for (const b of this.list) this.free.push(b);
    this.list = [];
    this.geo.instanceCount = 0;
  }
}

export class Effects {
  constructor(scene, T, map) {
    this.scene = scene;
    this.T = T;
    this.map = map;
    this.onShellBounce = null;
    this.quality = { effects: 1, smoke: true, dlights: true };

    // point particles (dust, sparks, blood droplets)
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.grav = new Float32Array(MAX_PARTICLES);
    this.ground = new Float32Array(MAX_PARTICLES);
    this.groundY = 0.5; // floor height for the particles being spawned
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 2.6, map: T.particle, vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.05,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < MAX_PARTICLES; i++) this.pos[i * 3 + 1] = -1e4;

    // decals: one instanced mesh per kind
    const plane = new THREE.PlaneGeometry(1, 1);
    const maps = { concrete: T.holeConcrete, wood: T.holeWood, metal: T.holeMetal, blood: T.blood, scorch: T.scorch };
    this.decals = {};
    for (const kind in DECAL_SLOTS) {
      const mat = new THREE.MeshBasicMaterial({
        map: maps[kind], transparent: true, opacity: kind === 'blood' ? 0.92 : kind === 'scorch' ? 0.85 : 1, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      const im = new THREE.InstancedMesh(plane, mat, DECAL_SLOTS[kind]);
      im.frustumCulled = false;
      im.renderOrder = 1;
      for (let i = 0; i < DECAL_SLOTS[kind]; i++) im.setMatrixAt(i, ZERO);
      scene.add(im);
      this.decals[kind] = { im, next: 0, used: 0 };
    }

    // smoke puffs
    this.smoke = [];
    for (let i = 0; i < MAX_SMOKE; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.smoke, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      scene.add(s);
      this.smoke.push({ s, life: 0, max: 1, grow: 0, vy: 0, size: 0, alpha: 0 });
    }
    this.nextSmoke = 0;

    // brass shells
    const shellGeo = new THREE.CylinderGeometry(0.28, 0.28, 1.2, 6);
    shellGeo.rotateZ(Math.PI / 2);
    this.shellMesh = new THREE.InstancedMesh(shellGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2a1c04 }), MAX_SHELLS);
    this.shellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shellMesh.frustumCulled = false;
    this.shells = [];
    for (let i = 0; i < MAX_SHELLS; i++) {
      this.shells.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), life: 0, ground: 0, bounces: 0, scale: 1 });
      this.shellMesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
      this.shellMesh.setColorAt(i, BRASS);
    }
    scene.add(this.shellMesh);
    this.nextShell = 0;
    this.shellCap = MAX_SHELLS;

    // soft dust and smoke, bright sparks
    this.soft = new Billboards(scene, T.smoke, MAX_SOFT, false);
    this.glow = new Billboards(scene, T.particle, MAX_GLOW, true);

    // splinters and chips knocked out of walls
    this.chipMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_CHIPS);
    this.chipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chipMesh.frustumCulled = false;
    this.chips = [];
    for (let i = 0; i < MAX_CHIPS; i++) {
      this.chips.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1), life: 0, ground: 0, rest: false });
      this.chipMesh.setMatrixAt(i, ZERO);
      this.chipMesh.setColorAt(i, BRASS);
    }
    scene.add(this.chipMesh);
    this.nextChip = 0;

    // grenade fireballs and flashbang bursts
    this.fireballs = [];
    for (let i = 0; i < MAX_FIREBALLS; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.fireball, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      scene.add(s);
      this.fireballs.push({ s, life: 0, max: 1, size0: 0, size1: 0 });
    }
    this.nextFireball = 0;

    // pieces of broken things: solid chunks and see-through glass shards
    const gibGeo = new THREE.BoxGeometry(1, 1, 1);
    this.gibMesh = {
      solid: new THREE.InstancedMesh(gibGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_GIBS),
      glass: new THREE.InstancedMesh(gibGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }), MAX_GIBS),
    };
    this.gibList = { solid: [], glass: [] };
    for (const k of ['solid', 'glass']) {
      const im = this.gibMesh[k];
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      for (let i = 0; i < MAX_GIBS; i++) {
        this.gibList[k].push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1), life: 0, ground: 0 });
        im.setMatrixAt(i, ZERO);
        im.setColorAt(i, BRASS);
      }
      scene.add(im);
    }
    this.nextGib = { solid: 0, glass: 0 };

    // bullet tracers: camera-facing streaks, solid at the head and fading to
    // nothing at the tail, all in one mesh (only the live ones are drawn)
    this.camera = null; // set by main.js, the streaks turn to face it
    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) this.tracers.push({ a: new THREE.Vector3(), d: new THREE.Vector3(), dist: 0, t: 0, live: false });
    this.nextTracer = 0;
    this.trPos = new Float32Array(MAX_TRACERS * 12);
    this.trCol = new Float32Array(MAX_TRACERS * 16);
    const trUv = new Float32Array(MAX_TRACERS * 8);
    const trIdx = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      trUv.set([0, 0, 0, 1, 1, 0, 1, 1], i * 8);
      const v = i * 4;
      trIdx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    }
    const trGeo = new THREE.BufferGeometry();
    this.trPosAttr = new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.trColAttr = new THREE.BufferAttribute(this.trCol, 4).setUsage(THREE.DynamicDrawUsage);
    trGeo.setAttribute('position', this.trPosAttr);
    trGeo.setAttribute('color', this.trColAttr);
    trGeo.setAttribute('uv', new THREE.BufferAttribute(trUv, 2));
    trGeo.setIndex(trIdx);
    trGeo.setDrawRange(0, 0);
    trGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    // across the streak: a solid core with soft edges
    const prof = new Uint8Array(4 * 16);
    for (let i = 0; i < 16; i++) {
      const x = (i + 0.5) / 16 * 2 - 1, core = Math.exp(-x * x * 4);
      prof.set([255, 255, 140 + 115 * core, Math.round(255 * Math.min(1, core * 1.8))], i * 4);
    }
    const profTex = new THREE.DataTexture(prof, 1, 16);
    profTex.magFilter = profTex.minFilter = THREE.LinearFilter;
    profTex.needsUpdate = true;
    this.trMesh = new THREE.Mesh(trGeo, new THREE.MeshBasicMaterial({
      map: profTex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    this.trMesh.frustumCulled = false;
    this.trMesh.renderOrder = 2;
    scene.add(this.trMesh);
  }

  // a bullet streak flying from the gun (a) to where the bullet stopped (b)
  tracer(a, b) {
    const dist = a.distanceTo(b);
    if (dist < 24) return;
    const tr = this.tracers[this.nextTracer];
    this.nextTracer = (this.nextTracer + 1) % MAX_TRACERS;
    tr.a.copy(a);
    tr.d.subVectors(b, a).divideScalar(dist);
    tr.dist = dist;
    tr.t = 0;
    tr.live = true;
  }

  updateTracers(dt) {
    const cam = this.camera;
    let n = 0;
    if (cam) {
      // world units per screen pixel at distance 1
      const perPx = Math.tan(cam.fov * Math.PI / 360) / (window.innerHeight / 2);
      const cp = cam.position, P = this.trPos, C = this.trCol;
      const end = (tr, along, alpha, k, kc) => {
        const x = tr.a.x + tr.d.x * along, y = tr.a.y + tr.d.y * along, z = tr.a.z + tr.d.z * along;
        // sideways = streak direction x direction to the camera
        const tx = cp.x - x, ty = cp.y - y, tz = cp.z - z;
        let sx = tr.d.y * tz - tr.d.z * ty, sy = tr.d.z * tx - tr.d.x * tz, sz = tr.d.x * ty - tr.d.y * tx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const hw = Math.max(0.04, Math.hypot(tx, ty, tz) * perPx * TRACER_PX) / sl;
        sx *= hw; sy *= hw; sz *= hw;
        P[k] = x - sx; P[k + 1] = y - sy; P[k + 2] = z - sz;
        P[k + 3] = x + sx; P[k + 4] = y + sy; P[k + 5] = z + sz;
        for (let c = 0; c < 3; c++) C[kc + c] = C[kc + 4 + c] = TRACER_COLOR[c];
        C[kc + 3] = C[kc + 7] = alpha;
      };
      for (const tr of this.tracers) {
        if (!tr.live) continue;
        tr.t += dt;
        const run = tr.t * TRACER_SPEED;
        const tail = Math.max(0, run - TRACER_LEN);
        if (tail >= tr.dist) {
          tr.live = false;
          continue;
        }
        const head = Math.min(tr.dist, run);
        end(tr, tail, 0, n * 12, n * 16);
        end(tr, head, 1, n * 12 + 6, n * 16 + 8);
        n++;
      }
    }
    this.trMesh.geometry.setDrawRange(0, n * 6);
    if (n) {
      this.trPosAttr.needsUpdate = true;
      this.trColAttr.needsUpdate = true;
    }
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, life, grav) {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b;
    this.life[i] = life;
    this.grav[i] = grav;
    this.ground[i] = this.groundY;
  }

  setMap(map) {
    this.map = map;
  }

  // particles bounce on the floor under where they start
  floorBelow(p) {
    const hit = this.map.world.traceRay(p.x, p.y + 2, p.z, 0, -1, 0, 800);
    this.groundY = hit ? hit.y + 0.5 : -1e4;
  }

  decal(p, n, kind = 'concrete', size = 4.5) {
    const d = this.decals[kind] || this.decals.concrete;
    const m = dummy;
    m.position.set(p.x + n.x * 0.12, p.y + n.y * 0.12, p.z + n.z * 0.12);
    m.rotation.set(0, 0, 0);
    if (n.x) m.rotation.y = (n.x > 0 ? 1 : -1) * Math.PI / 2;
    else if (n.y) m.rotation.x = (n.y > 0 ? -1 : 1) * Math.PI / 2;
    else if (n.z < 0) m.rotation.y = Math.PI;
    m.rotateZ(Math.random() * Math.PI * 2);
    const s = size * (0.85 + Math.random() * 0.3);
    m.scale.set(s, s, 1);
    m.updateMatrix();
    d.im.setMatrixAt(d.next, m.matrix);
    d.next = (d.next + 1) % d.im.count;
    d.used = Math.min(d.im.count, d.used + 1);
    d.im.instanceMatrix.needsUpdate = true;
  }

  decalCount() {
    let n = 0;
    for (const k in this.decals) n += this.decals[k].used;
    return n;
  }

  setQuality(q) {
    this.quality = q;
    // fewer cases lie around on low quality
    const cap = q.effects < 1 ? 160 : MAX_SHELLS;
    if (cap !== this.shellCap) {
      for (let i = cap; i < MAX_SHELLS; i++) {
        this.shells[i].life = 0;
        this.shellMesh.setMatrixAt(i, ZERO);
      }
      this.shellMesh.instanceMatrix.needsUpdate = true;
      this.shellCap = cap;
      this.nextShell %= cap;
    }
  }

  // a splinter or chip flying off a wall (size: [x, y, z])
  chip(p, v, col, size, life) {
    const i = this.nextChip;
    const c = this.chips[i];
    this.nextChip = (this.nextChip + 1) % MAX_CHIPS;
    c.p.copy(p);
    c.v.copy(v);
    c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    c.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
    c.s.set(size[0], size[1], size[2]);
    c.life = life;
    c.ground = this.groundY - 0.5 + size[1] * 0.5;
    c.rest = false;
    this.chipMesh.setColorAt(i, tmpCol.setRGB(col[0], col[1], col[2]));
    this.chipMesh.instanceColor.needsUpdate = true;
  }

  // dust: a soft cloud that drifts off the wall and settles
  dust(p, n, col, size, life, count, speed = 30) {
    for (let i = 0; i < count; i++) {
      const sp = speed * (0.4 + Math.random());
      this.soft.add({
        x: p.x + n.x * 2, y: p.y + n.y * 2, z: p.z + n.z * 2,
        vx: n.x * sp + (Math.random() - 0.5) * speed * 0.6, vy: n.y * sp + (Math.random() - 0.2) * speed * 0.5 + 6, vz: n.z * sp + (Math.random() - 0.5) * speed * 0.6,
        life: life * (0.75 + Math.random() * 0.5), s0: size * 0.55, s1: size * (1.1 + Math.random() * 0.5), a: 0.7, fadeIn: 0.03, drag: 2.2, grav: -4,
        col: [col[0] * 0.8 + 0.15, col[1] * 0.8 + 0.15, col[2] * 0.8 + 0.15],
      });
    }
  }

  // sparks off metal: a bright pop and hot bits flying out and falling
  sparks(p, n, amount = 1) {
    this.floorBelow(p);
    this.glow.add({ x: p.x + n.x, y: p.y + n.y, z: p.z + n.z, life: 0.09, s0: 12 * amount, s1: 5, a: 1, fadeIn: 0.001, col: [1, 0.85, 0.55] });
    const count = Math.round((6 + Math.random() * 6) * amount * (0.5 + 0.5 * this.quality.effects));
    for (let i = 0; i < count; i++) {
      const sp = 150 + Math.random() * 320;
      const dx = n.x + (Math.random() - 0.5) * 1.4, dy = n.y + (Math.random() - 0.3) * 1.4, dz = n.z + (Math.random() - 0.5) * 1.4;
      const l = Math.hypot(dx, dy, dz) || 1;
      this.glow.add({
        x: p.x + n.x, y: p.y + n.y, z: p.z + n.z, vx: (dx / l) * sp, vy: (dy / l) * sp, vz: (dz / l) * sp,
        life: 0.15 + Math.random() * 0.3, s0: 2.2, s1: 1, a: 1, fadeIn: 0.001, drag: 2, grav: 700, spin: 0,
        col: [1, 0.62 + Math.random() * 0.3, 0.25], ground: this.groundY + 0.4,
      });
    }
  }

  // a wisp of smoke from a hot barrel (k: 1 right after the burst, fading to 0)
  gunSmoke(p, k) {
    this.soft.add({
      x: p.x + (Math.random() - 0.5) * 0.6, y: p.y, z: p.z + (Math.random() - 0.5) * 0.6,
      vx: (Math.random() - 0.5) * 5, vy: 9 + Math.random() * 9, vz: (Math.random() - 0.5) * 5,
      life: 1.2 + Math.random() * 0.6, s0: 2.2, s1: 8 + Math.random() * 3, a: 0.32 * (0.35 + 0.65 * k), fadeIn: 0.15, drag: 0.6, grav: -6,
      col: [0.82, 0.82, 0.8],
    });
  }

  puff(p, color, size = 10, life = 0.7, rise = 12, force = false) {
    if (!this.quality.smoke && !force) return;
    const sm = this.smoke[this.nextSmoke];
    this.nextSmoke = (this.nextSmoke + 1) % MAX_SMOKE;
    sm.s.position.set(p.x, p.y, p.z);
    sm.s.material.color.setRGB(color[0], color[1], color[2]);
    sm.s.material.rotation = Math.random() * Math.PI * 2;
    sm.life = sm.max = life;
    sm.size = size;
    sm.vy = rise;
    sm.alpha = 0.55;
    sm.s.visible = true;
  }

  // a bullet hitting a surface: a hole, and what the material throws up
  // (sparks off metal, a cloud of sand, wood splinters, chips of stone or tile)
  impact(p, n, mat) {
    this.floorBelow({ x: p.x + n.x * 2, y: p.y + n.y * 2, z: p.z + n.z * 2 });
    const kind = DECAL_KIND[mat] || 'concrete';
    this.decal(p, n, kind);
    const c = IMPACT_COLOR[mat] || [0.7, 0.7, 0.7];
    const fx = IMPACT_FX[mat] || 'stone';
    const q = this.quality.effects;
    const o = { x: p.x + n.x, y: p.y + n.y, z: p.z + n.z };
    // grains: [count, speed, life, gravity]
    const grains = { metal: [4, 120, 0.3, 500], sand: [16, 110, 0.6, 420], wood: [6, 80, 0.5, 260], stone: [9, 75, 0.6, 180], tile: [6, 90, 0.4, 300], dirt: [12, 90, 0.6, 380], glass: [5, 60, 0.6, 500] }[fx];
    const count = Math.round(grains[0] * q);
    for (let i = 0; i < count; i++) {
      const sp = grains[1];
      // sand and dirt spray up out of the ground
      const lift = fx === 'sand' || fx === 'dirt' ? 0.8 : 0;
      const vx = n.x * sp * (0.5 + Math.random()) + (Math.random() - 0.5) * sp;
      const vy = n.y * sp * (0.5 + Math.random()) + (Math.random() - 0.3 + lift) * sp;
      const vz = n.z * sp * (0.5 + Math.random()) + (Math.random() - 0.5) * sp;
      const shade = fx === 'metal' ? 0.6 : 0.7 + Math.random() * 0.4;
      this.spawn(o.x, o.y, o.z, vx, vy, vz, c[0] * shade, c[1] * shade, c[2] * shade, grains[2] * (0.6 + Math.random() * 0.8), grains[3]);
    }
    if (fx === 'metal') this.sparks(p, n, 1);
    if (fx === 'wood') {
      // splinters
      const k = Math.round((2 + Math.random() * 3) * q);
      for (let i = 0; i < k; i++) {
        tmpS.set(n.x * (60 + Math.random() * 90) + (Math.random() - 0.5) * 90, n.y * 60 + 30 + Math.random() * 70, n.z * (60 + Math.random() * 90) + (Math.random() - 0.5) * 90);
        const s = 0.9 + Math.random() * 0.4;
        this.chip(o, tmpS, [c[0] * s * 1.2, c[1] * s * 1.2, c[2] * s * 1.2], [0.35, 0.35, 1.6 + Math.random() * 2.2], 1.6 + Math.random());
      }
    } else if (fx === 'stone' || fx === 'tile') {
      // chips of stone, plaster or tile
      const k = Math.round((1 + Math.random() * 3) * q);
      for (let i = 0; i < k; i++) {
        tmpS.set(n.x * (50 + Math.random() * 80) + (Math.random() - 0.5) * 80, n.y * 50 + 20 + Math.random() * 60, n.z * (50 + Math.random() * 80) + (Math.random() - 0.5) * 80);
        const s = 0.8 + Math.random() * 0.35;
        const z = 0.5 + Math.random() * 0.7;
        this.chip(o, tmpS, [c[0] * s, c[1] * s, c[2] * s], fx === 'tile' ? [1.1 * z + 0.3, 0.3, 1.1 * z] : [z, z * 0.8, z * 1.1], 1.4 + Math.random() * 0.8);
      }
    }
    if (fx === 'sand' || fx === 'dirt') {
      // a cloud of sand or earth hangs in the air
      this.dust(p, n, c, 24 + Math.random() * 8, 1.6, Math.max(2, Math.round(4 * q)), 34);
    } else if (this.quality.smoke) {
      // the wall puff from 1.6
      const pc = fx === 'metal' ? [0.7, 0.7, 0.7] : c;
      this.dust(p, n, pc, 13 + Math.random() * 4, 0.85, fx === 'glass' ? 0 : 2, 18);
    }
  }

  // water thrown up where something hits the surface (size 1: a person landing)
  splash(p, size = 1) {
    this.groundY = p.y;
    const count = Math.round(14 * size * this.quality.effects);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, sp = (20 + Math.random() * 60) * size;
      const k = 0.8 + Math.random() * 0.2;
      this.spawn(p.x, p.y + 1, p.z, Math.cos(a) * sp, (90 + Math.random() * 160) * Math.sqrt(size), Math.sin(a) * sp, 0.78 * k, 0.88 * k, 0.95 * k, 0.4 + Math.random() * 0.4, 700);
    }
    this.puff({ x: p.x, y: p.y + 4, z: p.z }, [0.85, 0.92, 0.97], 10 * size + 4, 0.45, 14);
  }

  blood(p, dir, amount = 1) {
    this.floorBelow(p);
    const n = Math.round(12 * amount * this.quality.effects);
    for (let i = 0; i < n; i++) {
      const sp = 40 + Math.random() * 100;
      this.spawn(p.x, p.y, p.z,
        dir.x * sp + (Math.random() - 0.5) * 70,
        dir.y * sp + (Math.random() - 0.2) * 70,
        dir.z * sp + (Math.random() - 0.5) * 70,
        0.5 + Math.random() * 0.2, 0.02, 0.02, 0.35 + Math.random() * 0.35, 450);
    }
    // a red mist where the bullet went in
    this.soft.add({ x: p.x, y: p.y, z: p.z, vx: dir.x * 30, vy: 4, vz: dir.z * 30, life: 0.4, s0: 3, s1: 12 * amount, a: 0.7, fadeIn: 0.02, drag: 4, col: [0.5, 0.04, 0.03] });
    // blood sprayed on the wall or floor behind the victim, a few drops around it
    const w = this.map.world;
    const dx = dir.x, dy = dir.y - 0.3, dz = dir.z, dl = Math.hypot(dx, dy, dz) || 1;
    const hit = w.traceRay(p.x, p.y, p.z, dx / dl, dy / dl, dz / dl, 200);
    if (hit) {
      const nrm = { x: hit.nx, y: hit.ny, z: hit.nz };
      const far = 1 - hit.t / 200; // close walls get a bigger splash
      this.decal(hit, nrm, 'blood', (10 + Math.random() * 10 * amount) * (0.6 + far * 0.6));
      const drops = Math.round((1 + Math.random() * 2) * amount);
      for (let i = 0; i < drops; i++) {
        // spread across the wall's own plane
        const ox = (Math.random() - 0.5) * 30, oy = (Math.random() - 0.5) * 30;
        let qx = hit.x, qy = hit.y, qz = hit.z;
        if (nrm.x) { qy += ox; qz += oy; } else if (nrm.y) { qx += ox; qz += oy; } else { qx += ox; qy += oy; }
        // only where the wall goes on (not off its edge)
        const back = w.traceRay(qx + nrm.x * 4, qy + nrm.y * 4, qz + nrm.z * 4, -nrm.x, -nrm.y, -nrm.z, 8);
        if (back) this.decal(back, nrm, 'blood', 3 + Math.random() * 5);
      }
    }
    // and drips on the floor under a bad hit
    if (amount > 1.2 || Math.random() < 0.35) {
      const fl = w.traceRay(p.x + dir.x * 12, p.y, p.z + dir.z * 12, 0, -1, 0, 120);
      if (fl && fl.ny > 0.7) this.decal(fl, { x: 0, y: 1, z: 0 }, 'blood', 6 + Math.random() * 8 * amount);
    }
  }

  // kind: 'rifle' | 'pistol' | 'awp' | 'shotgun'
  shell(pos, vel, kind) {
    const i = this.nextShell;
    const s = this.shells[i];
    this.nextShell = (this.nextShell + 1) % this.shellCap;
    s.p.copy(pos);
    s.v.copy(vel);
    s.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    s.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
    s.life = SHELL_LIFE;
    s.bounces = 0;
    s.scale = kind === 'pistol' ? 0.75 : kind === 'awp' ? 1.4 : kind === 'shotgun' ? 1.6 : 1.1;
    this.shellMesh.setColorAt(i, kind === 'shotgun' ? RED_SHELL : BRASS);
    this.shellMesh.instanceColor.needsUpdate = true;
    const hit = this.map.world.traceRay(pos.x, pos.y, pos.z, 0, -1, 0, 400);
    s.ground = hit ? hit.y : 0;
  }

  muzzleLight(p) {
    if (this.quality.dlights) this.map.dynLights.flash(p.x, p.y, p.z);
  }

  fireball(p, color, size0, size1, life, map) {
    const f = this.fireballs[this.nextFireball];
    this.nextFireball = (this.nextFireball + 1) % MAX_FIREBALLS;
    f.s.material.map = map || this.T.fireball;
    f.s.position.set(p.x, p.y, p.z);
    f.s.material.color.setRGB(color[0], color[1], color[2]);
    f.s.material.rotation = Math.random() * Math.PI * 2;
    f.life = f.max = life;
    f.size0 = size0;
    f.size1 = size1;
    f.s.visible = true;
  }

  // HE grenade blast
  explosion(p) {
    this.floorBelow(p);
    this.fireball({ x: p.x, y: p.y + 30, z: p.z }, [1, 0.85, 0.6], 60, 210, 0.45);
    this.fireball({ x: p.x + 12, y: p.y + 60, z: p.z - 8 }, [1, 0.6, 0.3], 40, 160, 0.6);
    this.fireball({ x: p.x, y: p.y + 6, z: p.z }, [1, 1, 0.85], 90, 120, 0.12, this.T.flash);
    const n = Math.round(46 * this.quality.effects);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, up = 0.2 + Math.random() * 0.9, sp = 180 + Math.random() * 420;
      const hot = Math.random() < 0.5;
      this.spawn(p.x, p.y + 4, p.z, Math.cos(a) * sp * (1 - up * 0.5), up * sp, Math.sin(a) * sp * (1 - up * 0.5),
        hot ? 1 : 0.35, hot ? 0.7 : 0.3, hot ? 0.3 : 0.25, 0.4 + Math.random() * 0.8, 600);
    }
    const puffs = this.quality.smoke ? 9 : 3;
    for (let i = 0; i < puffs; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 60;
      const g = 0.22 + Math.random() * 0.15;
      this.puff({ x: p.x + Math.cos(a) * r, y: p.y + 20 + Math.random() * 60, z: p.z + Math.sin(a) * r }, [g, g * 0.95, g * 0.9], 70 + Math.random() * 50, 2 + Math.random() * 1.2, 22, true);
    }
    if (this.quality.dlights) this.map.dynLights.flash(p.x, p.y + 30, p.z, 2.4, 1.5, 0.6, 560, 0.5);
    // scorch mark on the floor
    const hit = this.map.world.traceRay(p.x, p.y + 4, p.z, 0, -1, 0, 80);
    if (hit) this.decal(hit, { x: 0, y: 1, z: 0 }, 'scorch', 70 + Math.random() * 20);
  }

  // the C4 going off: a much bigger fireball, a cloud of dust and a long light
  bigExplosion(p) {
    this.floorBelow(p);
    const base = { x: p.x, y: p.y, z: p.z };
    this.fireball({ x: base.x, y: base.y + 30, z: base.z }, [1, 1, 0.9], 300, 420, 0.18, this.T.flash);
    this.fireball({ x: base.x, y: base.y + 100, z: base.z }, [1, 0.62, 0.26], 200, 640, 1.3);
    this.fireball({ x: base.x + 70, y: base.y + 210, z: base.z - 40 }, [1, 0.5, 0.18], 140, 520, 1.6);
    this.fireball({ x: base.x - 80, y: base.y + 160, z: base.z + 60 }, [0.95, 0.45, 0.15], 140, 500, 1.5);
    this.fireball({ x: base.x, y: base.y + 300, z: base.z }, [0.8, 0.3, 0.1], 120, 560, 1.9);
    const n = Math.round(160 * this.quality.effects);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, up = 0.2 + Math.random() * 0.9, sp = 300 + Math.random() * 900;
      const hot = Math.random() < 0.5;
      this.spawn(base.x, base.y + 10, base.z, Math.cos(a) * sp * (1 - up * 0.5), up * sp, Math.sin(a) * sp * (1 - up * 0.5),
        hot ? 1 : 0.4, hot ? 0.7 : 0.33, hot ? 0.3 : 0.26, 0.8 + Math.random() * 1.4, 600);
    }
    // a dark column of smoke and dust that hangs around
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 180;
      const g = 0.1 + Math.random() * 0.1;
      this.puff({ x: base.x + Math.cos(a) * r, y: base.y + 60 + Math.random() * 300, z: base.z + Math.sin(a) * r }, [g, g * 0.92, g * 0.85], 220 + Math.random() * 160, 5 + Math.random() * 2.5, 36, true);
    }
    if (this.quality.dlights) this.map.dynLights.flash(base.x, base.y + 80, base.z, 3, 1.9, 0.8, 1600, 1.4);
    const hit = this.map.world.traceRay(base.x, base.y + 4, base.z, 0, -1, 0, 80);
    if (hit) this.decal(hit, { x: 0, y: 1, z: 0 }, 'scorch', 220);
  }

  // a bullet through a window: a few glittering bits
  glassHit(p, n) {
    this.floorBelow(p);
    for (let i = 0; i < 5; i++) {
      this.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 80 - n.x * 40, Math.random() * 40, (Math.random() - 0.5) * 80 - n.z * 40, 0.85, 0.95, 1, 0.5 + Math.random() * 0.4, 500);
    }
  }

  // a window, vent cover or crate bursting into pieces
  gibs(box, kind, dir) {
    const k = kind === 'glass' ? 'glass' : 'solid';
    const col = kind === 'glass' ? new THREE.Color(0.8, 0.92, 1) : kind === 'metal' ? new THREE.Color(0.55, 0.56, 0.58) : new THREE.Color(0.6, 0.42, 0.24);
    const sx = box.max[0] - box.min[0], sy = box.max[1] - box.min[1], sz = box.max[2] - box.min[2];
    const hit = this.map.world.traceRay((box.min[0] + box.max[0]) / 2, box.min[1] + 0.5, (box.min[2] + box.max[2]) / 2, 0, -1, 0, 600);
    const ground = hit ? hit.y : box.min[1];
    const count = kind === 'glass' ? 22 : 14;
    const im = this.gibMesh[k];
    for (let i = 0; i < count; i++) {
      const g = this.gibList[k][this.nextGib[k]];
      im.setColorAt(this.nextGib[k], col.clone().multiplyScalar(0.85 + Math.random() * 0.3));
      this.nextGib[k] = (this.nextGib[k] + 1) % MAX_GIBS;
      g.p.set(box.min[0] + Math.random() * sx, box.min[1] + Math.random() * sy, box.min[2] + Math.random() * sz);
      const push = dir ? 120 : 0;
      g.v.set((Math.random() - 0.5) * 140 + (dir ? dir.x * push : 0), 40 + Math.random() * 120, (Math.random() - 0.5) * 140 + (dir ? dir.z * push : 0));
      g.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      g.w.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
      if (kind === 'glass') g.s.set(2 + Math.random() * 5, 0.25, 2 + Math.random() * 5);
      else if (kind === 'metal') g.s.set(2 + Math.random() * 6, 0.4, 1 + Math.random() * 3);
      else g.s.set(1.5 + Math.random() * 3, 1 + Math.random() * 2, 4 + Math.random() * 10);
      g.life = 3 + Math.random() * 1.5;
      g.ground = ground + g.s.y * 0.5;
    }
    im.instanceColor.needsUpdate = true;
    this.floorBelow({ x: (box.min[0] + box.max[0]) / 2, y: box.min[1] + 1, z: (box.min[2] + box.max[2]) / 2 });
    const pc = kind === 'glass' ? [0.85, 0.85, 0.85] : [0.6, 0.5, 0.38];
    this.puff({ x: (box.min[0] + box.max[0]) / 2, y: (box.min[1] + box.max[1]) / 2, z: (box.min[2] + box.max[2]) / 2 }, pc, 30, 0.8, 10);
  }

  // decals on something that's gone shouldn't float in the air
  clearDecalsIn(box) {
    for (const k in this.decals) {
      const d = this.decals[k];
      let dirty = false;
      for (let i = 0; i < d.im.count; i++) {
        d.im.getMatrixAt(i, tmpM);
        const e = tmpM.elements;
        if (e[0] === 0 && e[1] === 0 && e[2] === 0) continue;
        if (e[12] > box.min[0] - 1 && e[12] < box.max[0] + 1 && e[13] > box.min[1] - 1 && e[13] < box.max[1] + 1 && e[14] > box.min[2] - 1 && e[14] < box.max[2] + 1) {
          d.im.setMatrixAt(i, ZERO);
          dirty = true;
        }
      }
      if (dirty) d.im.instanceMatrix.needsUpdate = true;
    }
  }

  // flashbang pop
  flashBurst(p) {
    this.floorBelow(p);
    this.fireball(p, [1, 1, 1], 60, 260, 0.2, this.T.flash);
    const n = Math.round(18 * this.quality.effects);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, up = Math.random(), sp = 150 + Math.random() * 250;
      this.spawn(p.x, p.y + 2, p.z, Math.cos(a) * sp, up * sp, Math.sin(a) * sp, 1, 1, 0.9, 0.2 + Math.random() * 0.3, 400);
    }
    if (this.quality.smoke) this.puff({ x: p.x, y: p.y + 10, z: p.z }, [0.8, 0.8, 0.8], 40, 1.2, 15);
    if (this.quality.dlights) this.map.dynLights.flash(p.x, p.y + 20, p.z, 2.6, 2.6, 2.6, 700, 0.25);
  }

  update(dt) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -1e4;
        continue;
      }
      this.vel[k + 1] -= this.grav[i] * dt;
      const drag = 1 - Math.min(1, dt * 2.5);
      this.vel[k] *= drag;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < this.ground[i]) {
        this.pos[k + 1] = this.ground[i];
        this.vel[k + 1] *= -0.3;
      }
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;

    for (const sm of this.smoke) {
      if (sm.life <= 0) continue;
      sm.life -= dt;
      if (sm.life <= 0) {
        sm.s.visible = false;
        continue;
      }
      const t = 1 - sm.life / sm.max;
      const size = sm.size * (0.6 + t * 1.4);
      sm.s.scale.set(size, size, 1);
      sm.s.position.y += sm.vy * dt;
      sm.s.material.opacity = sm.alpha * (1 - t) * Math.min(1, t * 8);
    }

    let dirty = false;
    for (let i = 0; i < this.shellCap; i++) {
      const s = this.shells[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        this.shellMesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
        dirty = true;
        continue;
      }
      // lying still: nothing to update until it fades away at the end
      if (s.bounces >= 4 && s.placed && s.life > 0.6) continue;
      dirty = true;
      if (s.bounces < 4) {
        s.v.y -= 800 * dt;
        s.p.addScaledVector(s.v, dt);
        s.r.addScaledVector(s.w, dt);
        if (s.p.y < s.ground + 0.3) {
          s.p.y = s.ground + 0.3;
          if (s.v.y < 0) {
            if (s.bounces === 0 && this.onShellBounce) this.onShellBounce(s.p);
            s.v.y *= -0.35;
            s.v.x *= 0.55;
            s.v.z *= 0.55;
            s.w.multiplyScalar(0.5);
            s.bounces++;
            if (Math.abs(s.v.y) < 25) s.bounces = 4;
          }
        }
        if (s.bounces >= 4) s.r.x = Math.PI / 2 * Math.round(s.r.x / (Math.PI / 2)); // lie flat
        s.placed = false;
      } else s.placed = true;
      tmpQ.setFromEuler(tmpE.set(s.r.x, s.r.y, s.r.z));
      tmpS.setScalar(s.scale * Math.min(1, s.life / 0.6));
      this.shellMesh.setMatrixAt(i, tmpM.compose(s.p, tmpQ, tmpS));
    }
    if (dirty) this.shellMesh.instanceMatrix.needsUpdate = true;

    // splinters and chips
    let chipsMoved = false;
    for (let i = 0; i < MAX_CHIPS; i++) {
      const c = this.chips[i];
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) {
        this.chipMesh.setMatrixAt(i, ZERO);
        chipsMoved = true;
        continue;
      }
      if (c.rest && c.life > 0.4) continue;
      chipsMoved = true;
      if (!c.rest) {
        c.v.y -= 800 * dt;
        c.p.addScaledVector(c.v, dt);
        c.r.addScaledVector(c.w, dt);
        if (c.p.y < c.ground) {
          c.p.y = c.ground;
          c.v.multiplyScalar(0.4);
          c.v.y = Math.abs(c.v.y) > 40 ? -c.v.y : 0;
          c.w.multiplyScalar(0.4);
          if (c.v.y === 0) {
            c.rest = true;
            c.r.x = c.r.z = 0;
          }
        }
      }
      tmpQ.setFromEuler(tmpE.set(c.r.x, c.r.y, c.r.z));
      tmpS.copy(c.s).multiplyScalar(Math.min(1, c.life / 0.4));
      this.chipMesh.setMatrixAt(i, tmpM.compose(c.p, tmpQ, tmpS));
    }
    if (chipsMoved) this.chipMesh.instanceMatrix.needsUpdate = true;
    this.soft.update(dt);
    this.glow.update(dt);

    for (const k of ['solid', 'glass']) {
      const im = this.gibMesh[k];
      let moved = false;
      for (let i = 0; i < MAX_GIBS; i++) {
        const g = this.gibList[k][i];
        if (g.life <= 0) continue;
        moved = true;
        g.life -= dt;
        if (g.life <= 0) {
          im.setMatrixAt(i, ZERO);
          continue;
        }
        if (g.p.y > g.ground || g.v.y > 0) {
          g.v.y -= 800 * dt;
          g.p.addScaledVector(g.v, dt);
          g.r.addScaledVector(g.w, dt);
          if (g.p.y < g.ground) {
            g.p.y = g.ground;
            g.v.multiplyScalar(0.35);
            g.v.y = Math.abs(g.v.y) > 30 ? -g.v.y : 0;
            g.w.multiplyScalar(0.4);
            if (g.v.y === 0) g.r.x = g.r.z = 0;
          }
        }
        tmpQ.setFromEuler(tmpE.set(g.r.x, g.r.y, g.r.z));
        tmpS.copy(g.s).multiplyScalar(Math.min(1, g.life * 2));
        im.setMatrixAt(i, tmpM.compose(g.p, tmpQ, tmpS));
      }
      if (moved) im.instanceMatrix.needsUpdate = true;
    }

    for (const f of this.fireballs) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.s.visible = false;
        continue;
      }
      const t = 1 - f.life / f.max;
      const size = f.size0 + (f.size1 - f.size0) * (1 - (1 - t) ** 2);
      f.s.scale.set(size, size, 1);
      f.s.material.opacity = 1 - t * t;
    }

    this.updateTracers(dt);
    this.map.dynLights.update(dt);
  }

  clear() {
    for (const tr of this.tracers) tr.live = false;
    this.trMesh.geometry.setDrawRange(0, 0);
    for (const k in this.decals) {
      const d = this.decals[k];
      for (let i = 0; i < d.im.count; i++) d.im.setMatrixAt(i, ZERO);
      d.im.instanceMatrix.needsUpdate = true;
      d.next = d.used = 0;
    }
    this.life.fill(0);
    for (let i = 0; i < MAX_PARTICLES; i++) this.pos[i * 3 + 1] = -1e4;
    for (const sm of this.smoke) { sm.life = 0; sm.s.visible = false; }
    for (let i = 0; i < MAX_SHELLS; i++) {
      this.shells[i].life = 0;
      this.shellMesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
    }
    this.shellMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < MAX_CHIPS; i++) {
      this.chips[i].life = 0;
      this.chipMesh.setMatrixAt(i, ZERO);
    }
    this.chipMesh.instanceMatrix.needsUpdate = true;
    this.soft.clear();
    this.glow.clear();
    for (const f of this.fireballs) {
      f.life = 0;
      f.s.visible = false;
    }
    for (const k of ['solid', 'glass']) {
      for (let i = 0; i < MAX_GIBS; i++) {
        this.gibList[k][i].life = 0;
        this.gibMesh[k].setMatrixAt(i, ZERO);
      }
      this.gibMesh[k].instanceMatrix.needsUpdate = true;
    }
  }
}

