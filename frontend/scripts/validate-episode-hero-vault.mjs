#!/usr/bin/env node
/**
 * Back-compat runner — delegates to validate-episode-vault-resolver.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, [path.join(dir, 'validate-episode-vault-resolver.mjs')], {
    stdio: 'inherit'
});
process.exit(r.status ?? 1);
