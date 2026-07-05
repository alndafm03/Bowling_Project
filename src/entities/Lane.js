/**
 * Lane.js — the playfield: visuals + the body↔world collision generator.
 *
 * Visuals render the oil pattern as three bands whose sheen matches μ(z):
 *   oiled head (shiny, μ≈0.03) → transition (semi-gloss) → dry back-end
 *   (matte, μ≈0.15).  Plus approach, foul line, aiming arrows, gutters, side
 *   walls and the back wall / pit.
 *
 * Collision: there are NO pre-baked static bodies. Instead `collideBody`
 * generates contacts on demand for whatever rests on or hits the lane:
 *   • FLOOR    — the lane bed (μ from laneFrictionAt) or the lower gutter
 *                channel; this is the surface that produces skid → hook → roll.
 *   • WALLS    — outer side rails (or bumpers, when enabled) and the back wall,
 *                with the study's elastic restitution.
 * One contact is emitted per collision sphere of the body, so the same code
 * serves the ball (one sphere) and the pins (their base-ring + axis spheres).
 */

import * as THREE from 'three';
import { CONFIG, laneFrictionAt } from '../config.js';

const N_UP = new THREE.Vector3(0, 1, 0);
const N_LEFT = new THREE.Vector3(-1, 0, 0);
const N_RIGHT = new THREE.Vector3(1, 0, 0);
const N_BACK = new THREE.Vector3(0, 0, 1);
const _pt = new THREE.Vector3();

const FLOOR_MARGIN = 0.01;  // speculative margin → stable resting contacts
const WALL_FRICTION = 0.10;

