#!/usr/bin/env node
// Vérifie que l'instrumentation Sentry trace bien les décorateurs NestJS `@Injectable`, `@Catch`
// (@nestjs/common) et `@Cron` (@nestjs/schedule), dans les conditions de la prod :
// `dist/instrument.js` chargé avant Nest, application CommonJS.
//
// Contrôle par comportement, valable pour @sentry/nestjs 10 (décorateurs enveloppés, `__wrapped`)
// comme 11 (diagnostics_channel) : on décore des classes témoins avec les vrais décorateurs, puis
// on lit les marques que Sentry pose en les instrumentant (mêmes noms dans les deux versions) :
// `sentryPatchedInjectable` / `sentryPatchedCatch` sur la classe, `Symbol.for('sentry.nestjs.wrapped')`
// sur la méthode `@Cron`.
//
// Usage : `pnpm build && pnpm sentry:check-instrumentation` (exit 0 si les trois sont tracés).
// Un DSN factice suffit à déclencher `Sentry.init` ; aucun événement n'est émis par ce script.
process.env.SENTRY_DSN ||= 'https://public@o0.ingest.sentry.io/0';
process.env.SENTRY_TRACES_SAMPLE_RATE ||= '0';

const fs = require('node:fs');
const path = require('node:path');

require(path.join(__dirname, '..', 'dist', 'instrument.js'));

const { Injectable, Catch } = require('@nestjs/common');
const { Cron } = require('@nestjs/schedule');

const SENTRY_WRAPPED = Symbol.for('sentry.nestjs.wrapped');

class ProbeService {}
Reflect.decorate([Injectable()], ProbeService);

class ProbeFilter {
  catch() {}
}
Reflect.decorate([Catch()], ProbeFilter);

class ProbeJob {
  run() {}
}
const descriptor = Object.getOwnPropertyDescriptor(ProbeJob.prototype, 'run');
Object.defineProperty(
  ProbeJob.prototype,
  'run',
  Reflect.decorate([Cron('0 0 * * *')], ProbeJob.prototype, 'run', descriptor),
);

const checks = {
  '@Injectable': ProbeService.sentryPatchedInjectable === true,
  '@Catch': ProbeFilter.sentryPatchedCatch === true,
  '@Cron': ProbeJob.prototype.run[SENTRY_WRAPPED] === true,
};
let failures = 0;
for (const [name, traced] of Object.entries(checks)) {
  if (!traced) failures += 1;
  console.log(`${traced ? 'OK  ' : 'FAIL'} ${name}`);
}

/** Version installée, lue sur disque : les paquets ESM n'exportent pas leur package.json. */
function versionOf(pkg) {
  let dir = path.dirname(require.resolve(pkg));
  for (;;) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (json.name === pkg) return json.version;
    }
    dir = path.dirname(dir);
  }
}
console.log(
  ['@sentry/nestjs', '@nestjs/common', '@nestjs/schedule']
    .map((pkg) => `${pkg} ${versionOf(pkg)}`)
    .join(', '),
);
process.exit(failures === 0 ? 0 : 1);
