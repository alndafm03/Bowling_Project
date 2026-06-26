/**
 * Integrator.js — numerical time integration for the custom physics engine.
 *
 * ===========================================================================
 * WHY SEMI-IMPLICIT (SYMPLECTIC) EULER, NOT RK4?
 * ===========================================================================
 * The simulation is dominated by *constraints and contacts* (the ball resting
 * on the lane, pins resting on the floor, impacts) which are resolved with
 * sequential impulses operating on velocities. Three properties matter:
 *
 *   1. STABILITY WITH STIFF CONTACTS.  Explicit RK4 evaluates the derivative
 *      four times per step assuming smooth forces; a hard contact impulse is
 *      effectively discontinuous, so RK4's extra stages buy no accuracy and can
 *      overshoot. Semi-implicit Euler updates velocity *first*, then position
 *      from the already-updated velocity — this is symplectic and does not
 *      pump energy into resting stacks, so pins sit still instead of buzzing.
 *
 *   2. MOMENTUM / IMPULSE COMPATIBILITY.  Our collision response is impulse
 *      based (Δv = J·m⁻¹). Semi-implicit Euler is the integrator those impulse
 *      formulas are derived for, so the two compose exactly.
 *
 *   3. FIXED Δt ⇒ FRAME-RATE INDEPENDENCE.  The engine always steps with a
 *      constant Δt = 1/120 s (accumulator in PhysicsEngine). Behaviour is
 *      identical at 30, 60 or 144 fps; only the number of sub-steps changes.
 *
 * RK4 is the right tool for a *smooth* ODE (e.g. a frictionless ballistic arc).
 * For a real-time rigid-body world with contacts, semi-implicit Euler is the
 * standard, robust choice — it is what every production game physics engine
 * uses for exactly these reasons.
 *
 * Update rule, per body, per step:
 *     v  ← v + (F/m)·Δt           (external forces: gravity, drag)
 *     [ collision/contact impulses then adjust v and ω directly ]
 *     x  ← x + v·Δt               (positions integrated from the new velocity)
 *     q  ← normalize(q + ½·ω⊗q·Δt) (orientation from angular velocity)
 * ===========================================================================
 */

import * as THREE from 'three';

const _wq = new THREE.Quaternion();
const _dq = new THREE.Quaternion();

/**
 * Integrate an orientation quaternion by an angular-velocity vector over Δt.
 *   dq/dt = ½ · (ω as pure quaternion) · q
 * Uses a first-order step followed by renormalisation, which is accurate and
 * stable for the per-substep Δt used here.
 */
export function integrateQuaternion(q, omega, dt) {
  _wq.set(omega.x, omega.y, omega.z, 0);
  _dq.copy(_wq).multiply(q); // ω ⊗ q
  q.x += 0.5 * dt * _dq.x;
  q.y += 0.5 * dt * _dq.y;
  q.z += 0.5 * dt * _dq.z;
  q.w += 0.5 * dt * _dq.w;
  q.normalize();
  return q;
}

/** Semi-implicit position update from an already-updated velocity. */
export function integratePosition(position, velocity, dt) {
  position.x += velocity.x * dt;
  position.y += velocity.y * dt;
  position.z += velocity.z * dt;
  return position;
}
