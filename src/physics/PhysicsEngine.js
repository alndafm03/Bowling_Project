/**
 * PhysicsEngine.js — the custom rigid-body world (replaces cannon-es entirely).
 *
 * Responsibilities:
 *   • Own the dynamic bodies (ball + pins) and a single immovable "world" body
 *     (invMass 0) that represents the lane, gutters and walls in contacts.
 *   • Advance time with a FIXED-Δt accumulator so the physics is identical at
 *     any frame rate (frame-rate independence — a brief from the study/spec).
 *   • Per sub-step: integrate external forces (gravity, aerodynamic drag) into
 *     velocities → generate contacts → solve them with sequential impulses →
 *     integrate the resulting velocities into poses → update sleeping.
 *
 * The actual contact maths lives in collision/ ; this file is the conductor.
 */

import * as THREE from 'three';
import { CONFIG, G } from '../config.js';
import { RigidBody } from './RigidBody.js';
import { CollisionSystem } from '../collision/CollisionSystem.js';

const _drag = new THREE.Vector3();

export class PhysicsEngine {
  constructor() {
    this.gravity = -G; // m/s² along −Y

    // Immovable body used as bodyA for every body↔world contact.
    this.staticBody = new RigidBody({ mass: 0, tag: 'world', canSleep: false });

    this.collision = new CollisionSystem(this.staticBody);

    this.ball = null;     // Ball entity
    this.pins = [];       // Pin entities
    this.bodies = [];     // all dynamic RigidBodies (for integration loops)

    this.accumulator = 0;
    this.lastSubSteps = 0;
    this.simTime = 0;     // total simulated seconds
    this._ballDragArea = 0;
  }

  /* ----------------------------- wiring ----------------------------- */
  setLane(lane) { this.collision.setLane(lane); }

  setBall(ball) {
    this.ball = ball;
    this.bodies.push(ball.body);
    this._ballDragArea = Math.PI * ball.radius * ball.radius;
    this.collision.setBall(ball);
  }

  setPins(pins) {
    this.pins = pins;
    for (const p of pins) this.bodies.push(p.body);
    this.collision.setPins(pins);
  }

  /* ------------------------- time stepping -------------------------- */
  /**
   * Advance the world by a wall-clock frame time using fixed sub-steps.
   * Returns the number of sub-steps run (for the HUD).
   */
  step(frameDt) {
    const dt = CONFIG.sim.fixedTimeStep;
    this.collision.events.length = 0; // fresh impact events for this frame
    this.accumulator += Math.min(frameDt, 0.1); // clamp huge stalls (tab switch)

    let n = 0;
    while (this.accumulator >= dt && n < CONFIG.sim.maxSubSteps) {
      this._subStep(dt);
      this.accumulator -= dt;
      n++;
    }
    // If we hit the sub-step cap, drop the backlog to avoid a spiral of death.
    if (n >= CONFIG.sim.maxSubSteps) this.accumulator = 0;

    this.lastSubSteps = n;
    return n;
  }

  _subStep(dt) {
    // 1. External forces → velocity (gravity always; drag on the ball).
    for (const b of this.bodies) b.integrateForces(dt, this.gravity);
    this._applyBallDrag(dt);

    // 2. Build the contact set (floor / walls / ball-pin / pin-pin).
    this.collision.generate();

    // 3. Resolve velocities with sequential impulses.
    this.collision.solve(dt);

    // 4. Velocity → pose (semi-implicit Euler).
    for (const b of this.bodies) b.integratePose(dt);

    // 5. Sleeping bookkeeping.
    for (const b of this.bodies) b.updateSleep(dt);

    this.simTime += dt;
  }

  /** Aerodynamic drag on the ball:  F = ½ ρ v² Cd A,  opposite to velocity. */
  _applyBallDrag(dt) {
    if (!CONFIG.drag.enabled || !this.ball) return;
    const b = this.ball.body;
    if (b.sleeping) return;
    const speed = b.velocity.length();
    if (speed < 1e-4) return;
    const { Cd, rhoAir } = CONFIG.drag;
    const area = Math.PI * this.ball.radius * this.ball.radius; // honour live radius edits
    const forceMag = 0.5 * rhoAir * speed * speed * Cd * area;
    const accel = forceMag * b.invMass; // a = F/m
    _drag.copy(b.velocity).multiplyScalar(-accel * dt / speed); // Δv opposite v
    b.velocity.add(_drag);
  }

  /** True if every dynamic body has gone to sleep (the scene is at rest). */
  allAsleep() {
    for (const b of this.bodies) if (!b.sleeping) return false;
    return true;
  }
}
