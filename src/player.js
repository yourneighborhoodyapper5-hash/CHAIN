import * as THREE from 'three';
import { COMBAT, clamp, damp } from './combat.js';

const RUN_SPEED = 5.6;
const SPRINT_SPEED = 8.4;
const ACCEL = 26;
const DODGE_SPEED = 13;
const DODGE_TIME = 0.22;

export class Player {
  constructor(scene, audio) {
    this.audio = audio;
    this.hp = COMBAT.PLAYER_MAX_HP;
    // Movement stamina and combat stamina are tracked separately, so
    // sprinting never leaves you unable to fight and fighting never
    // leaves you unable to run.
    this.sprintStamina = COMBAT.MAX_SPRINT_STAMINA;
    this.combatStamina = COMBAT.MAX_COMBAT_STAMINA;
    this.alive = true;

    this.position = new THREE.Vector3(0, 0, 6);
    this.velocity = new THREE.Vector3();
    this.facingYaw = Math.PI;

    this.state = 'idle'; // idle, run, attack, block, dodge, hitstun, dead
    this.stateTimer = 0;
    this.attackPhase = null; // 'windup' | 'active' | 'recover'
    this.blocking = false;
    this.sprinting = false;
    this.invulnerable = false;
    this._footstepTimer = 0;

    // How long ago the player last threw a swing — used for the
    // timing-based parry: swing right as a hit lands and it counts as a
    // parry even if you weren't holding block.
    this._timeSinceAttackPress = 999;
    // Consecutive hits absorbed by held block (not parried). Too many in a
    // row breaks your guard on the next one instead of soaking it.
    this._blockedStreak = 0;

    this.dodgeDir = new THREE.Vector3();

    this._buildMesh();
    scene.add(this.root);
  }

