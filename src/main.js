import * as THREE from 'three';
import { InputManager } from './input.js';
import { AudioManager } from './audio.js';
import { CombatCamera } from './camera.js';
import { Player } from './player.js';
import { Enemy } from './enemy.js';
import { COMBAT, sphereHit } from './combat.js';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1512);
scene.fog = new THREE.Fog(0x1a1512, 14, 34);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 200);

// ---------- lighting ----------
const hemi = new THREE.HemisphereLight(0x9aa5c9, 0x241a12, 0.55);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffe4b8, 1.4);
sun.position.set(8, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
sun.shadow.camera.far = 40;
scene.add(sun);

const rim = new THREE.PointLight(0xe0483a, 0.8, 20);
rim.position.set(-6, 4, -6);
scene.add(rim);

// ---------- arena ----------
const arenaRadius = 12;
const groundMat = new THREE.MeshStandardMaterial({ color: 0x453a30, roughness: 0.95 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(arenaRadius, 48), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const ringMat = new THREE.MeshStandardMaterial({ color: 0x2a231c, roughness: 0.9 });
const ring = new THREE.Mesh(new THREE.RingGeometry(arenaRadius - 0.4, arenaRadius + 0.6, 48), ringMat);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.01;
scene.add(ring);

// Simple original pillars around the arena for silhouette/readability.
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x5a4d3c, roughness: 0.85 });
for (let i = 0; i < 8; i++) {
  const angle = (i / 8) * Math.PI * 2;
  const r = arenaRadius + 1.2;
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 4.5, 8), pillarMat);
  pillar.position.set(Math.cos(angle) * r, 2.25, Math.sin(angle) * r);
  pillar.castShadow = true;
  pillar.receiveShadow = true;
  scene.add(pillar);
}

// ---------- systems ----------
const audio = new AudioManager();
const player = new Player(scene, audio);
const enemy = new Enemy(scene, audio, new THREE.Vector3(0, 0, -5));
const camCtl = new CombatCamera(camera, player.root);
const input = new InputManager(renderer.domElement);

// ---------- HUD ----------
const el = {
  playerHealth: document.getElementById('player-health'),
  enemyHealth: document.getElementById('enemy-health'),
  sprintStamina: document.getElementById('sprint-stamina'),
  combatStamina: document.getElementById('combat-stamina'),
  prompt: document.getElementById('prompt'),
  startScreen: document.getElementById('start-screen'),
  deathScreen: document.getElementById('death-screen'),
  deathTitle: document.getElementById('death-title'),
  startBtn: document.getElementById('start-btn'),
  retryBtn: document.getElementById('retry-btn'),
};

let gameState = 'menu'; // menu, playing, dead
let promptTimeout = null;

function showPrompt(text) {
  el.prompt.textContent = text;
  el.prompt.classList.add('show');
  clearTimeout(promptTimeout);
  promptTimeout = setTimeout(() => el.prompt.classList.remove('show'), 650);
}

function startGame() {
  audio.unlock();
  el.startScreen.classList.add('hidden');
  gameState = 'playing';
}
function resetGame() {
  player.hp = COMBAT.PLAYER_MAX_HP;
  player.sprintStamina = COMBAT.MAX_SPRINT_STAMINA;
  player.combatStamina = COMBAT.MAX_COMBAT_STAMINA;
  player._blockedStreak = 0;
  player.alive = true;
  player.position.set(0, 0, 6);
  player._enterState('idle');

  enemy.hp = COMBAT.ENEMY_MAX_HP;
  enemy.alive = true;
  enemy.rage = 0;
  enemy.position.set(0, 0, -5);
  enemy._enterState('idle');

  el.deathScreen.classList.add('hidden');
  gameState = 'playing';
}

el.startBtn.addEventListener('click', startGame);
el.retryBtn.addEventListener('click', resetGame);

// ---------- combat wiring ----------
const enemyHurtCenter = new THREE.Vector3();
const playerHurtCenter = new THREE.Vector3();

