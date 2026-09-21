import * as THREE from 'three';
import { damp } from './combat.js';

// A weighted third-person camera: orbits a target at a fixed-ish distance,
// with procedural head-bob while running and a shake impulse on impact.
export class CombatCamera {
  constructor(camera, target) {
    this.camera = camera;
    this.target = target; // THREE.Object3D to follow (player group)

    this.yaw = 0;
    this.pitch = -0.18;
    this.distance = 4.6;
    this.minPitch = -1.1;
    this.maxPitch = 0.55;

    this.bobPhase = 0;
    this.bobAmount = 0;
    this._shakeTime = 0;
    this._shakeStrength = 0;
    this._pushDir = new THREE.Vector3();
    this._pushTime = 0;
    this._pushStrength = 0;

    // Selling speed is mostly a camera trick: widen the FOV and pull back
    // slightly while sprinting so 8 units/sec *reads* fast, and narrow it
    // a touch while blocking for a tighter, more focused feel.
    this.baseFOV = camera.fov;
    this._fov = camera.fov;

    this._smoothPos = new THREE.Vector3();
    this._initialized = false;
  }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch -= dy;
    this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch));
  }

  // dir (optional, world-space, normalized): biases the shake into a
  // directional punch instead of pure random jitter — used so a hit from
  // the left visibly knocks the camera right, etc.
  shake(strength, dir = null) {
    this._shakeStrength = Math.max(this._shakeStrength, strength);
    this._shakeTime = 0.22;
    if (dir) {
      this._pushDir.copy(dir);
      this._pushStrength = strength * 0.6;
      this._pushTime = 0.16;
    }
  }

  // Forward direction on the XZ plane, derived from camera yaw (used for movement).
  getForward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  getRight() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  update(dt, { running, blocking, sprinting }) {
    // Head bob builds up while running, eases out otherwise — sprinting
    // bobs harder and faster than a plain jog.
    const targetBob = running ? (sprinting ? 1.35 : 1) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 6);
    this.bobPhase += dt * (running ? (sprinting ? 14 : 9) : 4);

    const bobY = Math.sin(this.bobPhase) * 0.045 * this.bobAmount;
    const bobX = Math.sin(this.bobPhase * 0.5) * 0.03 * this.bobAmount;

    const dist = blocking ? this.distance * 0.85 : (sprinting ? this.distance * 1.12 : this.distance);

    const targetFOV = blocking ? this.baseFOV - 5 : sprinting ? this.baseFOV + 9 : this.baseFOV;
    this._fov = damp(this._fov, targetFOV, 7, dt);
    if (Math.abs(this.camera.fov - this._fov) > 0.02) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }

    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(-this.pitch) + 0.35,
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).multiplyScalar(-dist);

    const desired = this.target.position.clone().add(offset).add(new THREE.Vector3(0, 1.5, 0));

    if (!this._initialized) {
      this._smoothPos.copy(desired);
      this._initialized = true;
    } else {
      this._smoothPos.lerp(desired, Math.min(1, dt * 9));
    }

    let shakeOffset = new THREE.Vector3();
    if (this._shakeTime > 0) {
      this._shakeTime -= dt;
      const s = this._shakeStrength * Math.max(0, this._shakeTime / 0.22);
      shakeOffset.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      if (this._shakeTime <= 0) this._shakeStrength = 0;
    }

    if (this._pushTime > 0) {
      this._pushTime -= dt;
      const s = this._pushStrength * Math.max(0, this._pushTime / 0.16);
      shakeOffset.addScaledVector(this._pushDir, s);
      if (this._pushTime <= 0) this._pushStrength = 0;
    }

    this.camera.position.copy(this._smoothPos).add(shakeOffset);
    this.camera.position.x += bobX;
    this.camera.position.y += bobY;

    const lookTarget = this.target.position.clone().add(new THREE.Vector3(0, 1.35, 0));
    this.camera.lookAt(lookTarget);
  }
}
