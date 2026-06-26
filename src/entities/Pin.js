/**
 * Pin.js — a single ten-pin.
 *
 * Visual : a LatheGeometry silhouette centred on its own centre of mass.
 * Physics: a RigidBody with a short-cylinder inertia tensor (so it topples and
 *          spins about the correct axes when struck).
 *
 * Collision geometry:
 *   • a CAPSULE (axis segment + radius) used for ball↔pin and pin↔pin tests;
 *   • a set of CONTACT SPHERES for the pin↔lane (floor / wall) tests:
 *       – a 4-point ring at the base gives a real support polygon, so an
 *         upright pin stands stably (its CM projects inside the ring);
 *       – spheres along the axis (two caps + middle) catch the body when it
 *         topples, so a fallen pin rests cleanly on its side.
 *   When a hit tips the pin far enough that its CM leaves the base ring, the
 *   gravity torque carries it over — the topple is emergent, not animated.
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { RigidBody } from '../physics/RigidBody.js';

const _up = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

/** Centred pin profile (radius, height) → lathe; origin at the CM (mid-height). */
export function pinProfile() {
  const H = CONFIG.pin.height;
  const raw = [
    [0.010, 0.00], [0.030, 0.006], [0.034, 0.03], [0.048, 0.07],
    [0.060, 0.12], [0.057, 0.16], [0.040, 0.21], [0.026, 0.25],
    [0.020, 0.28], [0.027, 0.31], [0.028, 0.335], [0.020, 0.36],
    [0.007, H],
  ];
  return raw.map(([r, y]) => new THREE.Vector2(r, y - H / 2));
}

export class Pin {
  constructor(scene, geo, bodyMat, stripeMat, index) {
    this.index = index;
    this.bodyKind = 'pin';
    const H = CONFIG.pin.height;
    const cr = CONFIG.pin.capsuleRadius;
    this.capsuleRadius = cr;

    /* -------- Mesh -------- */
    this.mesh = new THREE.Mesh(geo, bodyMat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.012, 8, 24), stripeMat);
    stripe.rotation.x = Math.PI / 2;
    stripe.position.y = 0.075;
    this.mesh.add(stripe);
    scene.add(this.mesh);

    /* -------- Body -------- */
    this.body = new RigidBody({
      mass: CONFIG.pin.mass,
      cylinder: { radius: 0.05, height: H },
      linearDamping: CONFIG.pin.linearDamping,
      angularDamping: CONFIG.pin.angularDamping,
      tag: 'pin',
      canSleep: true,
    });
    this.body.pinIndex = index;

    /* -------- Collision geometry (local frame, CM at origin) -------- */
    const hh = H / 2;
    this.localA = new THREE.Vector3(0, -hh + cr, 0); // capsule bottom
    this.localB = new THREE.Vector3(0, hh - cr, 0);  // capsule top
    this.worldA = new THREE.Vector3();
    this.worldB = new THREE.Vector3();

    const br = 0.026, brR = 0.012; // base-ring radius / sphere radius
    this.localSpheres = [
      { c: new THREE.Vector3(br, -hh + brR, 0), r: brR },
      { c: new THREE.Vector3(-br, -hh + brR, 0), r: brR },
      { c: new THREE.Vector3(0, -hh + brR, br), r: brR },
      { c: new THREE.Vector3(0, -hh + brR, -br), r: brR },
      { c: new THREE.Vector3(0, -hh + cr, 0), r: cr }, // bottom cap
      { c: new THREE.Vector3(0, 0, 0), r: cr },        // middle (lying support)
      { c: new THREE.Vector3(0, hh - cr, 0), r: cr },  // top cap
    ];
    this.worldSpheres = this.localSpheres.map((s) => ({ x: 0, y: 0, z: 0, r: s.r }));

    this.home = { x: 0, z: 0 };
  }

  setHome(x, z) { this.home.x = x; this.home.z = z; return this; }

  /** Place upright at the home spot and put to sleep (standing rack). */
  rack() {
    const b = this.body;
    b.position.set(this.home.x, CONFIG.pin.height / 2, this.home.z);
    b.quaternion.set(0, 0, 0, 1);
    b.velocity.setScalar(0);
    b.angularVelocity.setScalar(0);
    b.updateInertiaWorld();
    b.wake();
    b.sleep(); // stands asleep until something hits it
    this.updateColliders();
    this.sync();
  }

  updateColliders() {
    this.body.localToWorld(this.localA, this.worldA);
    this.body.localToWorld(this.localB, this.worldB);
    for (let i = 0; i < this.localSpheres.length; i++) {
      this.body.localToWorld(this.localSpheres[i].c, _up);
      const w = this.worldSpheres[i];
      w.x = _up.x; w.y = _up.y; w.z = _up.z;
    }
  }

  sync() {
    this.mesh.position.copy(this.body.position);
    this.mesh.quaternion.copy(this.body.quaternion);
  }

  /** Down if tilted past ~45°, shoved off its spot, or knocked off the deck. */
  isDown() {
    _up.set(0, 1, 0).applyQuaternion(this.body.quaternion);
    if (_up.angleTo(_worldUp) > Math.PI / 4) return true;
    const dx = this.body.position.x - this.home.x;
    const dz = this.body.position.z - this.home.z;
    if (Math.hypot(dx, dz) > 0.18) return true;
    if (this.body.position.y < CONFIG.pin.height / 2 - 0.12) return true;
    return false;
  }
}
