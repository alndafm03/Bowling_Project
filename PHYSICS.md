# 📐 The physics, equation by equation → code

Every quantity below is integrated **by hand** — there is no third-party physics
engine. This document maps each equation of the study to where it lives in the
source. Symbols follow the study.

---

## 0. Coordinate system

Three.js Y-up. The study's axes map as:

| Study axis (longitudinal/transverse/vertical) | Sim axis | Meaning |
| --- | --- | --- |
| OX → **−Z** | down-lane, foul line → pins |
| OZ → **+X** | lateral (the hook) |
| OY → **+Y** | up |

Lane surface plane is `y = 0`; ball centre rests at `y = R`. — `config.js`.

---

## 1. Forces on the ball

| Study | Equation | Code |
| --- | --- | --- |
| Weight | `W = m g` | gravity in `RigidBody.integrateForces` (`v.y += −g·Δt`) |
| Normal | `N = m g` | **emerges** as the lane contact's normal impulse `Jₙ ≈ mgΔt` |
| Kinetic friction | `F_f = μ N` | the contact's friction impulse, capped at `μ·Jₙ` |
| Drag | `F = ½ρv²C_dA` | `PhysicsEngine._applyBallDrag` |

Nothing is a scripted "push": forces become **impulses** applied to velocities,
which is what the integrator and collision solver consume.

---

## 2. The unified contact constraint (the heart of the engine)

`collision/Shapes.js → Contact` solves one point contact with the
**sequential-impulse** method. For bodies A, B at contact point with unit normal
**n** (A→B) and the relative contact velocity
`v_rel = (v_B + ω_B×r_B) − (v_A + ω_A×r_A)`:

**Normal (non-penetration + restitution):**
```
Jₙ = −(v_rel·n)(1+e) / kₙ ,   accumulated and clamped Jₙ ≥ 0
kₙ = m_A⁻¹ + m_B⁻¹ + n·[I_A⁻¹(r_A×n)]×r_A + n·[I_B⁻¹(r_B×n)]×r_B
```
A Baumgarte term `(β/Δt)·penetration` is added to push out overlap.

**Friction (Coulomb cone):** two tangents `t₁,t₂ ⟂ n`, each
`J_t = −(v_rel·t)/k_t`, with the combined tangent impulse clamped to
`|J_t| ≤ μ·Jₙ`.

### Why this reproduces skid → hook → roll

The ball's contact point is `r_c = (0,−R,0)`. For a horizontal impulse on a
sphere the effective tangential mass works out to
```
k_t = m⁻¹ + R²/I = m⁻¹ + 5/(2m) = 7/(2m)   ⇒   J_t = −(2m/7)·v_slip
```
so the impulse needed to kill the contact slip is `(2m/7)|v_slip|`. While the
slip is large this exceeds the cap `μ·Jₙ = μmgΔt`, so the solver applies exactly
`μmgΔt` opposing the slip — **kinetic friction** — which:

- decelerates the CM: `a_cm = −μg`,
- spins the ball up: `α = (5/2)μg/R` (the friction torque `τ = r_c×F_f`).

When the slip falls below `≈ (7/2)μgΔt` the needed impulse fits inside the cone,
the solver nulls the slip, and the ball is in **pure rolling** (`v = ωR`). The
**hook** is the lateral component of the very same slip: launching with side-roll
`ω_z` makes the contact slide sideways (`v_slip,x = v_x + ω_zR`), so friction
curves the path — strongly on the dry back-end, weakly on the oil.

> Verified headless: with `V₀=8, μ=0.15` the engine gives `t_roll=1.550 s`,
> `V_roll=5.719 m/s`, `D=10.623 m` vs. the closed form `1.553 / 5.714 / 10.651`.

---

## 3. Differential lane friction μ(z)

`config.js → laneFrictionAt(z)` smoothly interpolates
**oil 0.03 → transition 0.08 → dry 0.15** with a smoothstep across the
oil/dry distances. `Lane.collideBody` tags each ball-floor contact with this μ,
so the friction discontinuity is *physical*, and the same function drives the
floor sheen. Low μ on the head ⇒ long skid; high μ on the back ⇒ the hook breaks.

---

## 4. Newton's 2nd law & integration

`physics/Integrator.js` — **semi-implicit (symplectic) Euler**, fixed `Δt = 1/120`:
```
v ← v + (F/m)Δt        (forces)
[ contact impulses adjust v, ω ]
x ← x + vΔt
q ← normalize(q + ½ ω⊗q Δt)
```
Chosen over RK4 because the world is contact-dominated: symplectic Euler is
stable with stiff/discontinuous contact impulses, composes exactly with the
impulse collision response, and—at fixed Δt with an accumulator
(`PhysicsEngine.step`)—is **frame-rate independent**. The file documents this in
full.

