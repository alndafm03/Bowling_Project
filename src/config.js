/**
 * config.js — Single source of truth for every physical constant.
 *
 * Each value is traced to the bowling physics study. NOTHING here depends on a
 * third-party physics engine: the simulation integrates Newton–Euler equations
 * by hand (see src/physics/). Three.js is used for *rendering only*.
 *
 * ---------------------------------------------------------------------------
 * COORDINATE SYSTEM  (Three.js convention, Y up)
 * ---------------------------------------------------------------------------
 *   +Y : vertical / up                          (study axis OY)
 *   -Z : down the lane, foul line → pins         (study axis OX, longitudinal)
 *   +X : lateral; the hook curves the ball in X  (study axis OZ, transverse)
 *
 * The lane top surface is the plane  y = 0.  The foul line is at  z = 0  and
 * the lane extends toward negative Z. The ball rests with its centre at y = R.
 */

export const G = 9.81; // gravitational acceleration (m/s²)

export const CONFIG = {
  gravity: G,

  /* ================================================================== */
  /* Lane geometry — study: ≈18.28 m long, ≈1.06 m wide                  */
  /* ================================================================== */
  lane: {
    length: 18.28,        // m  (60 ft, foul line → pin deck)
    width: 1.066,         // m  (42 in)
    thickness: 0.12,      // m  visual slab thickness
    gutterWidth: 0.24,    // m  channel either side
    gutterDepth: 0.09,    // m  drop below the lane surface
    approachLength: 4.5,  // m  run-up behind the foul line
    wallHeight: 0.5,      // m  outer side walls

    /* ---- Oil pattern (the heart of the differential-friction study) ----
     * Distances measured from the foul line (positive metres down-lane).
     * The first stretch is heavily oiled (ball skids ~straight); a transition
     * band feathers the oil out; the back-end is dry, where the hook breaks.
     * μ(d) is interpolated smoothly between the zones — see laneFrictionAt(). */
    oilEnd: 8.0,          // m  end of the fully-oiled head
    dryStart: 12.0,       // m  start of the fully-dry back-end
  },

  /* ================================================================== */
  /* Differential friction coefficients (μ)                              */
  /* Oil zone μ≈0.03 → long skid; Transition μ≈0.08; Dry zone μ≈0.15.     */
  /* ================================================================== */
  friction: {
    oil: 0.03,        // μk on the oiled head           (low → skid)
    transition: 0.08, // μk mid-lane (label threshold)   (medium)
    dry: 0.15,        // μk on the dry back-end          (high → hook grips)
    gutter: 0.10,     // μ inside the gutter channel
    ballPin: 0.18,    // tangential friction, ball ↔ pin contact
    pinPin: 0.14,     // tangential friction, pin ↔ pin contact
    pinFloor: 0.22,   // tangential friction, pin base ↔ lane (slide/scatter)
  },

  /* ================================================================== */
  /* Coefficient of restitution e  (V_after = -e · V_before)             */
  /* Study: 0 ≤ e ≤ 1.  Bowling impacts are fairly inelastic.            */
  /* ================================================================== */
  restitution: {
    ballLane: 0.0,    // ball settling onto the boards — no bounce
    floor: 0.0,       // pins on the lane — no bounce
    ballPin: 0.30,    // ball → pin   (spec: 0.1 < e < 0.4)
    pinPin: 0.25,     // pin → pin    (the domino scatter)
    wall: 0.55,       // side rails / back wall elastic rebound
  },

  /* ================================================================== */
  /* Bowling ball — study/spec: mass 7 kg, radius 0.11 m                 */
  /* Solid sphere ⇒ I = (2/5) m R²  (computed in RigidBody).             */
  /* ================================================================== */
  ball: {
    radius: 0.11,         // m
    mass: 7.0,            // kg
    startZ: -0.35,        // launch just past the foul line
    dropHeight: 0.05,     // m  released slightly above the boards → "fall" phase
    linearDamping: 0.004, // 1/s  faint rolling resistance (study: secondary)
    angularDamping: 0.003,
  },

  /* ================================================================== */
  /* Pins — study: height ≈0.38 m, mass ≈1.55 kg, 0.3048 m spacing       */
  /* Modelled as a capsule (axis segment + radius) for collision and a   */
  /* short inertia cylinder for rotation.                                */
  /* ================================================================== */
  pin: {
    height: 0.38,        // m
    bellyRadius: 0.060,  // m  widest visual radius
    capsuleRadius: 0.046,// m  collision capsule radius (≈ average body radius)
    baseRadius: 0.028,   // m  contact-ring radius at the base (standing support)
    mass: 1.55,          // kg
    spacing: 0.3048,     // m  centre-to-centre (12 in)
    deckZ: -17.4,        // z of the head pin (#1); rows recede down-lane
    linearDamping: 0.02,
    angularDamping: 0.04,
  },

  /* ================================================================== */
  /* Aerodynamic drag — study: F = ½ ρ v² Cd A,  A = πR²  (small effect) */
  /* ================================================================== */
  drag: {
    enabled: true,
    Cd: 0.47,    // sphere drag coefficient
    rhoAir: 1.2, // kg/m³
  },

  /* ================================================================== */
  /* Custom solver / loop settings                                       */
  /* ================================================================== */
  sim: {
    fixedTimeStep: 1 / 120, // s  — fixed Δt ⇒ frame-rate-independent physics
    maxSubSteps: 8,         // cap on catch-up sub-steps per frame
    solverIterations: 12,   // sequential-impulse velocity iterations
    baumgarte: 0.2,         // positional error feedback factor (0..1)
    penetrationSlop: 0.0008,// m  allowed overlap before correction kicks in
    restitutionSlop: 0.25,  // m/s below which restitution is suppressed (no jitter)
    // Sleeping — stops settled pins from jittering & saves work.
    sleepLinear: 0.06,      // m/s
    sleepAngular: 0.25,     // rad/s
    sleepTime: 0.4,         // s below thresholds before a body sleeps
    wakeImpulse: 0.04,      // contact relative speed (m/s) that wakes a sleeper
    maxSpeed: 60,           // m/s clamp — guards against numerical blow-ups
  },
};

/* ====================================================================== */
/* Differential lane friction μ(z) — the study's oil pattern as a smooth  */
/* function of down-lane distance. Used identically by the physics engine */
/* (force) and the lane visuals (sheen), so the two never disagree.       */
/* ====================================================================== */
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Kinetic friction coefficient at a point on the lane (z ≤ 0). */
export function laneFrictionAt(z) {
  const d = -z; // distance from the foul line, ≥ 0
  const { oilEnd, dryStart } = CONFIG.lane;
  const { oil, dry } = CONFIG.friction;
  if (d <= oilEnd) return oil;
  if (d >= dryStart) return dry;
  return oil + (dry - oil) * smoothstep(oilEnd, dryStart, d);
}

/** Human-readable zone for the HUD: 'oil' | 'transition' | 'dry'. */
export function laneZoneAt(z) {
  const d = -z;
  if (d <= CONFIG.lane.oilEnd) return 'oil';
  if (d >= CONFIG.lane.dryStart) return 'dry';
  return 'transition';
}

/* Convenience constants. */
export const OIL_END_Z = -CONFIG.lane.oilEnd;
export const DRY_START_Z = -CONFIG.lane.dryStart;

/** z of the back wall / pit, behind the pin deck (matches Lane's backdrop). */
export const BACK_WALL_Z = -(CONFIG.lane.length + 0.15);