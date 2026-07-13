#!/usr/bin/env node
/** Mission 5.8.9 — run validation with pipeline profiling (no app logic changes). */
import { spawnSync } from 'child_process';
import { join } from 'path';

const cwd = join(import.meta.dirname, '..');
const env = {
  ...process.env,
  MISSION_PROFILE: '1',
  MISSION_TIMER: '1',
  MISSION_PROFILE_CONTINUE: '1'
};

console.log('[MISSION_TIMER]', JSON.stringify({
  phase: 'profile:runner',
  start: new Date().toISOString(),
  reason: 'mission-5.8-profile.mjs launch',
  stress: env.MISSION_5_8_STRESS || env.MISSION_58_STRESS || '10',
  deleteStress: env.MISSION_5_8_DELETE_STRESS || env.MISSION_58_DELETE_STRESS || '10'
}));

const t0 = Date.now();
const r = spawnSync('node', ['scripts/mission-5.8-validate.mjs'], {
  cwd,
  env,
  encoding: 'utf8',
  stdio: 'inherit',
  timeout: 0
});
const elapsed = Date.now() - t0;

console.info('[MISSION_TIMER]', JSON.stringify({
  phase: 'profile:runner',
  start: new Date(t0).toISOString(),
  end: new Date().toISOString(),
  elapsed_ms: elapsed,
  exitCode: r.status
}));

process.exit(r.status ?? 1);
