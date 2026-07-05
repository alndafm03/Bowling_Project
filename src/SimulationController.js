/**
 * SimulationController.js — the conductor that turns raw physics into a game:
 * the throw state machine, automatic phase detection, live telemetry, audio
 * triggering and scoring. main.js builds the systems and hands them here.
 *
 * Phase detection (from the contact state, not scripted):
 *   FALL      — ball still dropping to the boards
 *   SKID      — large contact slip, little forward roll (oiled head)
 *   HOOK      — in the dry zone with lateral slip + side-roll (the curve)
 *   ROLL      — slip ≈ 0 (rolling without slipping)
 *   COLLISION — a ball→pin strike just happened
 *   SCATTER   — pins are still moving (the domino cascade)
 */

import * as THREE from 'three';
import { CONFIG, G, laneFrictionAt, laneZoneAt, OIL_END_Z, BACK_WALL_Z } from './config.js';
import { predict } from './physics/BowlingPhysicsModel.js';

export class SimulationController {
  constructor(sys) {
    Object.assign(this, sys); // renderer, camera, engine, lane, ball, pins, audio, ui, hud, debug

    this.state = { active: false, time: 0, settle: 0, resolved: false };
    this.collisionFlash = 0;

    this._prevVel = new THREE.Vector3();
    this._accel = 0;

    // FPS / frame timing.
    this._fps = 0; this._frameMs = 0;
    this._fpsAccum = 0; this._jsAccum = 0; this._fpsFrames = 0;

    // Baselines for the lane-grip dial.
    this._baseOil = CONFIG.friction.oil;
    this._baseDry = CONFIG.friction.dry;

    this.updatePredictions(this.ui.getControls());
    this.reset();
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */
  launch() {
    this.audio.resume(); // unlock WebAudio on the user gesture
    const c = this.ui.getControls();
    this.ball.setMassRadius(c.mass, c.radius);
    this.pins.rack();
    this.ball.launch(c);
    this.updatePredictions(c);
    this.state = { active: true, time: 0, settle: 0, resolved: false };
    this.collisionFlash = 0;
    this.debug.clearTrail();
    this.hud.setScore(0, 'Rolling…');
  }

  reset() {
    const c = this.ui.getControls();
    this.ball.setMassRadius(c.mass, c.radius);
    this.ball.reset(c.lateralX);
    this.pins.rack();
    this.state = { active: false, time: 0, settle: 0, resolved: false };
    this.collisionFlash = 0;
    this.debug.clearTrail();
    this.hud.setScore(0, 'Set up the throw, then LAUNCH');
  }

  setBallParams(mass, radius) {
    this.ball.setMassRadius(mass, radius);
    this.updatePredictions(this.ui.getControls());
  }

  setGrip(scale) {
    CONFIG.friction.oil = this._baseOil * scale;
    CONFIG.friction.dry = this._baseDry * scale;
    this.updatePredictions(this.ui.getControls());
  }

  /** Study's analytical prediction, using the (grip-scaled) dry-zone μ. */
  updatePredictions(c) {
    this.hud.setPredictions(predict(c.power, CONFIG.friction.dry, c.radius));
  }

  /* ------------------------------------------------------------------ */
  /* Phase classification                                                */
  /* ------------------------------------------------------------------ */
  classifyPhase() {
    if (!this.state.active) return { label: 'Ready', cls: '' };
    if (this.ball.airborne) return { label: 'Fall', cls: 'fall' };
    if (this.collisionFlash > 0) return { label: 'Collision', cls: 'collision' };

    const pinsMoving = this.pins.pins.some((p) => !p.body.sleeping);
    const ballSlow = this.ball.forwardSpeed < 0.3;
    if (pinsMoving && (this.ball.position.z < CONFIG.pin.deckZ + 1.6 || ballSlow)) {
      return { label: 'Scatter', cls: 'scatter' };
    }

    const slip = this.ball.slipSpeed;
    const lat = Math.abs(this.ball.lateralSlip);
    if (ballSlow) return { label: 'Roll', cls: 'roll' };
    if (slip > 0.3) {
      const inDry = this.ball.position.z < OIL_END_Z;
      if (inDry && lat > 0.12 && Math.abs(this.ball.sideSpin) > 1) return { label: 'Hook', cls: 'hook' };
      return { label: 'Skid', cls: 'skid' };
    }
    return { label: 'Roll', cls: 'roll' };
  }

  /* ------------------------------------------------------------------ */
  /* Telemetry                                                           */
  /* ------------------------------------------------------------------ */
  _pushTelemetry(dt) {
    const b = this.ball.body;
    const m = b.mass;
    const R = this.ball.radius;
    const v = this.ball.speed;
    const w = this.ball.spin;
    const I = (2 / 5) * m * R * R;

    // |acceleration| from the velocity change (frame-rate independent enough).
    this._accel = dt > 1e-5 ? b.velocity.distanceTo(this._prevVel) / dt : 0;
    this._prevVel.copy(b.velocity);

    const onBoards = !this.ball.airborne && this.ball.position.y < R * 1.5;
    const z = this.ball.position.z;
    const muNow = onBoards ? laneFrictionAt(z) : 0;
    const slipping = this.ball.slipSpeed > 0.05;
    const torque = onBoards && slipping ? muNow * m * G * R : 0; // τ = μ N R

    this.hud.setLive({
      speed: v,
      angVel: w,
      accel: this._accel,
      distance: this.ball.distanceTravelled,
      mu: muNow,
      zone: onBoards ? laneZoneAt(z) : 'air',
      phase: this.classifyPhase(),
      ke: 0.5 * m * v * v,
      re: 0.5 * I * w * w,
      etotal: 0.5 * m * v * v + 0.5 * I * w * w,
      momentum: m * v,
      torque,
    });
  }

  _updateFrameStats(wallDt, jsMs) {
    this._fpsAccum += wallDt * 1000; // wall-clock time (true FPS)
    this._jsAccum += jsMs;           // JS cost per frame
    this._fpsFrames++;
    if (this._fpsAccum >= 250) {
      this._fps = (this._fpsFrames * 1000) / this._fpsAccum;
      this._frameMs = this._jsAccum / this._fpsFrames;
      this._fpsAccum = 0; this._jsAccum = 0; this._fpsFrames = 0;
    }
    this.hud.setFrameStats({ fps: this._fps, frameMs: this._frameMs, substeps: this.engine.lastSubSteps });
  }

  /* ------------------------------------------------------------------ */
  /* Audio                                                               */
  /* ------------------------------------------------------------------ */
  _handleAudio() {
    for (const ev of this.engine.collision.events) {
      if (ev.kind === 'ballPin') { this.audio.ballImpact(ev.speed); this.collisionFlash = 0.3; this.ball.registerPinHit(); }
      else if (ev.kind === 'pinPin') { this.audio.pinClatter(ev.index, ev.speed); }
    }
    const onLane = this.state.active && !this.ball.inGutter() && !this.ball.airborne;
    this.audio.updateRolling(this.ball.forwardSpeed, onLane);
  }

  /* ------------------------------------------------------------------ */
  /* Ball vanish (breaks through the back wall after hitting a pin)      */
  /* ------------------------------------------------------------------ */
  _maybeVanishBall() {
    if (this.ball.vanished) return;
    if (this.ball.position.z < BACK_WALL_Z - this.ball.radius) {
      this.ball.vanish();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Scoring                                                             */
  /* ------------------------------------------------------------------ */
  _resolveThrow(dt) {
    if (!this.state.active) return;
    this.state.time += dt;

    const down = this.pins.countDown();
    this.hud.setScore(down);

    const pastPins = this.ball.position.z < -(CONFIG.lane.length + 0.05);
    const ballDone = this.ball.isStopped() || this.ball.inGutter() || pastPins;

    if (ballDone && this.state.time > 0.8) {
      this.state.settle += dt;
      const pinsSettled = !this.pins.pins.some((p) => !p.body.sleeping);
      if (!this.state.resolved && (this.state.settle > 4 || (this.state.settle > 1.2 && pinsSettled))) {
        this.state.resolved = true;
        this.state.active = false;
        this._finish(down);
      }
    }
  }

  _finish(down) {
    let msg;
    if (down >= 10) msg = 'STRIKE! 🎳';
    else if (down === 0) msg = this.ball.inGutter() ? 'Gutter ball 😬' : 'No pins down';
    else msg = `${down} pin${down > 1 ? 's' : ''} down`;
    this.hud.setScore(down, msg);
  }

  /* ------------------------------------------------------------------ */
  /* Main per-frame update                                               */
  /* ------------------------------------------------------------------ */
  update(dt) {
    const t0 = performance.now();

    // 1. Physics (fixed sub-steps inside).
    this.engine.step(dt);
    if (this.collisionFlash > 0) this.collisionFlash -= dt;

    // 2. Sync meshes.
    this.ball.sync();
    this.pins.sync();

    // 3. Camera.
    this.camera.update(this.ball.position, dt);

    // 4. Audio (impacts + rolling).
    this._handleAudio();

    // 4b. Hide the ball if it broke through the back wall after a pin hit.
    this._maybeVanishBall();

    // 5. Telemetry + scoring + debug.
    this._pushTelemetry(dt);
    this._resolveThrow(dt);
    this.debug.update(this.ball, this.engine.collision.contacts, this.state.active);

    // 6. Render.
    this.renderer.render(this.camera.camera);

    this._updateFrameStats(dt, performance.now() - t0);
  }
}