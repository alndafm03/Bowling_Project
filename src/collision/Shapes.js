/**
 * Shapes.js — narrow-phase collision primitives and the Contact constraint.
 *
 * Two things live here:
 *
 *   1. PRIMITIVE TESTS that return a contact descriptor (normal, point,
 *      penetration) or null:
 *        • sphereVsCapsule   — ball ↔ pin
 *        • capsuleVsCapsule  — pin ↔ pin (the domino scatter)
 *
 *   2. The CONTACT class — a single-point contact constraint solved with the
 *      sequential-impulse method (Catto / Box2D style):
 *        • a non-penetration normal impulse (accumulated, clamped ≥ 0),
 *          with a coefficient of restitution and Baumgarte position bias;
 *        • a two-axis Coulomb friction impulse clamped to the friction cone
 *          |J_t| ≤ μ·J_n.
 *
 *      The SAME constraint resolves the ball rolling on the lane (where it
 *      reproduces the skid → hook → roll dynamics of the study), pins standing
 *      / toppling on the floor, and every ball–pin / pin–pin impact.
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { closestPointOnSegment, closestPointsBetweenSegments } from '../utils/Geometry.js';

/* Reusable scratch vectors (avoid per-contact allocation in the hot loop). */
const _q = new THREE.Vector3();
const _dvec = new THREE.Vector3();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vrel = new THREE.Vector3();
const _rA = new THREE.Vector3();
const _rB = new THREE.Vector3();
const _imp = new THREE.Vector3();
const _cross = new THREE.Vector3();
const _cross2 = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

/* ---------------------------------------------------------------------- */
/* Narrow-phase primitives                                                 */
/* ---------------------------------------------------------------------- */

/**
 * Sphere (centre c, radius R) vs capsule (segment a→b, radius capR).
 * normal points FROM the capsule TOWARD the sphere.
 */
export function sphereVsCapsule(c, R, a, b, capR, out) {
  closestPointOnSegment(c, a, b, _q);
  _dvec.subVectors(c, _q);
  const rad = R + capR;
  const d2 = _dvec.lengthSq();
  if (d2 >= rad * rad) return null;
  const d = Math.sqrt(d2);
  if (d > 1e-9) out.normal.copy(_dvec).multiplyScalar(1 / d);
  else out.normal.set(0, 1, 0);
  out.penetration = rad - d;
  out.point.copy(c).addScaledVector(out.normal, -R); // ball-surface contact point
  return out;
}

/**
 * Capsule (a1→b1, r1) vs capsule (a2→b2, r2).
 * normal points FROM capsule 1 TOWARD capsule 2.
 */
export function capsuleVsCapsule(a1, b1, r1, a2, b2, r2, out) {
  const res = closestPointsBetweenSegments(a1, b1, a2, b2, _c1, _c2);
  const rad = r1 + r2;
  if (res.distSq >= rad * rad) return null;
  const d = Math.sqrt(res.distSq);
  if (d > 1e-9) out.normal.subVectors(_c2, _c1).multiplyScalar(1 / d);
  else out.normal.set(0, 1, 0);
  out.penetration = rad - d;
  out.point.addVectors(_c1, _c2).multiplyScalar(0.5);
  return out;
}

/* ---------------------------------------------------------------------- */
/* Contact constraint                                                      */
/* ---------------------------------------------------------------------- */

/** angular contribution of a body to the effective mass along `dir`. */
function effMassTerm(body, r, dir) {
  if (body.isStatic) return 0;
  _cross.crossVectors(r, dir).applyMatrix3(body.invInertiaWorld); // I⁻¹(r×dir)
  _cross2.crossVectors(_cross, r);                                // (…)×r
  return dir.dot(_cross2);
}

export class Contact {
  constructor() {
    this.bodyA = null;
    this.bodyB = null;
    this.normal = new THREE.Vector3(); // from A to B
    this.point = new THREE.Vector3();
    this.penetration = 0;
    this.restitution = 0;
    this.friction = 0;

    this.t1 = new THREE.Vector3();
    this.t2 = new THREE.Vector3();
    this.normalMass = 0;
    this.tMass1 = 0;
    this.tMass2 = 0;
    this.normalImpulse = 0;
    this.tImpulse1 = 0;
    this.tImpulse2 = 0;
    this.velocityBias = 0; // restitution target
    this.positionBias = 0; // Baumgarte penetration correction
  }

