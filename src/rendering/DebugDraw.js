/**
 * DebugDraw.js — optional physics visualisation overlay (toggle with G).
 *
 * Draws, for the ball:
 *   • velocity vector          (green)   — v
 *   • angular-velocity vector  (cyan)    — ω
 *   • friction force vector    (red)     — opposes the contact slip
 *   • normal force vector      (yellow)  — N = m g, straight up from contact
 *   • centre of mass           (white dot)
 * Plus contact-point markers (orange dots) for every active contact, and a
 * recorded path trail showing the realised trajectory (the hook curve).
 *
 * Everything is parented to one group so it can be shown/hidden in one call and
 * never interferes with the simulation (visualisation only).
 */

import * as THREE from 'three';
import { CONFIG, G } from '../config.js';

const _dir = new THREE.Vector3();
const _slip = new THREE.Vector3();
const _origin = new THREE.Vector3();

export class DebugDraw {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.enabled = false;

    this.vArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1, 0x5ad17a, 0.12, 0.07);
    this.wArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0x49d6e6, 0.12, 0.07);
    this.fArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.5, 0xff5a4d, 0.1, 0.06);
    this.nArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.5, 0xffd24d, 0.1, 0.06);
    this.group.add(this.vArrow, this.wArrow, this.fArrow, this.nArrow);

    this.com = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    this.group.add(this.com);

    // Contact markers pool.
    this._markers = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffa033 })
      );
      m.visible = false;
      this.group.add(m);
      this._markers.push(m);
    }

    // Path trail.
    this._trailMax = 240;
    this._trailPositions = new Float32Array(this._trailMax * 3);
    this._trailGeo = new THREE.BufferGeometry();
    this._trailGeo.setAttribute('position', new THREE.BufferAttribute(this._trailPositions, 3));
    this._trailGeo.setDrawRange(0, 0);
    this._trail = new THREE.Line(this._trailGeo, new THREE.LineBasicMaterial({ color: 0xff7bd0 }));
    this.group.add(this._trail);
    this._trailCount = 0;
  }

  setEnabled(on) {
    this.enabled = on;
    this.group.visible = on;
    if (!on) this.clearTrail();
  }
  toggle() { this.setEnabled(!this.enabled); return this.enabled; }

  clearTrail() {
    this._trailCount = 0;
    this._trailGeo.setDrawRange(0, 0);
  }

  _pushTrail(p) {
    if (this._trailCount >= this._trailMax) {
      // shift left by one (cheap; trail is short)
      this._trailPositions.copyWithin(0, 3);
      this._trailCount = this._trailMax - 1;
    }
    const i = this._trailCount * 3;
    this._trailPositions[i] = p.x;
    this._trailPositions[i + 1] = p.y;
    this._trailPositions[i + 2] = p.z;
    this._trailCount++;
    this._trailGeo.setDrawRange(0, this._trailCount);
    this._trailGeo.attributes.position.needsUpdate = true;
  }

  /**
   * @param ball     Ball entity
   * @param contacts array of active Contact (from the collision system)
   * @param tracking true while the ball is in play (records the trail)
   */
  update(ball, contacts, tracking) {
    if (!this.enabled) return;
    const p = ball.position;
    this.com.position.copy(p);

    // velocity
    const v = ball.body.velocity;
    const vlen = v.length();
    if (vlen > 0.05) {
      this.vArrow.position.copy(p);
      this.vArrow.setDirection(_dir.copy(v).multiplyScalar(1 / vlen));
      this.vArrow.setLength(Math.min(vlen * 0.18, 2.2), 0.12, 0.07);
      this.vArrow.visible = true;
    } else this.vArrow.visible = false;

    // angular velocity
    const w = ball.body.angularVelocity;
    const wlen = w.length();
    if (wlen > 0.2) {
      this.wArrow.position.copy(p);
      this.wArrow.setDirection(_dir.copy(w).multiplyScalar(1 / wlen));
      this.wArrow.setLength(Math.min(wlen * 0.03, 1.2), 0.12, 0.07);
      this.wArrow.visible = true;
    } else this.wArrow.visible = false;

    // contact + friction + normal (only while on the boards)
    _origin.copy(p); _origin.y -= ball.radius;
    const onBoards = p.y < ball.radius * 1.4;
    if (onBoards) {
      _slip.copy(ball._contactVel());
      const slen = _slip.length();
      this.nArrow.position.copy(_origin);
      this.nArrow.setLength(Math.min(G * 0.05, 0.6), 0.1, 0.06); // N = m g (per-unit-mass length)
      this.nArrow.visible = true;
      if (slen > 0.05) {
        this.fArrow.position.copy(_origin);
        this.fArrow.setDirection(_dir.copy(_slip).multiplyScalar(-1 / slen)); // friction opposes slip
        this.fArrow.setLength(0.3 + Math.min(slen * 0.08, 0.5), 0.1, 0.06);
        this.fArrow.visible = true;
      } else this.fArrow.visible = false;
    } else {
      this.nArrow.visible = false;
      this.fArrow.visible = false;
    }

    // contact markers
    let mi = 0;
    for (const c of contacts) {
      if (mi >= this._markers.length) break;
      if (c.bodyA.tag === 'ball' || c.bodyB.tag === 'ball') {
        this._markers[mi].position.copy(c.point);
        this._markers[mi].visible = true;
        mi++;
      }
    }
    for (; mi < this._markers.length; mi++) this._markers[mi].visible = false;

    // trail
    if (tracking) this._pushTrail(p);
  }
}
