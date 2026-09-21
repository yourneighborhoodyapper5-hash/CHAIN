import * as THREE from 'three';
import { COMBAT, clamp, damp } from './combat.js';

const CHASE_SPEED = 3.4;
const ATTACK_RANGE = 1.9;
const WINDUP_TIME = 0.55;
const ACTIVE_TIME = 0.18;
const RECOVER_TIME = 0.5;

// Beyond this distance the enemy commits to a loud, telegraphed sprint
// straight at the player rather than a slow walk-up — mirrors a hunter
// closing distance with intent rather than two objects drifting together.
const CHARGE_TRIGGER_RANGE = 6.5;
const CHARGE_SPEED = 7.5;
const CHARGE_WINDUP = 0.4;

export class Enemy {
  constructor(scene, audio, position) {
    this.audio = audio;
    this.hp = COMBAT.ENEMY_MAX_HP;
    this.alive = true;
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.facingYaw = 0;

    this.state = 'idle'; // idle, chase, windup, active, recover, staggered, dead, charge-windup, charge
    this.stateTimer = 0;
    this.knockback = new THREE.Vector3();
    this._flashTimer = 0;
    this._hitThisAttack = false;
    this._telegraphed = false;

    // Rage builds as the enemy takes damage, tightening its windups and
    // quickening its feet — the fight gets more intense as it goes rather
    // than staying at one flat difficulty the whole way through.
    this.rage = 0; // 0..1
    this._chargeDir = new THREE.Vector3();

    this._buildMesh();
    scene.add(this.root);
  }