  set(bodyA, bodyB, normal, point, penetration, restitution, friction) {
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    this.normal.copy(normal);
    this.point.copy(point);
    this.penetration = penetration;
    this.restitution = restitution;
    this.friction = friction;
    return this;
  }

  /** Build a tangent basis {t1,t2} orthogonal to the contact normal n. */
  _computeTangentBasis() {
    const n = this.normal;
    if (Math.abs(n.x) >= 0.57735) this.t1.set(n.y, -n.x, 0);
    else this.t1.set(0, n.z, -n.y);
    this.t1.normalize();
    this.t2.crossVectors(n, this.t1);
  }

  /** Pre-compute effective masses and restitution/position bias. */
  prepare(dt) {
    const A = this.bodyA, B = this.bodyB, n = this.normal;
    _rA.subVectors(this.point, A.position);
    _rB.subVectors(this.point, B.position);

    const kn = A.invMass + B.invMass + effMassTerm(A, _rA, n) + effMassTerm(B, _rB, n);
    this.normalMass = kn > 0 ? 1 / kn : 0;

    this._computeTangentBasis();
    const kt1 = A.invMass + B.invMass + effMassTerm(A, _rA, this.t1) + effMassTerm(B, _rB, this.t1);
    const kt2 = A.invMass + B.invMass + effMassTerm(A, _rA, this.t2) + effMassTerm(B, _rB, this.t2);
    this.tMass1 = kt1 > 0 ? 1 / kt1 : 0;
    this.tMass2 = kt2 > 0 ? 1 / kt2 : 0;

    // Relative normal velocity (B point − A point) for restitution.
    const vn = this._relativeNormalVelocity();
    const { restitutionSlop, baumgarte, penetrationSlop } = CONFIG.sim;
    this.velocityBias = vn < -restitutionSlop ? -this.restitution * vn : 0;
    this.positionBias = (baumgarte / dt) * Math.max(this.penetration - penetrationSlop, 0);

    this.normalImpulse = 0;
    this.tImpulse1 = 0;
    this.tImpulse2 = 0;
  }

  _relativeVelocity() {
    this.bodyA.velocityAtPoint(this.point, _vA);
    this.bodyB.velocityAtPoint(this.point, _vB);
    return _vrel.subVectors(_vB, _vA);
  }
  _relativeNormalVelocity() {
    return this._relativeVelocity().dot(this.normal);
  }

  /** Apply impulse `j·dir` to the pair (+ to B, − to A). */
  _applyPair(j, dir) {
    _imp.copy(dir).multiplyScalar(j);
    this.bodyB.applyImpulse(_imp, this.point);
    _imp.multiplyScalar(-1);
    this.bodyA.applyImpulse(_imp, this.point);
  }

  /** One sequential-impulse iteration: normal first, then friction. */
  solve() {
    // ---- Normal constraint (non-penetration + restitution) ----
    let vn = this._relativeNormalVelocity();
    let dPn = (this.velocityBias + this.positionBias - vn) * this.normalMass;
    const newPn = Math.max(this.normalImpulse + dPn, 0);
    dPn = newPn - this.normalImpulse;
    this.normalImpulse = newPn;
    this._applyPair(dPn, this.normal);

    // ---- Friction constraint (Coulomb cone) ----
    const vrel = this._relativeVelocity();
    const vt1 = vrel.dot(this.t1);
    const vt2 = vrel.dot(this.t2);
    let dPt1 = -vt1 * this.tMass1;
    let dPt2 = -vt2 * this.tMass2;

    const oldT1 = this.tImpulse1, oldT2 = this.tImpulse2;
    let nt1 = oldT1 + dPt1;
    let nt2 = oldT2 + dPt2;

    const maxF = this.friction * this.normalImpulse;
    const mag = Math.hypot(nt1, nt2);
    if (mag > maxF && mag > 1e-12) {
      const s = maxF / mag;
      nt1 *= s;
      nt2 *= s;
    }
    this.tImpulse1 = nt1;
    this.tImpulse2 = nt2;
    dPt1 = nt1 - oldT1;
    dPt2 = nt2 - oldT2;

    if (dPt1 !== 0) this._applyPair(dPt1, this.t1);
    if (dPt2 !== 0) this._applyPair(dPt2, this.t2);
  }
}