function makeWoodTexture(base, tint = 1) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 1024;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i <= 8; i++) {
    const x = (i / 8) * c.width;
    ctx.strokeStyle = 'rgba(60,40,20,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke();
  }
  for (let i = 0; i < 9000; i++) {
    const a = Math.random() * 0.06;
    ctx.fillStyle = `rgba(${30 * tint},${18 * tint},6,${a})`;
    ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 1, Math.random() * 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Lane {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.L = CONFIG.lane.length;
    this.W = CONFIG.lane.width;
    this.T = CONFIG.lane.thickness;
    this.bumpersOn = false;
    this._bumperMeshes = [];

    this._buildSurface();
    this._buildArrows();
    this._buildGuttersAndWalls();
    this._buildBackdrop();
  }

  /* ------------------------------------------------------------------ */
  /* Visuals                                                             */
  /* ------------------------------------------------------------------ */
  _section(len, z0, tex, roughness) {
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness, metalness: 0.0, envMapIntensity: 0.6 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(this.W, this.T, len), mat);
    mesh.position.set(0, -this.T / 2, z0 - len / 2);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  _buildSurface() {
    const { oilEnd, dryStart } = CONFIG.lane;
    const oilLen = oilEnd;
    const transLen = dryStart - oilEnd;
    const dryLen = this.L - dryStart;

    const oilTex = makeWoodTexture('#b98c54', 1.0); oilTex.repeat.set(2, oilLen / 2);
    const transTex = makeWoodTexture('#b0824c', 1.15); transTex.repeat.set(2, transLen / 2);
    const dryTex = makeWoodTexture('#a87a44', 1.3); dryTex.repeat.set(2, dryLen / 2);

    this._section(oilLen, 0, oilTex, 0.16);          // oiled head — shiny
    this._section(transLen, -oilEnd, transTex, 0.38); // transition — semi-gloss
    this._section(dryLen, -dryStart, dryTex, 0.62);   // dry back-end — matte

    // Approach (behind the foul line).
    const apLen = CONFIG.lane.approachLength;
    const ap = new THREE.Mesh(
      new THREE.BoxGeometry(this.W + CONFIG.lane.gutterWidth * 2, this.T, apLen),
      new THREE.MeshStandardMaterial({ color: 0x3a4051, roughness: 0.8 })
    );
    ap.position.set(0, -this.T / 2, apLen / 2);
    ap.receiveShadow = true;
    this.group.add(ap);

    // Foul line.
    const foul = new THREE.Mesh(
      new THREE.PlaneGeometry(this.W, 0.04),
      new THREE.MeshBasicMaterial({ color: 0xff5a4d })
    );
    foul.rotation.x = -Math.PI / 2;
    foul.position.set(0, 0.002, 0);
    this.group.add(foul);
  }

  _buildArrows() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x1c2433 });
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.12); shape.lineTo(0.05, -0.06); shape.lineTo(-0.05, -0.06); shape.lineTo(0, 0.12);
    const geo = new THREE.ShapeGeometry(shape);
    for (let i = -3; i <= 3; i++) {
      const arrow = new THREE.Mesh(geo, mat);
      arrow.rotation.x = -Math.PI / 2;
      arrow.position.set(i * 0.13, 0.003, -(4.5 + Math.abs(i) * 0.35));
      this.group.add(arrow);
    }
  }

  _buildGuttersAndWalls() {
    const gw = CONFIG.lane.gutterWidth;
    const gd = CONFIG.lane.gutterDepth;
    const halfW = this.W / 2;
    const gutterCenterX = halfW + gw / 2;
    const gutterMat = new THREE.MeshStandardMaterial({ color: 0x10141f, roughness: 0.5, metalness: 0.2 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x232a3a, roughness: 0.7 });

    for (const side of [-1, 1]) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.04, this.L), gutterMat);
      g.position.set(side * gutterCenterX, -gd, -this.L / 2);
      g.receiveShadow = true;
      this.group.add(g);

      const wallX = halfW + gw + 0.03;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.06, CONFIG.lane.wallHeight, this.L), wallMat);
      wall.position.set(side * wallX, CONFIG.lane.wallHeight / 2 - 0.05, -this.L / 2);
      wall.castShadow = true;
      this.group.add(wall);
    }
  }

  _buildBackdrop() {
    const z = -this.L - 0.25;
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(this.W + 1.4, 1.6, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x0c1018, roughness: 0.9 })
    );
    wall.position.set(0, 0.6, z);
    wall.receiveShadow = true;
    this.group.add(wall);

    const mask = new THREE.Mesh(
      new THREE.BoxGeometry(this.W + 1.4, 1.2, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x161b27, roughness: 0.8, emissive: 0x0a1430, emissiveIntensity: 0.4 })
    );
    mask.position.set(0, 1.6, z + 0.1);
    this.group.add(mask);
  }

  /** Toggle gutter-sealing bumpers (beginner mode). */
  setBumpers(on) {
    this.bumpersOn = on;
    if (on && this._bumperMeshes.length === 0) {
      const halfW = this.W / 2;
      for (const side of [-1, 1]) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.16, this.L),
          new THREE.MeshStandardMaterial({ color: 0x4da3ff, emissive: 0x143a66, roughness: 0.4 })
        );
        mesh.position.set(side * (halfW + 0.02), 0.08, -this.L / 2);
        this.group.add(mesh);
        this._bumperMeshes.push(mesh);
      }
    } else if (!on && this._bumperMeshes.length) {
      this._bumperMeshes.forEach((m) => this.group.remove(m));
      this._bumperMeshes = [];
    }
  }

  /* ------------------------------------------------------------------ */
  /* Collision: emit body↔world contacts for one entity.                 */
  /* ------------------------------------------------------------------ */
  collideBody(entity, cs) {
    const { width: W, gutterWidth: gw, gutterDepth: gd } = CONFIG.lane;
    const halfW = W / 2;
    const wallInner = halfW + gw;
    const innerX = this.bumpersOn ? halfW : wallInner; // bounce face
    const backZ = -(this.L + 0.15);
    const isBall = entity.bodyKind === 'ball';
    const restFloor = isBall ? CONFIG.restitution.ballLane : CONFIG.restitution.floor;
    const restWall = CONFIG.restitution.wall;
    const body = entity.body;

    for (const s of entity.worldSpheres) {
      const ax = Math.abs(s.x);

      // ---- floor (lane bed or gutter channel) ----
      let supportY = null, mu = 0;
      if (ax <= halfW) {
        supportY = 0;
        mu = isBall ? laneFrictionAt(s.z) : CONFIG.friction.pinFloor;
      } else if (!this.bumpersOn && ax <= wallInner) {
        supportY = -gd;
        mu = CONFIG.friction.gutter;
      }
      if (supportY !== null) {
        const pen = supportY + s.r - s.y;
        if (pen > -FLOOR_MARGIN) {
          _pt.set(s.x, supportY, s.z);
          cs.addStaticContact(body, N_UP, _pt, pen, restFloor, mu);
        }
      }

      // ---- side walls / bumpers ----
      if (s.x + s.r > innerX) {
        _pt.set(innerX, s.y, s.z);
        cs.addStaticContact(body, N_LEFT, _pt, s.x + s.r - innerX, restWall, WALL_FRICTION);
      }
      if (s.x - s.r < -innerX) {
        _pt.set(-innerX, s.y, s.z);
        cs.addStaticContact(body, N_RIGHT, _pt, -innerX - (s.x - s.r), restWall, WALL_FRICTION);
      }

      // ---- back wall (pit) ----
      // The ball NEVER bounces off the back wall — it always breaks through
      // into the pit after passing the pins, and is hidden from there by
      // SimulationController once fully past it. Pins still rebound normally.
      if (!isBall && s.z - s.r < backZ) {
        _pt.set(s.x, s.y, backZ);
        cs.addStaticContact(body, N_BACK, _pt, backZ - (s.z - s.r), restWall, WALL_FRICTION);
      }
    }
  }
}