  _buildMesh() {
    const root = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5a3a3a, roughness: 0.7, metalness: 0.15 });
    this.bodyMat = bodyMat;

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 1.05, 4, 8), bodyMat);
    body.position.y = 1.18;
    body.castShadow = true;
    root.add(body);
    this.bodyMesh = body;

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.4), bodyMat);
    head.position.y = 2.05;
    head.castShadow = true;
    root.add(head);

    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xe0483a, emissive: 0x992211, emissiveIntensity: 1.2 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat);
    eyeL.position.set(0.12, 2.05, 0.2);
    root.add(eyeL);
    const eyeR = eyeL.clone();
    eyeR.position.x = -0.12;
    root.add(eyeR);

    const armPivot = new THREE.Group();
    armPivot.position.set(0.4, 1.55, 0.05);
    root.add(armPivot);
    this.armPivot = armPivot;

    const club = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.16, 1.3, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.9 })
    );
    club.position.set(0, -0.65, 0);
    armPivot.add(club);
    this.club = club;

    armPivot.rotation.set(0.2, 0, -0.1);
    this.root = root;
  }

  get weaponTipWorld() {
    const tip = new THREE.Vector3(0, -1.2, 0);
    this.armPivot.localToWorld(tip);
    return tip;
  }

  _enterState(s) {
    this.state = s;
    this.stateTimer = 0;
    this._telegraphed = false;
  }

  applyHit(damage, knockDir) {
    if (this.state === 'dead') return;
    this.hp = clamp(this.hp - damage, 0, COMBAT.ENEMY_MAX_HP);
    this.rage = clamp(this.rage + (damage / COMBAT.ENEMY_MAX_HP) * COMBAT.RAGE_PER_DAMAGE, 0, 1);
    this._flashTimer = 0.15;
    this.knockback.copy(knockDir).multiplyScalar(6);
    this.audio.impact(1);
    if (this.hp <= 0) {
      this.alive = false;
      this._enterState('dead');
    } else if (this.state === 'windup' || this.state === 'active' || this.state === 'charge-windup' || this.state === 'charge') {
      // Getting hit mid-attack (or mid-charge) interrupts it.
      this._enterState('recover');
    }
  }

  parried() {
    this._enterState('staggered');
    this.audio.parry();
  }

  update(dt, playerPos, onAttackPlayer) {
    this.stateTimer += dt;
    if (this._flashTimer > 0) this._flashTimer -= dt;
    this.bodyMat.emissive = this.bodyMat.emissive || new THREE.Color(0);
    this.bodyMat.emissive.setHex(this._flashTimer > 0 ? 0x661111 : 0x000000);

    if (this.state === 'dead') {
      this.root.rotation.z = damp(this.root.rotation.z, -Math.PI / 2.1, 6, dt);
      this.knockback.multiplyScalar(0.9);
      this.position.addScaledVector(this.knockback, dt);
      this.root.position.copy(this.position);
      return;
    }

    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const dir = dist > 0.001 ? toPlayer.clone().normalize() : new THREE.Vector3(0, 0, 1);
    this.facingYaw = Math.atan2(dir.x, dir.z);

    let moveVec = new THREE.Vector3();
    let armX = 0.2, armY = 0, armZ = -0.1;

    // Rage (built by taking damage) tightens the windup and speeds up the
    // legs — the fight should feel like it's escalating, not flat.
    const chaseSpeed = CHASE_SPEED * (1 + this.rage * 0.3);
    const windupTime = WINDUP_TIME * (1 - this.rage * 0.35);

    switch (this.state) {
      case 'idle':
        if (dist < 9) this._enterState('chase');
        break;
      case 'chase':
        if (dist > CHARGE_TRIGGER_RANGE) {
          this._chargeDir.copy(dir);
          this._enterState('charge-windup');
        } else if (dist > ATTACK_RANGE) {
          moveVec.copy(dir).multiplyScalar(chaseSpeed);
        } else {
          this._enterState('windup');
        }
        break;
      case 'charge-windup': {
        // A brief, loud crouch-and-plant before committing to the sprint —
        // the audio/visual "tell" that a charge is coming.
        if (!this._telegraphed) { this.audio.telegraph(1); this._telegraphed = true; }
        armX = 0.5; armZ = 0.3;
        this.bodyMesh.rotation.x = -0.25;
        if (this.stateTimer >= CHARGE_WINDUP) {
          this._enterState('charge');
        }
        break;
      }
      case 'charge': {
        this.bodyMesh.rotation.x = damp(this.bodyMesh.rotation.x, 0.18, 6, dt);
        moveVec.copy(this._chargeDir).multiplyScalar(CHARGE_SPEED);
        armX = 0.1; armZ = -0.2;
        if (dist <= ATTACK_RANGE * 1.3) {
          this._enterState('windup');
        } else if (this.stateTimer >= 1.1) {
          // Overcommitted and missed — brief recovery before resuming the hunt.
          this._enterState('recover');
        }
        break;
      }
      case 'windup': {
        if (!this._telegraphed) { this.audio.telegraph(0.5 + this.rage * 0.5); this._telegraphed = true; }
        const p = clamp(this.stateTimer / windupTime, 0, 1);
        armX = 0.2 - 1.6 * p;
        armZ = -0.1 - 0.3 * p;
        if (dist > ATTACK_RANGE * 1.6) { this._enterState('chase'); break; }
        if (this.stateTimer >= windupTime) {
          this._enterState('active');
          this._hitThisAttack = false;
        }
        break;
      }
      case 'active': {
        const p = clamp(this.stateTimer / ACTIVE_TIME, 0, 1);
        armX = -1.4 + 2.2 * p;
        armZ = -0.4 + 0.6 * p;
        if (!this._hitThisAttack) {
          const hit = onAttackPlayer(this.weaponTipWorld, 0.7);
          if (hit) this._hitThisAttack = true;
        }
        if (this.stateTimer >= ACTIVE_TIME) this._enterState('recover');
        break;
      }
      case 'recover': {
        const p = clamp(this.stateTimer / RECOVER_TIME, 0, 1);
        armX = 0.8 - 0.6 * p;
        armZ = 0.2 - 0.3 * p;
        if (this.stateTimer >= RECOVER_TIME) this._enterState('chase');
        break;
      }
      case 'staggered':
        armX = 0.6; armZ = 0.6;
        this.bodyMesh.rotation.z = Math.sin(this.stateTimer * 25) * 0.08;
        if (this.stateTimer >= COMBAT.PARRY_STAGGER_TIME) {
          this.bodyMesh.rotation.z = 0;
          this._enterState('chase');
        }
        break;
    }

    if (this.state !== 'charge-windup' && this.state !== 'charge') {
      this.bodyMesh.rotation.x = damp(this.bodyMesh.rotation.x, 0, 8, dt);
    }

    this.knockback.multiplyScalar(Math.max(0, 1 - dt * 8));
    const targetVel = moveVec.clone().add(this.knockback);
    this.velocity.x = damp(this.velocity.x, targetVel.x, 20, dt);
    this.velocity.z = damp(this.velocity.z, targetVel.z, 20, dt);
    this.position.addScaledVector(this.velocity, dt);

    const bound = 11.5;
    this.position.x = clamp(this.position.x, -bound, bound);
    this.position.z = clamp(this.position.z, -bound, bound);

    this.root.position.copy(this.position);
    this.root.rotation.y = damp(this.root.rotation.y, this.facingYaw, 8, dt);

    this.armPivot.rotation.x = damp(this.armPivot.rotation.x, armX, 18, dt);
    this.armPivot.rotation.y = damp(this.armPivot.rotation.y, armY, 18, dt);
    this.armPivot.rotation.z = damp(this.armPivot.rotation.z, armZ, 18, dt);
  }
}