  _buildMesh() {
    const root = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6, metalness: 0.2 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xe0483a, roughness: 0.5, metalness: 0.3 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.9, 4, 8), bodyMat);
    body.position.y = 1.05;
    body.castShadow = true;
    root.add(body);
    this.bodyMesh = body;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), bodyMat);
    head.position.y = 1.78;
    head.castShadow = true;
    root.add(head);
    this.headMesh = head;

    const shoulderTrim = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.5), trimMat);
    shoulderTrim.position.y = 1.42;
    root.add(shoulderTrim);

    // Arm pivot: shoulder joint that swings the weapon.
    const armPivot = new THREE.Group();
    armPivot.position.set(0.32, 1.4, 0.05);
    root.add(armPivot);
    this.armPivot = armPivot;

    const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8), bodyMat);
    upperArm.position.set(0, -0.25, 0);
    armPivot.add(upperArm);

    // Off-hand arm: swings opposite the weapon arm while running so the
    // gait reads as a real stride instead of one arm flapping in place.
    const offArmPivot = new THREE.Group();
    offArmPivot.position.set(-0.32, 1.4, 0.05);
    root.add(offArmPivot);
    this.offArmPivot = offArmPivot;
    const offArm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8), bodyMat);
    offArm.position.set(0, -0.25, 0);
    offArmPivot.add(offArm);

    const weaponGroup = new THREE.Group();
    weaponGroup.position.set(0, -0.55, 0);
    armPivot.add(weaponGroup);
    this.weaponGroup = weaponGroup;

    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.28, 8), new THREE.MeshStandardMaterial({ color: 0x2a2016, roughness: 0.8 }));
    hilt.rotation.x = Math.PI / 2;
    weaponGroup.add(hilt);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.06), trimMat);
    guard.position.z = 0.16;
    weaponGroup.add(guard);

    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xc9d3da, roughness: 0.25, metalness: 0.85 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.045, 1.05), bladeMat);
    blade.position.z = 0.7;
    weaponGroup.add(blade);
    this.blade = blade;

    // Rest pose: weapon held down and slightly back (guard stance).
    armPivot.rotation.set(0.3, 0, -0.15);

    this.root = root;
  }

  get weaponTipWorld() {
    const tip = new THREE.Vector3(0, 0, 1.2);
    this.weaponGroup.localToWorld(tip);
    return tip;
  }

  takeDamage(amount, fromDir) {
    if (this.invulnerable || this.state === 'dead') return { taken: 0, parried: false };

    // A parry is a *timed* counter, not just holding block: either you
    // swung within the timing window of the hit landing (a blade trade),
    // or you raised your guard right at the last instant.
    const swungInTime = this._timeSinceAttackPress <= COMBAT.PARRY_TIMING_WINDOW;
    const blockedInTime = this.blocking && this.stateTimer <= COMBAT.PARRY_TIMING_WINDOW;

    if ((swungInTime || blockedInTime) && this._blockedStreak < COMBAT.GUARD_BREAK_THRESHOLD) {
      this._blockedStreak = 0;
      this.combatStamina = clamp(this.combatStamina + COMBAT.PARRY_STAMINA_REFUND, 0, COMBAT.MAX_COMBAT_STAMINA);
      return { taken: 0, parried: true };
    }

    if (this.blocking) {
      if (this._blockedStreak >= COMBAT.GUARD_BREAK_THRESHOLD) {
        // Guard broken: turtling behind block too long stops working.
        this._blockedStreak = 0;
        this.hp = clamp(this.hp - amount, 0, COMBAT.PLAYER_MAX_HP);
        this.audio.hitGrunt();
        this._enterState('hitstun');
        if (this.hp <= 0) { this.alive = false; this._enterState('dead'); this.audio.death(); }
        return { taken: amount, parried: false, guardBroken: true };
      }
      this._blockedStreak++;
      const reduced = amount * COMBAT.BLOCK_DAMAGE_MULT;
      this.hp = clamp(this.hp - reduced, 0, COMBAT.PLAYER_MAX_HP);
      this.audio.block();
      return { taken: reduced, parried: false };
    }

    this._blockedStreak = 0;
    this.hp = clamp(this.hp - amount, 0, COMBAT.PLAYER_MAX_HP);
    this.audio.hitGrunt();
    this._enterState('hitstun');
    if (this.hp <= 0) {
      this.alive = false;
      this._enterState('dead');
      this.audio.death();
    }
    return { taken: amount, parried: false };
  }

  _enterState(s) {
    this.state = s;
    this.stateTimer = 0;
    if (s === 'attack') this.attackPhase = 'windup';
  }

  canAct() {
    return this.state !== 'dead' && this.state !== 'hitstun' && this.state !== 'dodge';
  }

  update(dt, input, camForward, camRight, onHitEnemy) {
    if (this.state === 'dead') {
      this.root.rotation.z = damp(this.root.rotation.z, Math.PI / 2.1, 6, dt);
      return;
    }

    this.stateTimer += dt;
    this._timeSinceAttackPress += dt;
    this.combatStamina = clamp(this.combatStamina + COMBAT.COMBAT_STAMINA_REGEN * dt, 0, COMBAT.MAX_COMBAT_STAMINA);

    // --- state transitions from input ---
    if (this.canAct()) {
      if (input.attackPressed && this.combatStamina >= COMBAT.ATTACK_STAMINA_COST) {
        this.combatStamina -= COMBAT.ATTACK_STAMINA_COST;
        this._timeSinceAttackPress = 0;
        this._enterState('attack');
        this.audio.swing();
      } else if (input.dodgePressed && this.combatStamina >= COMBAT.DODGE_STAMINA_COST) {
        this.combatStamina -= COMBAT.DODGE_STAMINA_COST;
        this._enterState('dodge');
        this.invulnerable = true;
        this.audio.dodge();
        const mx = input.moveX, my = input.moveY;
        const dir = new THREE.Vector3();
        if (Math.hypot(mx, my) > 0.1) {
          dir.addScaledVector(camRight, mx).addScaledVector(camForward, -my);
        } else {
          dir.copy(camForward).negate(); // backstep if no direction held
        }
        dir.y = 0;
        dir.normalize();
        this.dodgeDir.copy(dir);
      } else if (input.blockHeld) {
        if (this.state !== 'block') { this._enterState('block'); }
        this.blocking = true;
      } else {
        this.blocking = false;
        if (this.state === 'block') this._enterState('idle');
      }
    }

    // --- per-state behavior ---
    let moveSpeed = 0;
    let moveVec = new THREE.Vector3();

    this.sprinting = false;
    if (this.state === 'idle' || this.state === 'run' || this.state === 'block') {
      const mx = input.moveX, my = input.moveY;
      const moving = Math.hypot(mx, my) > 0.05;
      if (moving && this.state !== 'block') {
        moveVec.addScaledVector(camRight, mx).addScaledVector(camForward, -my);
        moveVec.y = 0;
        moveVec.normalize();
        const wantsSprint = input.sprint && this.sprintStamina > 0.5;
        moveSpeed = wantsSprint ? SPRINT_SPEED : RUN_SPEED;
        this.sprinting = wantsSprint;
        this.state = 'run';
        this.facingYaw = Math.atan2(moveVec.x, moveVec.z);
      } else if (this.state !== 'block') {
        this.state = 'idle';
      }
    }
    if (this.sprinting) {
      this.sprintStamina = clamp(this.sprintStamina - COMBAT.SPRINT_DRAIN * dt, 0, COMBAT.MAX_SPRINT_STAMINA);
    } else {
      this.sprintStamina = clamp(this.sprintStamina + COMBAT.SPRINT_REGEN * dt, 0, COMBAT.MAX_SPRINT_STAMINA);
    }

    if (this.state === 'attack') {
      this._updateAttack(dt, onHitEnemy);
      // slight forward creep during the active swing for weight
      if (this.attackPhase === 'active') {
        moveVec.set(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
        moveSpeed = 1.4;
      }
    }

    if (this.state === 'dodge') {
      moveVec.copy(this.dodgeDir);
      moveSpeed = DODGE_SPEED;
      this.facingYaw = Math.atan2(this.dodgeDir.x, this.dodgeDir.z) || this.facingYaw;
      if (this.stateTimer >= DODGE_TIME) {
        this.invulnerable = false;
        this._enterState('idle');
      }
    }

    if (this.state === 'hitstun') {
      if (this.stateTimer >= 0.32) this._enterState('idle');
    }

    // --- physics integration ---
    const targetVel = moveVec.multiplyScalar(moveSpeed);
    this.velocity.x = damp(this.velocity.x, targetVel.x, ACCEL, dt);
    this.velocity.z = damp(this.velocity.z, targetVel.z, ACCEL, dt);
    this.position.addScaledVector(this.velocity, dt);

    // Keep inside a soft arena boundary.
    const bound = 11.5;
    this.position.x = clamp(this.position.x, -bound, bound);
    this.position.z = clamp(this.position.z, -bound, bound);

    this.root.position.copy(this.position);
    this.root.rotation.y = damp(this.root.rotation.y, this.facingYaw, 14, dt);

    this._animate(dt);

    // Footstep SFX while actually moving fast on the ground.
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > 1 && this.state !== 'dodge') {
      this._footstepTimer -= dt;
      if (this._footstepTimer <= 0) {
        this.audio.footstep();
        this._footstepTimer = speed > RUN_SPEED + 0.5 ? 0.24 : 0.34;
      }
    }
  }

  _updateAttack(dt, onHitEnemy) {
    const WINDUP = 0.09, ACTIVE = 0.16, RECOVER = 0.17;
    if (this.attackPhase === 'windup' && this.stateTimer >= WINDUP) {
      this.attackPhase = 'active';
      this._hitThisSwing = false;
    } else if (this.attackPhase === 'active' && this.stateTimer >= WINDUP + ACTIVE) {
      this.attackPhase = 'recover';
    } else if (this.attackPhase === 'recover' && this.stateTimer >= WINDUP + ACTIVE + RECOVER) {
      this._enterState('idle');
      this.attackPhase = null;
      return;
    }

    if (this.attackPhase === 'active' && !this._hitThisSwing) {
      const hit = onHitEnemy(this.weaponTipWorld, 0.55);
      if (hit) this._hitThisSwing = true;
    }
  }

  _animate(dt) {
    const t = this.stateTimer;
    let armX = 0.3, armY = 0, armZ = -0.15, bladeGlow = false;
    let offArmX = 0.2;

    if (this.state === 'attack') {
      if (this.attackPhase === 'windup') {
        const p = clamp(t / 0.09, 0, 1);
        armX = damp(0.3, -0.9, 20, dt);
        armY = -0.9 * p;
        armZ = -0.15 - 0.5 * p;
      } else if (this.attackPhase === 'active') {
        const p = clamp((t - 0.09) / 0.16, 0, 1);
        armX = -0.9 + 1.7 * p;
        armY = -0.9 + 1.8 * p;
        armZ = -0.65 + 1.1 * p;
        bladeGlow = true;
      } else if (this.attackPhase === 'recover') {
        const p = clamp((t - 0.25) / 0.17, 0, 1);
        armX = 0.8 - 0.5 * p;
        armY = 0.9 - 0.9 * p;
        armZ = 0.45 - 0.6 * p;
      }
    } else if (this.state === 'block') {
      armX = -0.4; armY = -0.5; armZ = 0.9;
      offArmX = -0.3;
    } else if (this.state === 'run') {
      const stride = this.sprinting ? 15 : 10;
      armX = 0.3 + Math.sin(t * stride) * (this.sprinting ? 0.22 : 0.1);
      offArmX = 0.2 - Math.sin(t * stride) * (this.sprinting ? 0.4 : 0.22);
    } else if (this.state === 'hitstun') {
      armX = 0.1; armZ = -0.4;
      offArmX = 0.5;
    }

    this.armPivot.rotation.x = damp(this.armPivot.rotation.x, armX, 22, dt);
    this.armPivot.rotation.y = damp(this.armPivot.rotation.y, armY, 22, dt);
    this.armPivot.rotation.z = damp(this.armPivot.rotation.z, armZ, 22, dt);
    this.offArmPivot.rotation.x = damp(this.offArmPivot.rotation.x, offArmX, 20, dt);

    this.blade.material.emissive = this.blade.material.emissive || new THREE.Color(0);
    this.blade.material.emissive.setHex(bladeGlow ? 0x552211 : 0x000000);

    // Body lean while running for a sense of weight/momentum — leans harder
    // and bounces more with each stride once you're actually sprinting.
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const speedFrac = clamp(speed / SPRINT_SPEED, 0, 1);
    const lean = speedFrac * (this.sprinting ? 0.22 : 0.12);
    this.bodyMesh.rotation.x = damp(this.bodyMesh.rotation.x, lean, 8, dt);

    if (this.state === 'hitstun') {
      this.root.position.y = Math.abs(Math.sin(t * 40)) * 0.03;
    } else if (this.state === 'run' && speedFrac > 0.15) {
      const stride = this.sprinting ? 15 : 10;
      this.root.position.y = Math.abs(Math.sin(t * stride)) * (this.sprinting ? 0.05 : 0.025) * speedFrac;
    } else {
      this.root.position.y = damp(this.root.position.y, 0, 15, dt);
    }
  }
}
