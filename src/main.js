/**
 * main.js — application entry point.
 *
 * Builds every system, wires them together and runs the render loop. The heavy
 * lifting (state machine, telemetry, scoring) lives in SimulationController;
 * the custom physics lives in physics/ + collision/. The ONLY third-party
 * library is Three.js (rendering + maths). There is no external physics engine.
 *
 *   Renderer ───── scene, lights, draw
 *   CameraManager ─ 6 view modes + audio listener
 *   PhysicsEngine ─ custom rigid-body world (fixed-Δt, sequential impulses)
 *   Lane / Ball / PinSet ── entities (mesh + RigidBody + colliders)
 *   AudioManager ── 3D positional, procedurally synthesised
 *   UIControls / HUD ── input + telemetry overlay
 *   DebugDraw ───── optional physics vectors
 */

import './style.css';
import * as THREE from 'three';

import { Renderer } from './rendering/Renderer.js';
import { CameraManager } from './rendering/CameraManager.js';
import { DebugDraw } from './rendering/DebugDraw.js';
import { PhysicsEngine } from './physics/PhysicsEngine.js';
import { Lane } from './entities/Lane.js';
import { Ball } from './entities/Ball.js';
import { PinSet } from './entities/PinSet.js';
import { AudioManager } from './audio/AudioManager.js';
import { UIControls } from './ui/UIControls.js';
import { HUD } from './ui/HUD.js';
import { SimulationController } from './SimulationController.js';

function boot() {
  const container = document.getElementById('app');

  // --- Rendering + camera ---
  const renderer = new Renderer(container);
  const camera = new CameraManager(renderer.domElement);
  const debug = new DebugDraw(renderer.scene);

  // --- Physics world ---
  const engine = new PhysicsEngine();

  // --- Entities ---
  const lane = new Lane(renderer.scene);
  const ball = new Ball(renderer.scene);
  const pins = new PinSet(renderer.scene);

  engine.setLane(lane);
  engine.setBall(ball);
  engine.setPins(pins.pins);

  // --- Audio (listener rides on the camera) ---
  const audio = new AudioManager(camera.listener);
  audio.attachRolling(ball.mesh);
  audio.attachImpactEmitters(ball.mesh, pins.meshes);

  // --- UI ---
  const hud = new HUD();
  const ui = new UIControls({
    onLaunch: () => controller.launch(),
    onReset: () => controller.reset(),
    onCamera: () => camera.cycle(),
    onCameraDigit: (d) => camera.setModeByDigit(d),
    onBumpers: (on) => lane.setBumpers(on),
    onSound: (on) => audio.setEnabled(on),
    onDebug: (on) => debug.setEnabled(on),
    onParamChange: (c) => controller.updatePredictions(c),
    onBallParamChange: (m, r) => controller.setBallParams(m, r),
    onGripChange: (s) => controller.setGrip(s),
  });
  ui.setCameraLabel(camera.label);

  // --- Controller (the conductor) ---
  const controller = new SimulationController({
    renderer, camera, engine, lane, ball, pins, audio, ui, hud, debug,
  });

  // --- Hide loading splash ---
  const splash = document.getElementById('loading');
  if (splash) { splash.classList.add('hide'); setTimeout(() => splash.remove(), 700); }

  // --- Render loop ---
  const clock = new THREE.Clock();
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 1 / 20); // clamp long stalls
    controller.update(dt);
  }
  loop();
}

window.addEventListener('DOMContentLoaded', boot);
