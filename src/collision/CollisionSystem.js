/**
 * CollisionSystem.js — the custom collision pipeline (no external library).
 *
 *   BROAD PHASE   — cheap AABB overlap tests cull the pairs that cannot touch.
 *                   (With 1 ball + 10 pins this is tiny, but it is implemented
 *                   as a real, separate stage so the architecture scales and
 *                   matches the engineering brief.)
 *
 *   NARROW PHASE  — exact tests on the surviving pairs:
 *                     ball  ↔ pin   : sphere vs capsule
 *                     pin   ↔ pin   : capsule vs capsule
 *                     body  ↔ world : delegated to Lane (floor / gutters /
 *                                      walls / back wall), one contact per
 *                                      collision sphere of the body.
 *                   Contacts touching a sleeping body wake it — this is what
 *                   propagates the pin-scatter cascade.
 *
 *   RESOLUTION    — sequential impulses: `solverIterations` passes over every
 *                   contact, each applying a normal + friction impulse
 *                   (see Contact.solve). Multiple simultaneous contacts are
 *                   handled naturally by iterating to convergence.
 */

import * as THREE from 'three';
import { AABB } from '../utils/Geometry.js';
import { Contact, sphereVsCapsule, capsuleVsCapsule } from './Shapes.js';
import { CONFIG } from '../config.js';

const IMPACT_MIN = 0.8; // m/s approach speed that counts as an audible impact
const _eA = new THREE.Vector3();
const _eB = new THREE.Vector3();
const _eRel = new THREE.Vector3();

export class CollisionSystem {
  constructor(staticBody) {
    this.staticBody = staticBody; // immovable stand-in for lane/walls (invMass 0)
    this.lane = null;
    this.ball = null;             // Ball entity
    this.pins = [];               // Pin entities

    this.contacts = [];
    this.events = []; // impact events for audio (drained by the engine/frame)
    this._pool = [];
    this._poolCount = 0;

    // Broad-phase scratch.
    this._ballAABB = new AABB();
    this._pinAABB = [];

    // Narrow-phase scratch result.
    this._hit = { normal: new THREE.Vector3(), point: new THREE.Vector3(), penetration: 0 };
    this._a1 = new THREE.Vector3();
    this._b1 = new THREE.Vector3();
    this._a2 = new THREE.Vector3();
    this._b2 = new THREE.Vector3();
  }

  setLane(lane) { this.lane = lane; }
  setBall(ball) { this.ball = ball; }
  setPins(pins) { this.pins = pins; this._pinAABB = pins.map(() => new AABB()); }

  /* ------------------------- contact pool --------------------------- */
  _acquire() {
    let c = this._pool[this._poolCount];
    if (!c) { c = new Contact(); this._pool.push(c); }
    this._poolCount++;
    this.contacts.push(c);
    return c;
  }

  /** Called by Lane to register a body↔world contact. */
  addStaticContact(body, normal, point, penetration, restitution, friction) {
    // staticBody is bodyA, dynamic body is bodyB; normal points from world → body.
    this._acquire().set(this.staticBody, body, normal, point, penetration, restitution, friction);
  }

  /* ------------------------- main entry ----------------------------- */
  generate() {
    this.contacts.length = 0;
    this._poolCount = 0;

    // Refresh every collider's world-space geometry from its current pose.
    if (this.ball) this.ball.updateColliders();
    for (const pin of this.pins) pin.updateColliders();

    // --- body ↔ world (static) contacts, for awake bodies only ---
    if (this.ball && !this.ball.body.sleeping) this.lane.collideBody(this.ball, this);
    for (const pin of this.pins) {
      if (!pin.body.sleeping) this.lane.collideBody(pin, this);
    }

    // --- broad phase: build AABBs ---
    if (this.ball) this._ballAABB.setFromCenterRadius(this.ball.body.position, this.ball.radius).expand(0.02);
    for (let i = 0; i < this.pins.length; i++) {
      const p = this.pins[i];
      this._pinAABB[i].setFromCapsule(p.worldA, p.worldB, p.capsuleRadius).expand(0.02);
    }

    // --- narrow phase: ball ↔ pins ---
    if (this.ball) {
      for (let i = 0; i < this.pins.length; i++) {
        if (!this._ballAABB.overlaps(this._pinAABB[i])) continue;
        this._ballVsPin(this.ball, this.pins[i]);
      }
    }

    // --- narrow phase: pin ↔ pin ---
    for (let i = 0; i < this.pins.length; i++) {
      for (let j = i + 1; j < this.pins.length; j++) {
        if (this.pins[i].body.sleeping && this.pins[j].body.sleeping) continue;
        if (!this._pinAABB[i].overlaps(this._pinAABB[j])) continue;
        this._pinVsPin(this.pins[i], this.pins[j]);
      }
    }
  }

  _ballVsPin(ball, pin) {
    const hit = sphereVsCapsule(
      ball.body.position, ball.radius,
      pin.worldA, pin.worldB, pin.capsuleRadius, this._hit
    );
    if (!hit) return;
    // Wake a struck pin (the ball is the energy source).
    if (pin.body.sleeping) pin.body.wake();
    this._maybeImpact('ballPin', pin.index, pin.body, ball.body, hit);
    // A = pin, B = ball ; normal points pin → ball (already so from primitive).
    this._acquire().set(
      pin.body, ball.body, hit.normal, hit.point, hit.penetration,
      CONFIG.restitution.ballPin, CONFIG.friction.ballPin
    );
  }

  _pinVsPin(p1, p2) {
    const hit = capsuleVsCapsule(
      p1.worldA, p1.worldB, p1.capsuleRadius,
      p2.worldA, p2.worldB, p2.capsuleRadius, this._hit
    );
    if (!hit) return;
    // Domino cascade: a moving pin wakes the one it strikes.
    if (p1.body.sleeping) p1.body.wake();
    if (p2.body.sleeping) p2.body.wake();
    this._maybeImpact('pinPin', p2.index, p1.body, p2.body, hit);
    this._acquire().set(
      p1.body, p2.body, hit.normal, hit.point, hit.penetration,
      CONFIG.restitution.pinPin, CONFIG.friction.pinPin
    );
  }

  /** Record an audible impact if the bodies are approaching fast enough. */
  _maybeImpact(kind, index, bodyA, bodyB, hit) {
    bodyA.velocityAtPoint(hit.point, _eA);
    bodyB.velocityAtPoint(hit.point, _eB);
    const approach = -_eRel.subVectors(_eB, _eA).dot(hit.normal); // >0 ⇒ closing
    if (approach > IMPACT_MIN) {
      this.events.push({ kind, index, speed: approach });
    }
  }

  /* ------------------------- resolution ----------------------------- */
  solve(dt) {
    for (const c of this.contacts) c.prepare(dt);
    const iters = CONFIG.sim.solverIterations;
    for (let it = 0; it < iters; it++) {
      for (const c of this.contacts) c.solve();
    }
  }
}
