/**
 * scratch_physics_test.mjs — headless regression test (run: node scratch_physics_test.mjs)
 *
 * Scenario A: a pin standing near the lane edge is shoved hard toward the
 *             gutter. It must end up INSIDE the gutter (|x| > halfW, y below
 *             lane level), must NOT climb back onto the boards, and must fall
 *             asleep (stop moving) within the time budget.
 * Scenario B: a mid-lane pin is toppled with strong spin. It must stop
 *             rolling and fall asleep within the time budget.
 */
import * as THREE from 'three';
import { CONFIG } from './src/config.js';
import { PhysicsEngine } from './src/physics/PhysicsEngine.js';
import { Lane } from './src/entities/Lane.js';
import { Pin, pinProfile } from './src/entities/Pin.js';

const fakeScene = { add() {} };

// Lane logic without the DOM-dependent visuals: borrow the prototype only.
const lane = Object.create(Lane.prototype);
lane.L = CONFIG.lane.length;
lane.W = CONFIG.lane.width;
lane.bumpersOn = false;

const engine = new PhysicsEngine();
engine.setLane(lane);

const geo = new THREE.LatheGeometry(pinProfile(), 8);
const mat = new THREE.MeshStandardMaterial();
const pinA = new Pin(fakeScene, geo, mat, mat, 0);
const pinB = new Pin(fakeScene, geo, mat, mat, 1);
engine.setPins([pinA, pinB]);

// A: knocked flying over the gutter — drops 9 cm into the channel, tumbles,
// slides along it. Must settle INSIDE (below lane level) and never pop back
// up onto the boards (the old top-face-only bug catapulted it out).
pinA.setHome(0.62, -16).rack();
pinA.body.wake();
pinA.body.velocity.set(0.5, 0, -2.0);
pinA.body.angularVelocity.set(6, 0, 1);

// B: mid-lane topple with strong spin — the "rolls forever" case.
pinB.setHome(0, -12).rack();
pinB.body.wake();
pinB.body.velocity.set(0.8, 0, -1.5);
pinB.body.angularVelocity.set(6, 0, 4);

const halfW = CONFIG.lane.width / 2;
const gd = CONFIG.lane.gutterDepth;
const dt = 1 / 60;
const BUDGET = 12; // s

let enteredGutter = false;
let returnedToLane = false;
let maxYAfterGutter = -Infinity;
let settleTime = null;

for (let i = 0; i < BUDGET * 60; i++) {
  engine.step(dt);
  const p = pinA.body.position;
  if (i % 30 === 0 && i <= 240) {
    console.log(`t=${(i * dt).toFixed(2)}s  A: x=${p.x.toFixed(3)} y=${p.y.toFixed(3)} vx=${pinA.body.velocity.x.toFixed(2)}`);
  }
  if (!enteredGutter && Math.abs(p.x) > halfW + 0.02 && p.y < 0.0) enteredGutter = true;
  if (enteredGutter) {
    maxYAfterGutter = Math.max(maxYAfterGutter, p.y);
    // The old bug: the pin pops back up above lane level onto the boards.
    if (Math.abs(p.x) < halfW - 0.03 && p.y > 0.03) returnedToLane = true;
  }
  if (settleTime === null && engine.allAsleep()) { settleTime = (i + 1) * dt; break; }
}

const a = pinA.body.position, b = pinB.body.position;
console.log('--- results ---');
console.log(`pin A final: x=${a.x.toFixed(3)}  y=${a.y.toFixed(3)}  z=${a.z.toFixed(2)}  sleeping=${pinA.body.sleeping}`);
console.log(`pin B final: x=${b.x.toFixed(3)}  y=${b.y.toFixed(3)}  z=${b.z.toFixed(2)}  sleeping=${pinB.body.sleeping}`);
console.log(`entered gutter: ${enteredGutter}   max y after entering: ${maxYAfterGutter.toFixed(3)}`);
console.log(`returned onto lane (BUG): ${returnedToLane}`);
console.log(`all asleep after: ${settleTime === null ? 'NEVER (>' + BUDGET + 's)' : settleTime.toFixed(2) + ' s'}`);

let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };
check(enteredGutter, 'pin A entered the gutter');
check(!returnedToLane, 'pin A never climbed back onto the boards');
check(Math.abs(a.x) > halfW && a.y < 0.0, 'pin A rests inside the gutter channel (below lane level)');
check(a.y > -gd - 0.05, 'pin A did not tunnel through the gutter floor');
check(pinB.body.sleeping, 'pin B (rolling pin) stopped and slept');
check(settleTime !== null, `everything settled within ${BUDGET}s`);
process.exit(fail ? 1 : 0);
