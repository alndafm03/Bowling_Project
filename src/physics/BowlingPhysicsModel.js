/**
 * BowlingPhysicsModel.js
 * ---------------------------------------------------------------------------
 * Pure, side-effect-free implementation of the *analytical* equations derived
 * in the physics study. The interactive simulation integrates the motion
 * numerically with our own engine, but this module lets us:
 *
 *   1. Predict, before the throw, the skid time, breakpoint distance and the
 *      velocity at which pure rolling begins.
 *   2. Display those predictions in the HUD next to the live measured values,
 *      so the study and the running simulation can be compared directly.
 *
 * A bowling ball is modelled as a uniform solid sphere:  I = (2/5) m R².
 *
 * Phase 1 — Pure sliding (skid):
 *     a_cm = -μk·g                         (linear deceleration)
 *     α    = (5/2)·μk·g / R                (angular acceleration, spin-up)
 *     v(t) = V0 - μk·g·t
 *     ω(t) = (5/2)·(μk·g/R)·t
 *
 * Rolling without slipping begins when v = ω·R, which gives:
 *     t_roll = (2/7)·(V0 / (μk·g))
 *     V_roll = V0 - μk·g·t_roll = (5/7)·V0
 *     D_roll = (12/49)·(V0² / (μk·g))      (distance covered during the skid)
 *
 * These match the worked example in the study:
 *     V0 = 5 m/s, μk = 0.08, g = 9.8  →  t≈1.8 s, D≈7.8 m, V≈3.6 m/s
 * ---------------------------------------------------------------------------
 */

import { G } from '../config.js';

/** Weight of the ball — study: W = m·g. */
export function weight(mass, g = G) {
  return mass * g;
}

/** Kinetic (sliding) friction force magnitude — study: Fk = μk·N = μk·m·g. */
export function kineticFriction(muK, mass, g = G) {
  return muK * mass * g;
}

/** Linear deceleration of the centre of mass during the skid: a = -μk·g. */
export function linearAcceleration(muK, g = G) {
  return -muK * g;
}

/** Angular (spin-up) acceleration of a solid sphere: α = (5/2)·μk·g / R. */
export function angularAcceleration(muK, radius, g = G) {
  return (5 / 2) * (muK * g) / radius;
}

/** Time at which the skid ends and pure rolling begins: t = (2/7)·V0/(μk·g). */
export function skidTime(v0, muK, g = G) {
  return (2 / 7) * (v0 / (muK * g));
}

/** Distance travelled during the skid phase: D = (12/49)·V0²/(μk·g). */
export function breakpointDistance(v0, muK, g = G) {
  return (12 / 49) * ((v0 * v0) / (muK * g));
}

/** Centre-of-mass speed once pure rolling starts: V = (5/7)·V0. */
export function rollingVelocity(v0) {
  return (5 / 7) * v0;
}

/** Linear speed during the skid as a function of time: v(t) = V0 - μk·g·t. */
export function velocityAtTime(v0, muK, t, g = G) {
  return v0 - muK * g * t;
}

/** Angular speed during the skid: ω(t) = (5/2)·(μk·g/R)·t. */
export function angularVelocityAtTime(muK, radius, t, g = G) {
  return angularAcceleration(muK, radius, g) * t;
}

/** Aerodynamic drag force — study: F = ½·ρ·v²·Cd·A,  with A = πR². */
export function dragForce(v, { Cd, rhoAir }, radius) {
  const area = Math.PI * radius * radius;
  return 0.5 * rhoAir * v * v * Cd * area;
}

/**
 * Post-impact velocity from the coefficient of restitution — study:
 *     V_after = -e · V_before
 * Returned as a signed scalar (negative → direction reversed).
 */
export function restitutionVelocity(vBefore, e) {
  return -e * vBefore;
}

/**
 * 1-D ball→pin collision (study "Ball-to-Pin Collision").
 * Conservation of momentum + coefficient of restitution:
 *     mb·Vb1            = mb·Vb2 + mp·Vp1
 *     Vp1 - Vb2         = e·Vb1
 * Solving for the post-impact velocities of ball (Vb2) and pin (Vp1):
 */
export function ballPinCollision1D(mb, mp, vb1, e) {
  const vb2 = ((mb - e * mp) / (mb + mp)) * vb1;
  const vp1 = ((mb * (1 + e)) / (mb + mp)) * vb1;
  return { ballAfter: vb2, pinAfter: vp1 };
}

/**
 * Convenience: compute every pre-throw prediction in one call.
 * `muK` should be an *effective* coefficient for the throw (we use the dry-zone
 * value, since that is where the roll-out settles).
 */
export function predict(v0, muK, radius, g = G) {
  return {
    skidTime: skidTime(v0, muK, g),
    breakpointDistance: breakpointDistance(v0, muK, g),
    rollingVelocity: rollingVelocity(v0),
    linearAccel: linearAcceleration(muK, g),
    angularAccel: angularAcceleration(muK, radius, g),
  };
}