// A very brief freeze on impact — the single biggest lever for making a
// hit register as *heavy* rather than two numbers changing. Kept tiny
// (a few dozen ms) so it reads as punch, not lag.
let hitstopTimer = 0;
function triggerHitstop(seconds) {
  hitstopTimer = Math.max(hitstopTimer, seconds);
}

function onPlayerHitEnemy(tipPos, radius) {
  if (!enemy.alive) return false;
  enemyHurtCenter.copy(enemy.position);
  enemyHurtCenter.y += 1.1;
  if (!sphereHit(tipPos, radius, enemyHurtCenter, 0.6)) return false;

  const knockDir = new THREE.Vector3().subVectors(enemy.position, player.position);
  knockDir.y = 0;
  knockDir.normalize();
  enemy.applyHit(COMBAT.PLAYER_ATTACK_DAMAGE, knockDir);
  camCtl.shake(0.18, knockDir);
  triggerHitstop(0.05);
  return true;
}

function onEnemyHitPlayer(tipPos, radius) {
  if (!player.alive) return false;
  playerHurtCenter.copy(player.position);
  playerHurtCenter.y += 1.1;
  if (!sphereHit(tipPos, radius, playerHurtCenter, 0.55)) return false;

  const pushDir = new THREE.Vector3().subVectors(player.position, enemy.position);
  pushDir.y = 0;
  pushDir.normalize();

  const result = player.takeDamage(COMBAT.ENEMY_ATTACK_DAMAGE);
  if (result.parried) {
    enemy.parried();
    showPrompt('PARRY!');
    camCtl.shake(0.14, pushDir);
    triggerHitstop(0.07);
  } else if (result.guardBroken) {
    showPrompt('GUARD BROKEN');
    camCtl.shake(0.3, pushDir);
    triggerHitstop(0.09);
  } else if (result.taken > 0) {
    camCtl.shake(0.24, pushDir);
    triggerHitstop(result.taken >= COMBAT.ENEMY_ATTACK_DAMAGE ? 0.08 : 0.04);
  }
  return true;
}

// ---------- main loop ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const frame = input.poll();

  if (gameState === 'playing') {
    // Drain the hitstop window first; while it's active, gameplay updates
    // run in near-slow-motion for a couple of frames instead of pausing
    // outright (a hard pause reads as a stutter, not a punch).
    let dt = rawDt;
    if (hitstopTimer > 0) {
      hitstopTimer -= rawDt;
      dt = rawDt * 0.06;
    }

    camCtl.look(frame.lookX, frame.lookY);

    const forward = camCtl.getForward();
    const right = camCtl.getRight();

    player.update(dt, frame, forward, right, onPlayerHitEnemy);
    enemy.update(dt, player.position, onEnemyHitPlayer);

    camCtl.update(rawDt, { running: player.state === 'run', blocking: player.blocking, sprinting: player.sprinting });

    el.playerHealth.style.transform = `scaleX(${player.hp / COMBAT.PLAYER_MAX_HP})`;
    el.enemyHealth.style.transform = `scaleX(${Math.max(enemy.hp, 0) / COMBAT.ENEMY_MAX_HP})`;
    el.sprintStamina.style.transform = `scaleX(${player.sprintStamina / COMBAT.MAX_SPRINT_STAMINA})`;
    el.combatStamina.style.transform = `scaleX(${player.combatStamina / COMBAT.MAX_COMBAT_STAMINA})`;

    if (!player.alive && gameState === 'playing') {
      gameState = 'dead';
      el.deathTitle.textContent = 'YOU DIED';
      setTimeout(() => el.deathScreen.classList.remove('hidden'), 900);
    } else if (!enemy.alive && gameState === 'playing') {
      gameState = 'dead';
      el.deathTitle.textContent = 'VICTORY';
      setTimeout(() => el.deathScreen.classList.remove('hidden'), 900);
    }
  } else {
    // Idle camera drift on the menu / death screen so the scene stays alive.
    camCtl.update(rawDt, { running: false, blocking: false, sprinting: false });
  }

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
