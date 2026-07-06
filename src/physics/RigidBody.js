/**
 * RigidBody.js — a generic 6-DOF rigid body, integrated by hand.
 *
 * State : position, orientation (quaternion), linear velocity, angular velocity.
 * Mass  : invMass (0 ⇒ immovable/static, e.g. the lane and walls).
 * Inertia: a diagonal inertia tensor in the body frame (principal axes), kept
 *          as its inverse. The world-space inverse inertia tensor
 *               I⁻¹_world = R · I⁻¹_body · Rᵀ
 *          is rebuilt from the orientation each step so torques rotate the body
 *          correctly (this is what lets a struck pin topple realistically).
 *
 * The class exposes the two primitives the collision solver needs:
 *   • applyImpulse(J, worldPoint)  →  Δv = J·invMass,  Δω = I⁻¹·(r × J)
 *   • velocityAtPoint(worldPoint)  →  v + ω × r
 *
 * Inertia presets:
 *   • solid sphere  : I = (2/5) m R²  (isotropic ⇒ I⁻¹_world is constant)
 *   • solid cylinder: along axis ½mR²; transverse (1/12)m(3R²+H²)  (for pins)
 */

import * as THREE from 'three';
import { integrateQuaternion, integratePosition } from './Integrator.js';
import { CONFIG } from '../config.js';

let _idCounter = 0;
const _rxJ = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _rotM = new THREE.Matrix3();
const _rotMT = new THREE.Matrix3();
const _diag = new THREE.Matrix3();
const _m4 = new THREE.Matrix4();

export class RigidBody {
  constructor(opts = {}) {
    this.id = _idCounter++;
    this.tag = opts.tag || 'body';

    // Pose & motion.
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();

    // Mass.
    const mass = opts.mass ?? 0;
    this.mass = mass;
    this.invMass = mass > 0 ? 1 / mass : 0;

    // Inverse inertia in the BODY frame (diagonal), and its world version.
    this.invInertiaLocal = new THREE.Vector3(0, 0, 0);
    this.invInertiaWorld = new THREE.Matrix3();
    this.invInertiaWorld.set(0, 0, 0, 0, 0, 0, 0, 0, 0);
    this.isotropic = false; // sphere ⇒ world inverse inertia never changes

    // Damping (secondary resistances from the study).
    this.linearDamping = opts.linearDamping ?? 0;
    this.angularDamping = opts.angularDamping ?? 0;

    // Sleeping.
    this.canSleep = opts.canSleep ?? true;
    this.sleeping = false;
    this._sleepTimer = 0;

    // Set by Lane each sub-step while the body rests on a floor surface —
    // drives the pins' rolling resistance (see PhysicsEngine).
    this.groundContact = false;

    if (opts.sphere) this.setSphereInertia(mass, opts.sphere);
    else if (opts.cylinder) this.setCylinderInertia(mass, opts.cylinder.radius, opts.cylinder.height);
  }

  get isStatic() { return this.invMass === 0; }

  /* ----------------------------- Inertia ---------------------------- */
  setSphereInertia(mass, radius) {
    if (mass <= 0) return;
    const I = (2 / 5) * mass * radius * radius;
    const invI = 1 / I;
    this.invInertiaLocal.set(invI, invI, invI);
    this.isotropic = true;
    this.invInertiaWorld.set(invI, 0, 0, 0, invI, 0, 0, 0, invI);
  }

  /** Cylinder with its symmetry axis along the body-local +Y (pins stand on Y). */
  setCylinderInertia(mass, radius, height) {
    if (mass <= 0) return;
    const Iaxis = 0.5 * mass * radius * radius;                       // about Y
    const Itrans = (1 / 12) * mass * (3 * radius * radius + height * height); // about X,Z
    this.invInertiaLocal.set(1 / Itrans, 1 / Iaxis, 1 / Itrans);
    this.isotropic = false;
    this.updateInertiaWorld();
  }

  /** Rebuild I⁻¹_world = R · diag(I⁻¹_body) · Rᵀ from the current orientation. */
  updateInertiaWorld() {
    if (this.isStatic) return;
    if (this.isotropic) return; // constant for a sphere
    _rotM.setFromMatrix4(_m4.makeRotationFromQuaternion(this.quaternion));
    _rotMT.copy(_rotM).transpose();
    const d = this.invInertiaLocal;
    _diag.set(d.x, 0, 0, 0, d.y, 0, 0, 0, d.z);
    this.invInertiaWorld.copy(_rotM).multiply(_diag).multiply(_rotMT);
  }

  /* ----------------------------- Queries ---------------------------- */
  /** Velocity of the material point currently at worldPoint: v + ω × r. */
  velocityAtPoint(worldPoint, out = new THREE.Vector3()) {
    _tmp.subVectors(worldPoint, this.position); // r
    out.crossVectors(this.angularVelocity, _tmp).add(this.velocity);
    return out;
  }

  localToWorld(local, out = new THREE.Vector3()) {
    return out.copy(local).applyQuaternion(this.quaternion).add(this.position);
  }

  /* --------------------------- Dynamics ----------------------------- */
  /**
   * Apply an impulse J at a world contact point.
   *   Δv = invMass · J
   *   Δω = I⁻¹_world · (r × J),   r = worldPoint − position
   */
  applyImpulse(J, worldPoint) {
    if (this.isStatic) return;
    this.velocity.addScaledVector(J, this.invMass);
    _tmp.subVectors(worldPoint, this.position);
    _rxJ.crossVectors(_tmp, J).applyMatrix3(this.invInertiaWorld);
    this.angularVelocity.add(_rxJ);
  }

  /** Apply a central (linear-only) impulse. */
  applyCentralImpulse(J) {
    if (this.isStatic) return;
    this.velocity.addScaledVector(J, this.invMass);
  }

  /** Integrate velocity (gravity / drag) — call before the contact solver. */
  integrateForces(dt, gravity) {
    if (this.isStatic || this.sleeping) return;
    this.velocity.y += gravity * dt; // gravity acts on −Y
  }

  /** Integrate pose from the post-solve velocities (semi-implicit Euler). */
  integratePose(dt) {
    if (this.isStatic || this.sleeping) return;
    if (this.linearDamping) this.velocity.multiplyScalar(Math.max(0, 1 - this.linearDamping * dt));
    if (this.angularDamping) this.angularVelocity.multiplyScalar(Math.max(0, 1 - this.angularDamping * dt));

    // Velocity clamp — defensive guard against numerical explosions.
    const max = CONFIG.sim.maxSpeed;
    if (this.velocity.lengthSq() > max * max) this.velocity.setLength(max);

    integratePosition(this.position, this.velocity, dt);
    integrateQuaternion(this.quaternion, this.angularVelocity, dt);
    this.updateInertiaWorld();
  }

  /* ---------------------------- Sleeping ---------------------------- */
  /** Advance the sleep timer; bodies that stay slow long enough go to sleep. */
  updateSleep(dt) {
    if (!this.canSleep || this.isStatic) return;
    const { sleepLinear, sleepAngular, sleepTime } = CONFIG.sim;
    if (this.velocity.lengthSq() < sleepLinear * sleepLinear &&
        this.angularVelocity.lengthSq() < sleepAngular * sleepAngular) {
      this._sleepTimer += dt;
      if (this._sleepTimer > sleepTime) this.sleep();
    } else {
      this._sleepTimer = 0;
    }
  }

  sleep() {
    this.sleeping = true;
    this.velocity.setScalar(0);
    this.angularVelocity.setScalar(0);
  }

  wake() {
    this.sleeping = false;
    this._sleepTimer = 0;
  }
}
