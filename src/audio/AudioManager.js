/**
 * AudioManager.js
 * ---------------------------------------------------------------------------
 * 3D spatial sound using THREE.PositionalAudio. To keep the project free of
 * binary asset files, every sound is SYNTHESISED procedurally into an
 * AudioBuffer at start-up:
 *
 *   • Rolling rumble — looping filtered (brown) noise attached to the ball.
 *     Its volume and pitch are modulated by the ball's speed in real time.
 *   • Ball→pin impact — a noise burst + a low woody "thock" (decaying sine),
 *     scaled by the collision's impact velocity.
 *   • Pin→pin clatter — lighter, higher-pitched knocks, one emitter per pin so
 *     the chain-reaction ("Domino effect") produces overlapping clatter.
 *
 * All emitters are PositionalAudio, so panning/attenuation follow the camera
 * listener for a true 3D field.
 */

import * as THREE from 'three';

export class AudioManager {
  constructor(listener) {
    this.listener = listener;
    this.ctx = listener.context;
    this.enabled = true;

    // Pre-render the buffers once.
    this.rollingBuf = this._brownNoise(2.0);
    this.impactBufs = [0, 1, 2].map((i) => this._impact(0.28, 170 + i * 40));
    this.clatterBufs = [0, 1, 2, 3].map(() => this._clatter());

    this._lastImpact = 0;
    this._pinLast = new Map();
  }

  /** Resume the WebAudio context — must be called from a user gesture. */
  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /* ------------------------------------------------------------------ */
  /* Rolling sound — attached to the ball mesh.                          */
  /* ------------------------------------------------------------------ */
  attachRolling(ballMesh) {
    const s = new THREE.PositionalAudio(this.listener);
    s.setBuffer(this.rollingBuf);
    s.setLoop(true);
    s.setRefDistance(2.4);
    s.setRolloffFactor(1.2);
    s.setVolume(0);
    ballMesh.add(s);
    this.rolling = s;
  }

  /**
   * Modulate the rolling sound. `speed` m/s, `onLane` false → silence it
   * (ball in the gutter / pit / at rest).
   */
  updateRolling(speed, onLane) {
    if (!this.rolling) return;
    if (!this.enabled || !onLane || speed < 0.25) {
      if (this.rolling.isPlaying) this.rolling.setVolume(0);
      return;
    }
    if (!this.rolling.isPlaying && this.ctx.state === 'running') this.rolling.play();
    const vol = THREE.MathUtils.clamp(speed / 9, 0, 1) * 0.9;
    this.rolling.setVolume(vol);
    // Pitch rises with speed for a sense of momentum.
    this.rolling.setPlaybackRate(0.7 + THREE.MathUtils.clamp(speed / 11, 0, 1) * 0.9);
  }

  /* ------------------------------------------------------------------ */
  /* Impact emitters.                                                    */
  /* ------------------------------------------------------------------ */
  attachImpactEmitters(ballMesh, pinMeshes) {
    // One emitter on the ball for ball→pin strikes.
    this.ballImpact = new THREE.PositionalAudio(this.listener);
    this.ballImpact.setRefDistance(3);
    this.ballImpact.setRolloffFactor(1.1);
    ballMesh.add(this.ballImpact);

    // One emitter per pin for pin→pin clatter.
    this.pinEmitters = pinMeshes.map((m) => {
      const e = new THREE.PositionalAudio(this.listener);
      e.setRefDistance(2.5);
      e.setRolloffFactor(1.3);
      m.add(e);
      return e;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Public impact API — called by the simulation when the custom        */
  /* collision system reports an impact (no third-party events here).    */
  /* ------------------------------------------------------------------ */

  /** Ball → pin strike at the given impact speed (m/s). */
  ballImpact(impactSpeed) {
    if (this.enabled) this._playBallImpact(impactSpeed);
  }

  /** Pin → pin clatter for pin `index` at the given impact speed (m/s). */
  pinClatter(index, impactSpeed) {
    if (this.enabled) this._playPinClatter(index, impactSpeed);
  }

  _playBallImpact(impactVel) {
    const now = performance.now();
    if (now - this._lastImpact < 35) return;
    this._lastImpact = now;
    if (this.ctx.state !== 'running') return;

    const s = this.ballImpact;
    if (s.isPlaying) s.stop();
    s.setBuffer(this.impactBufs[(Math.random() * this.impactBufs.length) | 0]);
    s.setVolume(THREE.MathUtils.clamp(impactVel / 6, 0.15, 1));
    s.setPlaybackRate(0.9 + Math.random() * 0.25);
    s.play();
  }

  _playPinClatter(idx, impactVel) {
    if (impactVel < 0.4) return; // ignore gentle ressettling
    const now = performance.now();
    const last = this._pinLast.get(idx) || 0;
    if (now - last < 45) return;
    this._pinLast.set(idx, now);
    if (this.ctx.state !== 'running') return;

    const e = this.pinEmitters[idx];
    if (!e) return;
    if (e.isPlaying) e.stop();
    e.setBuffer(this.clatterBufs[(Math.random() * this.clatterBufs.length) | 0]);
    e.setVolume(THREE.MathUtils.clamp(impactVel / 5, 0.1, 0.8));
    e.setPlaybackRate(0.85 + Math.random() * 0.5);
    e.play();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on && this.rolling && this.rolling.isPlaying) this.rolling.setVolume(0);
  }

  /* ------------------------------------------------------------------ */
  /* Procedural buffer synthesis.                                        */
  /* ------------------------------------------------------------------ */
  _buffer(duration) {
    const len = Math.floor(this.ctx.sampleRate * duration);
    return this.ctx.createBuffer(1, len, this.ctx.sampleRate);
  }

  /** Brown(ish) noise → deep continuous rumble for the rolling ball. */
  _brownNoise(duration) {
    const buf = this._buffer(duration);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // integrate → brown noise
      d[i] = last * 3.2;
    }
    // Gentle fade at the seam so the loop is click-free.
    const f = Math.floor(buf.sampleRate * 0.02);
    for (let i = 0; i < f; i++) {
      const g = i / f;
      d[i] *= g;
      d[d.length - 1 - i] *= g;
    }
    return buf;
  }

  /** Woody ball→pin strike: noise burst + decaying low sine. */
  _impact(duration, freq) {
    const buf = this._buffer(duration);
    const d = buf.getChannelData(0);
    const sr = buf.sampleRate;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const envNoise = Math.exp(-t / 0.045);
      const envTone = Math.exp(-t / 0.08);
      const noise = (Math.random() * 2 - 1) * envNoise * 0.7;
      const tone = Math.sin(2 * Math.PI * freq * t) * envTone * 0.35;
      const click = t < 0.004 ? (Math.random() * 2 - 1) * 0.6 : 0;
      d[i] = noise + tone + click;
    }
    return buf;
  }

  /** Lighter, higher pin→pin clatter. */
  _clatter() {
    const buf = this._buffer(0.16);
    const d = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const freq = 380 + Math.random() * 380;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const env = Math.exp(-t / 0.03);
      const tone = Math.sin(2 * Math.PI * freq * t) * env * 0.4;
      const noise = (Math.random() * 2 - 1) * env * 0.5;
      d[i] = tone + noise;
    }
    return buf;
  }
}
