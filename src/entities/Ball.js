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

/** Diagonal stripe colours, outer→inner (classic bowling-ball look). */
const STRIPE_COLORS = ['#0c0c0f', '#c81e2c', '#f2b90c', '#c81e2c', '#0c0c0f'];

function makeBallTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');

  // Base colour behind the stripes.
  ctx.fillStyle = '#0c0c0f';
  ctx.fillRect(0, 0, 512, 512);

  // Diagonal stripes: rotate the canvas, paint wide vertical bars, restore.
  ctx.save();
  ctx.translate(256, 256);
  ctx.rotate(THREE.MathUtils.degToRad(28));
  ctx.translate(-256, -256);
  const n = STRIPE_COLORS.length;
  const stripeW = (512 * 2.2) / n; // overshoot so rotation still covers corners
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = STRIPE_COLORS[i];
    ctx.fillRect(-512 * 0.6 + i * stripeW, -512 * 0.6, stripeW, 512 * 2.2);
  }
  ctx.restore();

  // Subtle marbled sheen so the stripes don't look flat/decal-like.
  for (let i = 0; i < 25; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.05})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.arc(Math.random() * 512, Math.random() * 512, 20 + Math.random() * 120, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Finger holes.
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
    this.hitPin = false;   // set once this throw has struck a pin
    this.vanished = false; // true once the ball has been hidden past the pit
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
    this.hitPin = false;
    this.vanished = false;
    this.mesh.visible = true;
    this.updateColliders();
    this.sync();
  }

  /** Called once this throw's ball has struck a pin (see CollisionSystem events). */
  registerPinHit() {
    this.hitPin = true;
  }

  /**
   * Hide the ball and freeze it in place. Used once the ball has both struck a
   * pin AND broken through the back wall — instead of bouncing back into the
   * pit, it simply disappears from the scene.
   */
  vanish() {
    if (this.vanished) return;
    this.vanished = true;
    this.mesh.visible = false;
    this.body.velocity.setScalar(0);
    this.body.angularVelocity.setScalar(0);
    this.body.sleeping = true; // stop integration/contacts entirely
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