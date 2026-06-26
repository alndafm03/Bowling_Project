/**
 * Ball.js — the bowling ball: a Three.js mesh + a custom RigidBody (solid
 * sphere, I = 2/5 mR²).
 *
 * Launch maps the UI to the study's initial conditions:
 *   • power     → launch speed V₀ (mostly down-lane, −Z)
 *   • angleDeg  → small lateral steer of the velocity (aim)
 *   • lateralX  → starting X position across the lane
 *   • spin      → SIDE-ROLL ω about the travel axis (Z) — the rev rate
 *
 * Why spin about Z and not Y?  A pure vertical (Y) spin axis passes through the
 * contact point, so it produces ZERO slip and hence NO friction side-force — a
 * "spinner" just polishes its spot. The hook comes from the component of the
 * (near-horizontal) rev axis ALONG the direction of travel: that makes the
 * contact patch slide sideways, and the dry-zone friction turns the slide into
 * a curve. The ball is launched with NO forward roll (ωx=0), so it begins in
 * the study's pure-skid phase; lane friction then spins up the forward roll
 * AND bleeds the side-roll into the hook — all emergent, nothing scripted.
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { RigidBody } from '../physics/RigidBody.js';

const _contact = new THREE.Vector3();
const _cv = new THREE.Vector3();

function makeBallTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, '#1b2a6b');
  grad.addColorStop(0.5, '#3b1d6e');
  grad.addColorStop(1, '#0c1440');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(${120 + Math.random() * 120},${120 + Math.random() * 120},255,0.10)`;
    ctx.lineWidth = 1 + Math.random() * 6;
    ctx.beginPath();
    ctx.arc(Math.random() * 512, Math.random() * 512, 30 + Math.random() * 160, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const [hx, hy] of [[250, 120], [300, 150], [275, 185]]) {
    ctx.fillStyle = '#05060c';
    ctx.beginPath();
    ctx.arc(hx, hy, 13, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Ball {
  constructor(scene) {
    this.radius = CONFIG.ball.radius;
    this.bodyKind = 'ball';

    /* -------- Mesh -------- */
    const geo = new THREE.SphereGeometry(this.radius, 48, 48);
    const mat = new THREE.MeshPhysicalMaterial({
      map: makeBallTexture(),
      roughness: 0.12,
      metalness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.15,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this._geoRadius = this.radius; // geometry was built at this radius (for scaling)

    /* -------- Body -------- */
    this.body = new RigidBody({
      mass: CONFIG.ball.mass,
      sphere: this.radius,
      linearDamping: CONFIG.ball.linearDamping,
      angularDamping: CONFIG.ball.angularDamping,
      tag: 'ball',
      canSleep: true,
    });

    // Single world collision sphere (reused) for the Lane boundary test.
    this.worldSpheres = [{ x: 0, y: 0, z: 0, r: this.radius }];

    this.launched = false;
    this.startZ = CONFIG.ball.startZ;
    this.reset(0);
  }

  /* ------------------------------------------------------------------ */
  launch({ power, angleDeg, lateralX, spin }) {
    this.reset(lateralX, true);
    const a = THREE.MathUtils.degToRad(angleDeg);
    this.body.velocity.set(power * Math.sin(a), 0, -power * Math.cos(a));
    // Side-roll about the travel (Z) axis → hook; no forward roll → pure skid.
    this.body.angularVelocity.set(0, 0, spin);
    this.body.wake();
    this.launched = true;
    this.startZ = this.body.position.z;
  }

  reset(lateralX = 0, drop = false) {
    const b = this.body;
    b.wake();
    b.velocity.setScalar(0);
    b.angularVelocity.setScalar(0);
    b.position.set(lateralX, this.radius + (drop ? CONFIG.ball.dropHeight : 0), CONFIG.ball.startZ);
    b.quaternion.set(0, 0, 0, 1);
    this.launched = false;
    this.startZ = b.position.z;
    this.updateColliders();
    this.sync();
  }

  /** Live-edit mass & radius from the UI (rebuilds inertia, scales the mesh). */
  setMassRadius(mass, radius) {
    const b = this.body;
    b.mass = mass;
    b.invMass = mass > 0 ? 1 / mass : 0;
    this.radius = radius;
    b.setSphereInertia(mass, radius);
    this.mesh.scale.setScalar(radius / this._geoRadius);
    this.worldSpheres[0].r = radius;
    if (!this.launched) this.reset(b.position.x);
  }

  updateColliders() {
    const p = this.body.position;
    const s = this.worldSpheres[0];
    s.x = p.x; s.y = p.y; s.z = p.z;
  }

  sync() {
    this.mesh.position.copy(this.body.position);
    this.mesh.quaternion.copy(this.body.quaternion);
  }

  /* --------------------------- queries ------------------------------ */
  get position() { return this.body.position; }
  get speed() { return this.body.velocity.length(); }
  get forwardSpeed() { return Math.abs(this.body.velocity.z); }
  get lateralSpeed() { return this.body.velocity.x; }
  get spin() { return this.body.angularVelocity.length(); }
  /** Side-roll component about Z (the hook driver). */
  get sideSpin() { return this.body.angularVelocity.z; }
  /** Forward-roll component about X. */
  get rollSpin() { return this.body.angularVelocity.x; }
  get distanceTravelled() { return Math.abs(this.body.position.z - this.startZ); }
  get airborne() { return this.body.position.y > this.radius + 0.004; }

  /** Velocity of the contact point (bottom of the ball), horizontal part. */
  _contactVel() {
    _contact.copy(this.body.position);
    _contact.y -= this.radius;
    this.body.velocityAtPoint(_contact, _cv);
    _cv.y = 0;
    return _cv;
  }
  /** |slip| at the contact: 0 ⇒ pure rolling, large ⇒ skidding. */
  get slipSpeed() { return this._contactVel().length(); }
  /** Lateral (X) component of the contact slip — what the hook converts. */
  get lateralSlip() { return this._contactVel().x; }

  isStopped() { return this.launched && (this.body.sleeping || this.speed < 0.12); }
  inGutter() {
    return Math.abs(this.body.position.x) > CONFIG.lane.width / 2 + 0.01 &&
      this.body.position.y < this.radius * 0.85;
  }
}
