/**
 * CameraManager.js — simplified to 3 modes only:
 *
 *   1 FOLLOW  — chase cam tracking the ball down the lane
 *   2 TOP     — top-down, follows the ball's progress
 *   3 FREE    — OrbitControls, unconstrained
 *
 * Keys 1–3 select directly; C cycles.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CONFIG } from '../config.js';

export const CameraMode = {
  FOLLOW: 'follow',
  TOP: 'top',
  FREE: 'free',
};

// Only 3 modes now
const ORDER = [CameraMode.FOLLOW, CameraMode.TOP, CameraMode.FREE];

// Labels for HUD
const LABELS = {
  follow: 'Follow',
  top: 'Top',
  free: 'Free',
};

export class CameraManager {
  constructor(domElement) {
    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      140
    );
    this.camera.position.set(2.6, 2.2, 3.6);

    this.listener = new THREE.AudioListener();
    this.camera.add(this.listener);

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 0.3, CONFIG.pin.deckZ * 0.5);
    this.controls.enabled = false;

    // Default mode
    this.mode = CameraMode.FOLLOW;

    this._desiredPos = new THREE.Vector3();
    this._desiredTarget = new THREE.Vector3(0, 0.3, -8);
    this._curTarget = new THREE.Vector3(0, 0.3, -8);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  setMode(mode) {
    this.mode = mode;

    // Only FREE uses OrbitControls
    const orbit = mode === CameraMode.FREE;
    this.controls.enabled = orbit;

    return LABELS[mode];
  }

  cycle() {
    const i = ORDER.indexOf(this.mode);
    return this.setMode(ORDER[(i + 1) % ORDER.length]);
  }

  setModeByDigit(d) {
    if (d >= 1 && d <= ORDER.length) {
      return this.setMode(ORDER[d - 1]);
    }
    return LABELS[this.mode];
  }

  get label() {
    return LABELS[this.mode];
  }

  /** Per-frame update. `ballPos` is a THREE.Vector3 (may be null). */
  update(ballPos, dt) {
    if (this.mode === CameraMode.FREE) {
      this.controls.update();
      return;
    }

    const p = ballPos || this._curTarget;

    switch (this.mode) {
      case CameraMode.FOLLOW:
        this._desiredPos.set(p.x * 0.5, p.y + 1.4, p.z + 3.0);
        this._desiredTarget.set(p.x * 0.6, p.y + 0.1, p.z - 4);
        break;

      case CameraMode.TOP:
        this._desiredPos.set(p.x * 0.3, 6.5, p.z + 0.5);
        this._desiredTarget.set(p.x * 0.3, 0, p.z - 0.5);
        break;

      default:
        break;
    }

    const a = 1 - Math.pow(0.0015, dt);
    this.camera.position.lerp(this._desiredPos, a);

    this._curTarget.lerp(this._desiredTarget, 1 - Math.pow(0.002, dt));
    this.camera.lookAt(this._curTarget);
  }
}
