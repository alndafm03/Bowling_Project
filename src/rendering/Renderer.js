/**
 * Renderer.js — owns the Three.js WebGLRenderer, the scene and the lighting
 * rig. Camera handling lives in CameraManager; this class just draws.
 *
 * Lighting aims at a believable bowling-alley look:
 *   ambient + hemisphere fill, a shadow-casting key light, a cool down-lane
 *   rim, warm spotlights over the pin deck, and a few ceiling fixtures.
 * Tone mapping is ACES Filmic with sRGB output for an HDR-ish image.
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class Renderer {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070d);
    this.scene.fog = new THREE.Fog(0x05070d, 16, 36);

    this._buildLights();

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  get domElement() { return this.renderer.domElement; }

  _buildLights() {
    const laneLen = CONFIG.lane.length;

    this.scene.add(new THREE.AmbientLight(0x6f7fb0, 0.45));

    const hemi = new THREE.HemisphereLight(0xaecbff, 0x14100c, 0.55);
    hemi.position.set(0, 8, -8);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(4, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 44;
    const s = 13;
    key.shadow.camera.left = -s; key.shadow.camera.right = s;
    key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0004;
    key.target.position.set(0, 0, -laneLen * 0.5);
    this.scene.add(key); this.scene.add(key.target);

    const rim = new THREE.DirectionalLight(0x4d7bff, 0.5);
    rim.position.set(-3, 4, -laneLen);
    this.scene.add(rim);

    const pinSpot = new THREE.SpotLight(0xffe6c0, 60, 14, Math.PI / 6, 0.4, 1.4);
    pinSpot.position.set(0, 6, CONFIG.pin.deckZ + 1.4);
    pinSpot.target.position.set(0, 0, CONFIG.pin.deckZ - 0.6);
    pinSpot.castShadow = true;
    pinSpot.shadow.mapSize.set(1024, 1024);
    this.scene.add(pinSpot); this.scene.add(pinSpot.target);

    for (let i = 1; i <= 3; i++) {
      const p = new THREE.PointLight(0xbfd2ff, 8, 10, 2);
      p.position.set(0, 4.2, -(laneLen / 4) * i);
      this.scene.add(p);
    }
  }

  add(obj) { this.scene.add(obj); }

  render(camera) {
    this.renderer.render(this.scene, camera);
  }
}
