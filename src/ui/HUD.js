/**
 * HUD.js — the live telemetry overlay. Builds its own DOM so index.html stays
 * minimal. Shows everything the brief asks for:
 *
 *   Kinematics : speed |v|, angular velocity |ω|, |acceleration|, distance
 *   Lane       : current friction coefficient μ(z) + zone
 *   Phase      : SKID / HOOK / ROLL / COLLISION / SCATTER badge
 *   Energy     : translational KE, rotational RE, total E
 *   Dynamics   : |momentum| = m|v|, |torque| at the contact
 *   Study      : analytical predictions (skid t, breakpoint D, roll V)
 *   Performance: FPS, frame time, physics sub-steps
 *
 * Plus the score panel (pins down + status message).
 */

export class HUD {
  constructor() {
    this.hud = document.getElementById('hud');
    this.scoreEl = document.getElementById('score');
    this.el = {};
    this._build();
    this._buildScore();
  }

  _section(title) {
    const h = document.createElement('div');
    h.className = 'hud-title';
    h.textContent = title;
    this.hud.appendChild(h);
  }

  _row(key, label, unit, cls = '') {
    const row = document.createElement('div');
    row.className = 'hud-row' + (cls ? ' ' + cls : '');
    const s = document.createElement('span'); s.textContent = label;
    const b = document.createElement('b'); b.textContent = '0';
    const i = document.createElement('i'); i.textContent = unit || '';
    row.append(s, b, i);
    this.hud.appendChild(row);
    this.el[key] = b;
    return b;
  }

  _build() {
    this._section('Kinematics');
    this._row('speed', 'Speed |v|', 'm/s');
    this._row('angvel', 'Angular |ω|', 'rad/s');
    this._row('accel', 'Accel |a|', 'm/s²');
    this._row('dist', 'Distance', 'm');

    this._section('Lane / Phase');
    this._row('mu', 'Friction μ', '');
    const phaseRow = document.createElement('div');
    phaseRow.className = 'hud-row';
    const ps = document.createElement('span'); ps.textContent = 'Phase';
    const pb = document.createElement('b'); pb.className = 'phase'; pb.textContent = 'Ready';
    phaseRow.append(ps, pb);
    this.hud.appendChild(phaseRow);
    this.el.phase = pb;

    this._section('Energy & momentum');
    this._row('ke', 'Translational KE', 'J');
    this._row('re', 'Rotational RE', 'J');
    this._row('etot', 'Total energy', 'J');
    this._row('mom', 'Momentum |p|', 'kg·m/s');
    this._row('torque', 'Torque |τ|', 'N·m');

    this._section('Study prediction');
    this._row('pt', 'Skid time t', 's', 'dim');
    this._row('pd', 'Breakpoint D', 'm', 'dim');
    this._row('pv', 'Roll V', 'm/s', 'dim');

    this._section('Performance');
    this._row('fps', 'FPS', '');
    this._row('frame', 'Frame', 'ms');
    this._row('substeps', 'Sub-steps', '');
  }

  _buildScore() {
    const big = document.createElement('div');
    big.className = 'score-big';
    const pins = document.createElement('span'); pins.id = 'score-pins'; pins.textContent = '0';
    const small = document.createElement('small'); small.textContent = '/10 pins';
    big.append(pins, small);
    const msg = document.createElement('div');
    msg.className = 'score-msg';
    msg.textContent = 'Set up the throw, then LAUNCH';
    this.scoreEl.append(big, msg);
    this.el.scorePins = pins;
    this.el.scoreMsg = msg;
  }

  /* ----------------------------- updates ---------------------------- */
  setLive(v) {
    this.el.speed.textContent = v.speed.toFixed(2);
    this.el.angvel.textContent = v.angVel.toFixed(2);
    this.el.accel.textContent = v.accel.toFixed(2);
    this.el.dist.textContent = v.distance.toFixed(2);
    this.el.mu.textContent = `${v.mu.toFixed(3)}  (${v.zone})`;
    this.el.ke.textContent = v.ke.toFixed(1);
    this.el.re.textContent = v.re.toFixed(1);
    this.el.etot.textContent = v.etotal.toFixed(1);
    this.el.mom.textContent = v.momentum.toFixed(1);
    this.el.torque.textContent = v.torque.toFixed(2);
    this.el.phase.textContent = v.phase.label;
    this.el.phase.className = `phase ${v.phase.cls}`;
  }

  setPredictions(p) {
    this.el.pt.textContent = p.skidTime.toFixed(2);
    this.el.pd.textContent = p.breakpointDistance.toFixed(2);
    this.el.pv.textContent = p.rollingVelocity.toFixed(2);
  }

  setFrameStats(s) {
    this.el.fps.textContent = s.fps.toFixed(0);
    this.el.frame.textContent = s.frameMs.toFixed(1);
    this.el.substeps.textContent = s.substeps;
  }

  setScore(pins, msg) {
    this.el.scorePins.textContent = pins;
    if (msg !== undefined) this.el.scoreMsg.textContent = msg;
  }
}
