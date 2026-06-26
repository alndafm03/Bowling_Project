/**
 * Geometry.js — pure computational-geometry helpers for the custom collision
 * system. No physics here, just vector maths (built on THREE.Vector3, which is
 * a maths utility — not a physics engine).
 *
 *   • closestPointOnSegment   — point ↔ capsule/segment queries
 *   • closestPointsBetweenSegments — capsule ↔ capsule queries
 *   • AABB overlap            — broad-phase culling
 */

import * as THREE from 'three';

/** Clamp helper. */
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/**
 * Closest point on segment AB to point P.
 * Returns { point, t } where point = A + t·(B-A), t ∈ [0,1].
 */
export function closestPointOnSegment(p, a, b, out = new THREE.Vector3()) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const denom = abx * abx + aby * aby + abz * abz;
  let t = denom > 1e-12 ? (apx * abx + apy * aby + apz * abz) / denom : 0;
  t = clamp(t, 0, 1);
  out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
  return { point: out, t };
}

/**
 * Closest points between two segments P1P2 and Q1Q2 (Ericson, "Real-Time
 * Collision Detection", §5.1.9). Returns the two closest points and the
 * squared distance — the core of capsule↔capsule (pin↔pin) collision.
 */
export function closestPointsBetweenSegments(p1, p2, q1, q2, c1 = new THREE.Vector3(), c2 = new THREE.Vector3()) {
  const d1 = new THREE.Vector3().subVectors(p2, p1); // direction of segment 1
  const d2 = new THREE.Vector3().subVectors(q2, q1); // direction of segment 2
  const r = new THREE.Vector3().subVectors(p1, q1);
  const a = d1.dot(d1); // squared length of segment 1
  const e = d2.dot(d2); // squared length of segment 2
  const f = d2.dot(r);

  let s, t;
  const EPS = 1e-12;

  if (a <= EPS && e <= EPS) {
    // Both segments are points.
    s = t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > EPS ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }

  c1.copy(d1).multiplyScalar(s).add(p1);
  c2.copy(d2).multiplyScalar(t).add(q1);
  return { c1, c2, distSq: c1.distanceToSquared(c2), s, t };
}

/** Axis-aligned bounding box, mutable, reusable. */
export class AABB {
  constructor() {
    this.min = new THREE.Vector3();
    this.max = new THREE.Vector3();
  }
  setFromCenterRadius(c, r) {
    this.min.set(c.x - r, c.y - r, c.z - r);
    this.max.set(c.x + r, c.y + r, c.z + r);
    return this;
  }
  /** Expand to enclose a capsule (segment a→b, radius r). */
  setFromCapsule(a, b, r) {
    this.min.set(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r);
    this.max.set(Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r);
    return this;
  }
  expand(margin) {
    this.min.subScalar(margin);
    this.max.addScalar(margin);
    return this;
  }
  overlaps(o) {
    return (
      this.min.x <= o.max.x && this.max.x >= o.min.x &&
      this.min.y <= o.max.y && this.max.y >= o.min.y &&
      this.min.z <= o.max.z && this.max.z >= o.min.z
    );
  }
}
