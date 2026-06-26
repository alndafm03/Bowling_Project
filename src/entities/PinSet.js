/**
 * PinSet.js — the ten-pin rack and its layout / reset / scoring.
 *
 * Layout is the regulation triangle, 12-inch (0.3048 m) centre-to-centre,
 * head pin (#1) nearest the bowler, rows receding down-lane:
 *
 *            7  8  9  10        (back row)
 *              4  5  6
 *                2  3
 *                 1             (head pin, nearest)
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Pin, pinProfile } from './Pin.js';

export class PinSet {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    // Shared geometry / materials across all ten pins.
    this._geo = new THREE.LatheGeometry(pinProfile(), 28);
    this._bodyMat = new THREE.MeshStandardMaterial({ color: 0xfdfdf7, roughness: 0.35, metalness: 0.0 });
    this._stripeMat = new THREE.MeshStandardMaterial({ color: 0xd23b3b, roughness: 0.4 });

    this.pins = [];
    const homes = this._homePositions();
    homes.forEach((h, i) => {
      const pin = new Pin(this.group, this._geo, this._bodyMat, this._stripeMat, i);
      pin.setHome(h.x, h.z);
      this.pins.push(pin);
    });
    this.rack();
  }

  /** Regulation 10-pin coordinates relative to the head pin. */
  _homePositions() {
    const s = CONFIG.pin.spacing;
    const h = s / 2;
    const d = s * Math.cos(Math.PI / 6); // row depth
    const z0 = CONFIG.pin.deckZ;
    return [
      { x: 0, z: z0 },              // 1 (head)
      { x: -h, z: z0 - d },         // 2
      { x: h, z: z0 - d },          // 3
      { x: -2 * h, z: z0 - 2 * d }, // 4
      { x: 0, z: z0 - 2 * d },      // 5
      { x: 2 * h, z: z0 - 2 * d },  // 6
      { x: -3 * h, z: z0 - 3 * d }, // 7
      { x: -h, z: z0 - 3 * d },     // 8
      { x: h, z: z0 - 3 * d },      // 9
      { x: 3 * h, z: z0 - 3 * d },  // 10
    ];
  }

  /** Re-rack all ten pins upright and asleep. */
  rack() {
    for (const p of this.pins) p.rack();
  }

  sync() {
    for (const p of this.pins) p.sync();
  }

  /** How many pins are currently down. */
  countDown() {
    let n = 0;
    for (const p of this.pins) if (p.isDown()) n++;
    return n;
  }

  get meshes() { return this.pins.map((p) => p.mesh); }
}
