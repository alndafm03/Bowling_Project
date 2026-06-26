/**
 * UIControls.js — builds the control panel (sliders + buttons) and wires the
 * keyboard. All inputs from the brief are exposed: launch speed, spin, lateral
 * start, aim angle, ball mass, ball radius, and a lane-grip (oil pattern) dial.
 *
 * Callbacks (all optional):
 *   onLaunch() onReset() onCamera()→label onCameraDigit(d)→label
 *   onBumpers(on) onSound(on) onDebug(on)
 *   onParamChange(controls)        — throw params changed (refresh predictions)
 *   onBallParamChange(mass,radius) — rebuild ball mass/inertia/size
 *   onGripChange(scale)            — scale the lane friction (oil ↔ dry)
 */

const SLIDERS = [
  { key: 'power', label: 'Power (V₀)', sub: 'launch speed', min: 4, max: 12, step: 0.1, val: 8, fmt: (v) => `${v.toFixed(1)} m/s` },
  { key: 'spin', label: 'Spin / Rev (ω)', sub: 'side-roll → hook', min: -25, max: 25, step: 1, val: 10, fmt: (v) => `${v.toFixed(0)} rad/s` },
  { key: 'lateral', label: 'Lateral start', sub: 'X across lane', min: -0.45, max: 0.45, step: 0.01, val: 0, fmt: (v) => `${v.toFixed(2)} m` },
  { key: 'angle', label: 'Aim angle', sub: 'launch direction', min: -6, max: 6, step: 0.1, val: 0, fmt: (v) => `${v.toFixed(1)}°` },
  { key: 'mass', label: 'Ball mass', sub: 'weight', min: 4, max: 10, step: 0.1, val: 7, fmt: (v) => `${v.toFixed(1)} kg` },
  { key: 'radius', label: 'Ball radius', sub: 'size', min: 0.09, max: 0.13, step: 0.005, val: 0.11, fmt: (v) => `${(v * 100).toFixed(1)} cm` },
  { key: 'grip', label: 'Lane grip', sub: 'oil ↔ dry friction', min: 0.5, max: 1.8, step: 0.05, val: 1.0, fmt: (v) => `${v.toFixed(2)}×` },
];

export class UIControls {
  constructor(cb) {
    this.cb = cb || {};
    this.root = document.getElementById('controls');
    this.inputs = {};
    this.outputs = {};
    this.bumpersOn = false;
    this.soundOn = true;
    this.debugOn = false;

    this._build();
    this._wireKeys();
  }

  _build() {
    const h = document.createElement('h2');
    h.textContent = 'Bowling Controls';
    this.root.appendChild(h);

    for (const s of SLIDERS) {
      const wrap = document.createElement('label');
      wrap.className = 'ctl';

      const span = document.createElement('span');
      span.innerHTML = `${s.label} <small>${s.sub}</small>`;

      const input = document.createElement('input');
      input.type = 'range';
      input.min = s.min; input.max = s.max; input.step = s.step; input.value = s.val;

      const out = document.createElement('output');
      out.textContent = s.fmt(s.val);

      wrap.append(span, input, out);
      this.root.appendChild(wrap);
      this.inputs[s.key] = input;
      this.outputs[s.key] = out;

      input.addEventListener('input', () => {
        out.textContent = s.fmt(+input.value);
        this._onInput(s.key);
      });
    }

    // Primary buttons.
    const row1 = document.createElement('div'); row1.className = 'btn-row';
    this.btnLaunch = this._button('LAUNCH ⏎', 'primary', () => this.cb.onLaunch?.());
    this.btnReset = this._button('Reset 🔄', '', () => this.cb.onReset?.());
    row1.append(this.btnLaunch, this.btnReset);
    this.root.appendChild(row1);

    // Toggle buttons.
    const row2 = document.createElement('div'); row2.className = 'btn-row';
    this.btnCam = this._button('Camera: Orbit', 'ghost', () => {
      const label = this.cb.onCamera?.();
      if (label) this.btnCam.textContent = `Camera: ${label}`;
    });
    this.btnBump = this._button('Bumpers: Off', 'ghost', () => {
      this.bumpersOn = !this.bumpersOn;
      this.btnBump.textContent = `Bumpers: ${this.bumpersOn ? 'On' : 'Off'}`;
      this.cb.onBumpers?.(this.bumpersOn);
    });
    row2.append(this.btnCam, this.btnBump);
    this.root.appendChild(row2);

    const row3 = document.createElement('div'); row3.className = 'btn-row';
    this.btnSound = this._button('Sound: On', 'ghost', () => {
      this.soundOn = !this.soundOn;
      this.btnSound.textContent = `Sound: ${this.soundOn ? 'On' : 'Off'}`;
      this.cb.onSound?.(this.soundOn);
    });
    this.btnDebug = this._button('Debug: Off', 'ghost', () => {
      this.debugOn = !this.debugOn;
      this.btnDebug.textContent = `Debug: ${this.debugOn ? 'On' : 'Off'}`;
      this.cb.onDebug?.(this.debugOn);
    });
    row3.append(this.btnSound, this.btnDebug);
    this.root.appendChild(row3);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.innerHTML = 'Keys: <b>Space</b> launch · <b>R</b> reset · <b>C</b> camera · <b>1–6</b> views · <b>B</b> bumpers · <b>G</b> debug · <b>M</b> mute';
    this.root.appendChild(hint);
  }

  _button(text, cls, onClick) {
    const b = document.createElement('button');
    b.textContent = text;
    if (cls) b.className = cls;
    b.addEventListener('click', onClick);
    return b;
  }

  _onInput(key) {
    if (key === 'mass' || key === 'radius') {
      this.cb.onBallParamChange?.(+this.inputs.mass.value, +this.inputs.radius.value);
    } else if (key === 'grip') {
      this.cb.onGripChange?.(+this.inputs.grip.value);
    }
    this.cb.onParamChange?.(this.getControls());
  }

  _wireKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Space') { e.preventDefault(); this.cb.onLaunch?.(); return; }
      switch (e.key.toLowerCase()) {
        case 'r': this.cb.onReset?.(); break;
        case 'c': this.btnCam.click(); break;
        case 'b': this.btnBump.click(); break;
        case 'm': this.btnSound.click(); break;
        case 'g': this.btnDebug.click(); break;
        default:
          if (e.key >= '1' && e.key <= '6') {
            const label = this.cb.onCameraDigit?.(+e.key);
            if (label) this.btnCam.textContent = `Camera: ${label}`;
          }
      }
    });
  }

  getControls() {
    return {
      power: +this.inputs.power.value,
      spin: +this.inputs.spin.value,
      lateralX: +this.inputs.lateral.value,
      angleDeg: +this.inputs.angle.value,
      mass: +this.inputs.mass.value,
      radius: +this.inputs.radius.value,
      grip: +this.inputs.grip.value,
    };
  }

  setCameraLabel(label) { this.btnCam.textContent = `Camera: ${label}`; }
}
