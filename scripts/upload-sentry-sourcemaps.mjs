#!/usr/bin/env node
// Inject + upload source maps to Sentry after a production build.
// Requires SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT in env.
// Optional SENTRY_RELEASE (defaults to git short SHA).
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const DIST = './dist';

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

if (!process.env.SENTRY_AUTH_TOKEN || !process.env.SENTRY_ORG || !process.env.SENTRY_PROJECT) {
  console.error('Missing SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT env vars.');
  process.exit(1);
}
if (!existsSync(DIST)) {
  console.error(`Build output not found at ${DIST}. Run "pnpm build" first.`);
  process.exit(1);
}

const release = process.env.SENTRY_RELEASE
  ?? execSync('git rev-parse --short HEAD').toString().trim();

console.log(`Uploading source maps for release: ${release}`);
run(`pnpm exec sentry-cli sourcemaps inject ${DIST}`);
run(`pnpm exec sentry-cli sourcemaps upload --release "${release}" ${DIST}`);
run(`pnpm exec sentry-cli releases finalize "${release}"`);

// Remove .map files from dist so they're never served publicly.
function purgeMaps(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) purgeMaps(path);
    else if (entry.name.endsWith('.map')) unlinkSync(path);
  }
}
purgeMaps(DIST);
console.log('✓ Source maps uploaded, .map files purged from dist.');
