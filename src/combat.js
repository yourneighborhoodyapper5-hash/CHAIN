// combat.js — small shared constants + collision helpers used by player & enemy.

export const COMBAT = {
  PLAYER_MAX_HP: 100,
  ENEMY_MAX_HP: 140,
  PLAYER_ATTACK_DAMAGE: 16,
  PLAYER_PARRY_COUNTER_DAMAGE: 10,
  ENEMY_ATTACK_DAMAGE: 12,
  ENEMY_GUARD_BREAK_DAMAGE: 22,
  PARRY_STAGGER_TIME: 1.1,
  BLOCK_DAMAGE_MULT: 0.2,

  // Two separate stamina pools, mirroring how the reference game keeps
  // movement stamina and combat stamina from draining each other:
  // sprinting never costs you your ability to fight, and fighting never
  // costs you your ability to run.
  MAX_SPRINT_STAMINA: 100,
  SPRINT_DRAIN: 18, // per second while sprinting
  SPRINT_REGEN: 14, // per second while not sprinting

  MAX_COMBAT_STAMINA: 100,
  ATTACK_STAMINA_COST: 18,
  DODGE_STAMINA_COST: 22,
  PARRY_STAMINA_REFUND: 14, // a clean parry rewards you, block-spam does not
  COMBAT_STAMINA_REGEN: 22, // per second

  // An active parry is a swing timed to the instant the enemy's hit lands —
  // not just holding block. It fully negates damage and staggers the enemy.
  PARRY_TIMING_WINDOW: 0.22,

  // Turtling behind held block (rather than parrying or dodging) builds a
  // guard-break threat, echoing the "choke" punish for over-blocking.
  GUARD_BREAK_THRESHOLD: 3, // consecutive blocked (non-parried) hits
  RAGE_PER_DAMAGE: 0.9, // enemy speeds up / attacks faster as it takes damage
};

export function sphereHit(posA, radiusA, posB, radiusB) {
  const dx = posA.x - posB.x;
  const dy = posA.y - posB.y;
  const dz = posA.z - posB.z;
  const distSq = dx * dx + dy * dy + dz * dz;
  const r = radiusA + radiusB;
  return distSq <= r * r;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}
