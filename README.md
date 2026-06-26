# 🎳 Bowling Physics Simulator — custom engine (Three.js only)

An educational, engineering-grade 3D ten-pin bowling simulator. The ball goes
from **rest → launch → fall → skid → hook → pure roll → pin collision →
scatter**, all driven by a **rigid-body physics engine written from scratch**.

> **No external physics library.** Cannon.js / Ammo.js / Rapier / PhysX / Oimo
> are *not* used. Every force, impulse, contact and integration step is
> implemented by hand from the equations. **Three.js is used for rendering and
> vector maths only.**

![graphics](https://img.shields.io/badge/Three.js-WebGL-blue) ![physics](https://img.shields.io/badge/physics-hand--written-success) ![build](https://img.shields.io/badge/Vite-bundler-purple)

---

## 🚀 Quick start

```bash
npm install        # installs three + vite ONLY (no physics engine)
npm run dev        # http://localhost:5173
npm run build      # production bundle → dist/
npm run preview    # serve the build
```

Requires **Node 18+**.

---

## 🎮 Controls

| Slider            | Meaning (study symbol)                                |
| ----------------- | ----------------------------------------------------- |
| **Power**         | launch speed `V₀` (mostly down-lane, −Z)              |
| **Spin / Rev**    | side-roll `ω` about the travel axis → **the hook**    |
| **Lateral start** | starting X position across the lane                   |
| **Aim angle**     | small lateral steer of the launch velocity            |
| **Ball mass**     | `m` — rebuilds inertia `I = ⅖mR²` live                |
| **Ball radius**   | `R` — rescales the ball + inertia live                |
| **Lane grip**     | scales the oil-pattern friction (oily ↔ dry)          |

| Key        | Action                                             |
| ---------- | -------------------------------------------------- |
| **Space**  | Launch     | **R** | Reset rack                        |
| **C**      | Cycle camera | **1–6** | Orbit / Follow / Top / Side / Impact / Free |
| **B**      | Bumpers    | **G** | Debug vectors | **M** | Mute             |

The **HUD** shows live speed, |ω|, |a|, friction μ(z), the **phase**
(Skid / Hook / Roll / Collision / Scatter), translational & rotational energy,
momentum, torque, the study's analytical **predictions** (skid `t`, breakpoint
`D`, roll `V`), and FPS / frame-time / physics sub-steps.

---

## 🗂️ Architecture

```
src/
├── main.js                     # builds & wires every system, runs the loop
├── SimulationController.js      # throw state machine, phases, telemetry, score
├── config.js                    # ⭐ every constant + μ(z) oil pattern
│
├── physics/
│   ├── PhysicsEngine.js         # fixed-Δt world: forces → contacts → integrate
│   ├── RigidBody.js             # 6-DOF body, world I⁻¹, applyImpulse, sleeping
│   ├── Integrator.js            # semi-implicit Euler (+ why, not RK4)
│   └── BowlingPhysicsModel.js   # the study's closed-form equations (for the HUD)
│
├── collision/
│   ├── CollisionSystem.js       # broad phase (AABB) + narrow phase + solver
│   └── Shapes.js                # sphere/capsule tests + the Contact constraint
│
├── entities/
│   ├── Ball.js   Pin.js   PinSet.js   Lane.js
│
├── rendering/
│   ├── Renderer.js              # WebGLRenderer, scene, lights, ACES tone-map
│   ├── CameraManager.js         # 6 camera modes + audio listener
│   └── DebugDraw.js             # velocity / ω / friction / normal / trail
│
├── audio/AudioManager.js        # 3D PositionalAudio, procedurally synthesised
├── ui/HUD.js   ui/UIControls.js
└── utils/Geometry.js            # closest-point / segment / AABB maths
```

Required classes from the brief — `Ball`, `Pin`, `Lane`, `PhysicsEngine`,
`CollisionSystem`, `Renderer`, `CameraManager`, `HUD`, `SimulationController` —
are all present.

---

## 🧠 How the physics works (no library!)

The full equation-by-equation mapping is in **[PHYSICS.md](./PHYSICS.md)**.
The essentials:

- **One unified contact model.** A single sequential-impulse contact constraint
  (normal + Coulomb friction with restitution) resolves *everything*: the ball
  on the lane, pins standing/toppling, ball→pin and pin→pin impacts.

- **The hook is emergent, not scripted.** The ball is launched with side-roll
  (ω about the travel axis) and **no** forward roll, so it starts in pure skid.
  Friction at the contact point spins up the forward roll *and* bleeds the
  side-roll into a lateral curve. Because μ is low on the oiled head and high on
  the dry back-end, the curve "breaks" late — exactly like a real lane.

- **Differential friction is structural.** `laneFrictionAt(z)` smoothly
  interpolates μ from **0.03 (oil) → 0.08 (transition) → 0.15 (dry)**, and the
  same function feeds both the physics and the floor sheen.

- **Semi-implicit Euler + fixed Δt = 1/120 s.** Symplectic, stable with stiff
  contacts, and frame-rate independent (an accumulator runs sub-steps).

### Verified against the study

Running the engine core headless (constant μ) reproduces the study's closed form
to **< 0.3 %**:

| Quantity | Closed form `V₀=8, μ=0.15` | Custom engine |
| -------- | -------------------------- | ------------- |
| `t_roll = (2/7)V₀/μg` | 1.553 s | **1.550 s** |
| `V_roll = (5/7)V₀`    | 5.714 m/s | **5.719 m/s** |
| `D = (12/49)V₀²/μg`   | 10.651 m | **10.623 m** |

and the rolling condition `v = ωR` holds exactly. A head-on ball→pin test
matches the 1-D momentum + restitution solution and conserves momentum to
machine precision.

---

## 🔧 Tuning

Everything lives in [`src/config.js`](./src/config.js):

| Constant | Effect |
| -------- | ------ |
| `friction.oil / dry`         | skid length & where the hook breaks |
| `restitution.ballPin/pinPin` | how lively the pins fly / scatter   |
| `sim.solverIterations`       | contact accuracy vs. cost           |
| `sim.fixedTimeStep`          | physics resolution                  |
| `pin.mass`, `ball.mass`      | the momentum-transfer ratio         |

---

## ⚡ Performance notes

- **Fixed-Δt accumulator** with a sub-step cap (`maxSubSteps`) and backlog drain
  prevents the "spiral of death" on slow frames.
- **Sleeping** — settled pins are removed from integration and contact solving;
  a standing rack costs almost nothing until the ball arrives.
- **Hot-loop allocation avoided** — module-scoped scratch vectors and a contact
  pool keep per-frame GC near zero.
- **Broad phase** culls pairs by AABB before the exact tests (trivial here, but
  the stage is real and keeps the design O(n) friendly).
- Procedural textures & audio ⇒ **zero binary assets**, instant load.

## 🔭 Future improvements

- Warm-started accumulated impulses across frames for stiffer stacks.
- Convex-hull pin colliders (vs. the current capsule) for finer deflections.
- Continuous collision (swept sphere) for very high `V₀` to remove tunnelling.
- Oil-pattern presets (house / sport) and a ball-motion trace overlay.
- GLTF ball/pin art swapped in over the procedural meshes (renderer already
  imports `GLTFLoader`-ready paths; physics is decoupled from visuals).

---

## 📚 Credits

Physics derived from the project study (`physical study_G19.md`) and standard
references (Halliday & Resnick; Baraff & Witkin, *Physically Based Modeling*;
Catto, *Sequential Impulses*; Ericson, *Real-Time Collision Detection*).
