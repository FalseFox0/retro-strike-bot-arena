// Shared constants. Movement values mirror the GoldSrc / CS 1.6 server defaults.

export const TICK_RATE = 100; // CS 1.6 players ran fps_max 100
export const TICK = 1 / TICK_RATE;
export const DEG = Math.PI / 180;

export const PM = {
  gravity: 800,           // sv_gravity
  friction: 4,            // sv_friction
  edgefriction: 2,        // sv_edgefriction
  stopspeed: 75,          // sv_stopspeed
  accelerate: 5,          // sv_accelerate
  airaccelerate: 10,      // sv_airaccelerate
  maxvelocity: 2000,      // sv_maxvelocity
  stepsize: 18,           // sv_stepsize
  jumpSpeed: Math.sqrt(2 * 800 * 45),
  duckMul: 0.333,         // PLAYER_DUCKING_MULTIPLIER
  walkMul: 0.52,          // cl_movespeedkey
  bunnyjumpMaxSpeedFactor: 1.2,
  timeToDuck: 0.4,
  maxSafeFallSpeed: 580,
  fatalFallSpeed: 1024,
};

// Player hull, origin at the feet (GoldSrc uses the hull centre; we convert).
export const HULL = {
  radius: 16,
  stand: 72,
  duck: 36,
  eyeStand: 53, // 36 + VEC_VIEW 17
  eyeDuck: 30,  // 18 + VEC_DUCK_VIEW 12
};

export const TEAM_T = 'T';
export const TEAM_CT = 'CT';

// CS 1.6 defines fov horizontally on a 4:3 screen. Keep the same vertical
// angle so widescreen gets more on the sides, like the original.
export function vfov(hfov43) {
  return 2 * Math.atan(Math.tan(hfov43 * DEG / 2) * 0.75) / DEG;
}