---

## 5. Rotational motion

| Study | Equation | Code |
| --- | --- | --- |
| Torque | `τ = r × F` | implicit in `applyImpulse`'s `Δω = I⁻¹(r×J)` |
| Angular accel | `α = I⁻¹ τ` | same |
| Sphere inertia | `I = ⅖mR²` | `RigidBody.setSphereInertia` |
| Pin inertia | cylinder tensor | `RigidBody.setCylinderInertia` |
| World inertia | `I⁻¹_world = R I⁻¹_body Rᵀ` | `RigidBody.updateInertiaWorld` (rebuilt each step so pins topple correctly) |

---

## 6. The three phases & closed form

`BowlingPhysicsModel.js` implements the study's analytical solution (solid
sphere, pure skid):
```
a_cm = −μg     α = (5/2)μg/R
t_roll = (2/7)·V₀/(μg)     V_roll = (5/7)V₀     D = (12/49)·V₀²/(μg)
```
These run live in the HUD next to the simulated values. Phase detection
(`SimulationController.classifyPhase`) reads the *actual* contact slip:
big slip ⇒ **Skid**; dry-zone lateral slip + side-roll ⇒ **Hook**; slip≈0 ⇒
**Roll**; a ball→pin event ⇒ **Collision**; pins still moving ⇒ **Scatter**.

---

## 7. Collisions with pins

**Ball → pin** (`CollisionSystem._ballVsPin`, sphere vs capsule): resolved by the
generic Contact constraint with `e = 0.30` (spec range 0.1–0.4). For a central
hit the angular terms vanish and the result equals the study's 1-D solution
```
V_b' = (m_b − e m_p)/(m_b+m_p)·V_b      V_p' = m_b(1+e)/(m_b+m_p)·V_b
```
(`BowlingPhysicsModel.ballPinCollision1D` — and the engine matches it to machine
precision, conserving momentum). Off-centre hits also generate torque (`r×J`),
so pins topple and spin.

**Pin → pin / the Domino effect** (`_pinVsPin`, capsule vs capsule, `e = 0.25`):
the same constraint, plus **wake-on-contact** — a moving pin wakes the one it
strikes, propagating the scatter cascade. Multiple simultaneous contacts are
handled by iterating the solver (`sim.solverIterations`).

Broad phase (`CollisionSystem.generate`) culls pairs by AABB before the exact
sphere/capsule tests (`utils/Geometry.js`, `collision/Shapes.js`).

---

## 8. Pins: standing, toppling, scattering

`entities/Pin.js`. Inertia is a short cylinder tensor. Floor contact uses a set
of **contact spheres**: a 4-point ring at the base (a real support polygon ⇒ an
upright pin's CM projects inside it ⇒ it stands), plus axis spheres that catch
the body when it falls (so a downed pin rests on its side). When a hit tips the
pin past its base ring, the gravity torque carries it over — the topple is
emergent. Coulomb friction at the base (`friction.pinFloor`) makes struck pins
slide and spread.

---

## 9. Aerodynamic drag

`F = ½ρv²C_dA`, `A = πR²`, applied opposite to velocity each sub-step
(`PhysicsEngine._applyBallDrag`, `BowlingPhysicsModel.dragForce`). Small, but
present, as the study notes.

---

## 10. Coefficient of restitution

`V_after = −e·V_before`, `0 ≤ e ≤ 1`, applied as the normal-impulse target in
`Contact`. Values in `config.restitution`: ball↔pin 0.30, pin↔pin 0.25, walls
0.55, lane/floor 0.0.

---

## 11. Energy, momentum, torque (HUD)

`SimulationController._pushTelemetry` computes, live:
```
KE = ½mv²      RE = ½Iω²      E = KE+RE
|p| = m|v|     |τ| = μ N R  (while slipping)
|a| from Δv/Δt
```
shown beside μ(z), the phase, and the analytical predictions.

---

## 12. Robustness & performance

- **Fixed-Δt accumulator** + sub-step cap (no spiral of death).
- **Sleeping** bodies are skipped by integration and contact solving; wake on
  impact — a standing rack is nearly free.
- **Speculative contacts** (a small margin) keep resting stacks stable without
  jitter; **Baumgarte** corrects penetration.
- **No hot-loop allocation** (scratch vectors + contact pool).

---

### Summary

The friction discontinuity, the three phases and the hook are **structural and
emergent** (real two-zone contact friction, not animation); collisions are
resolved by a hand-written impulse solver with the study's restitution
coefficients; and the closed-form equations run alongside the simulation in the
HUD — now matching the from-scratch engine to a fraction of a percent.
