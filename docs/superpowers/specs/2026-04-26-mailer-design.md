# Mailer — Design

| | |
|---|---|
| **Date** | 2026-04-26 |
| **Statut** | En attente de relecture utilisateur |
| **Périmètre** | Sous-projet "Mailer" (7a) du chantier de migration Hono → NestJS |
| **Projet cible** | `/home/jned/WebstormProjects/J-Ned/nest-portfolio-app` |
| **Specs précédents** | Fondations, Auth, Profile public, S3 Storage, Projects, Avatar Profile |
| **Spec suivant prévu** | Contact (7b — premier consommateur du Mailer) |

---

## 1. Contexte & motivation

Six sous-projets sont terminés. Le pattern d'isolation des modules d'infrastructure (`StorageModule @Global` → consommé par Projects et Avatar) a fait ses preuves. Le sous-projet **Contact** du backend Hono mélange deux préoccupations distinctes :
- Une **infrastructure SMTP** (réutilisable par Bookings, futurs modules avec notification)
- Une **feature métier** (table `contact_message`, endpoints CRUD admin, formulaire public, 2 templates d'email)

Plutôt que d'implémenter le tout en un seul gros sous-projet (ce qui rendrait la review difficile et le mailer non-testé indépendamment), on **scinde** :
- **7a — Mailer** *(ce sous-projet)* : `MailerModule @Global` exposant un `MailerService` générique. Pas de feature métier, pas de DB, pas de templates par défaut.
- **7b — Contact** *(suivant)* : table + 6 endpoints + 2 templates qui consomment `MailerService`.

Calque exact de la décomposition S3 Storage → Projects.

L'utilisateur a son SMTP en prod (typiquement OVH/Gmail/SES). Pour le dev local, on utilise **Mailpit** (SMTP catch-all + web UI), même pattern que MinIO pour S3.

## 2. Scope

### Inclus

- **`MailerModule`** `@Global` exposant le service.
- **`MailerService`** avec 1 méthode publique : `sendMail({ to, subject, html }): Promise<void>` (3 retries linear backoff 1s/2s/3s, throws après échec final).
- **`MAIL_TRANSPORTER`** injection token (Symbol) avec provider factory créant le `Transporter` nodemailer depuis `AppConfigService`.
- **`OnModuleDestroy`** qui appelle `transporter.close()` (cleanup keep-alive SMTP).
- **`compose.yaml` étendu** : service `mailpit` (image officielle, ports `1025` SMTP + `8025` web UI).
- **6 nouvelles env vars** (`SMTP_HOST/PORT/SECURE/USER/PASS/FROM`) validées Zod fail-fast au boot.
- **6 getters** dans `AppConfigService`.
- **Helpers `src/mailer/mailer.utils.ts`** : `renderTemplate(html, vars)` et `loadTemplate(absolutePath)`.
- **Tests unitaires** : ~6 sur `MailerService` (mock du `Transporter`) + ~4 sur les utils.
- **Scripts pnpm** : `mail:up`, `mail:down`, `mail:logs`, `mail:console`. Extension du `predev`.
- **Mise à jour README** : section "Mailer" avec API + usage + config prod.

### Explicitement exclus

- **Aucun controller HTTP** : couche infra pure. Calque ADR-14 du S3 Storage spec.
- **Aucune logique métier** : pas de templates par défaut, pas de "send welcome email", pas de persistence des envois. Chaque feature module rend ses propres templates et appelle `sendMail`.
- **Pas de queue / retry persistante** : si les 3 retries échouent, l'erreur remonte au consumer qui décide. Contact (7b) fera fire-and-forget avec `.catch(logger)` au niveau du request handler.
- **Pas de moteur de templates** (Handlebars/Pug/EJS) : `replaceVariables` simple par string replace `{{var}}`. Si du conditionnel devient nécessaire, on étendra.
- **Pas de tests d'intégration Mailpit** dans ce sous-projet : validation e2e remontée au sous-projet **Contact** (premier consommateur réel). Calque exact du pattern S3 → Projects.
- **Pas de variables `CONTACT_EMAIL`/`PHONE`/`LOCATION`** : elles viendront avec le sous-projet Contact (7b), qui les expose via `GET /contact/info`.
- **Pas de `tls.rejectUnauthorized: false`** par défaut : on respecte la chaîne TLS prod. En dev local Mailpit, `SMTP_SECURE=false` désactive TLS (port 1025 plain).
- **Pas de health check Mailer** : `/health` reste sur le test DB seul. Si SMTP est down, un envoi futur échouera proprement, c'est suffisant (mêmes principes que S3 dans le sous-projet précédent).
- **Pas de `MailerService.sendTemplated(...)`** : YAGNI. Le consumer fait `renderTemplate(loadTemplate('xxx.html'), {...})` puis `sendMail({ html: rendered, ... })`.

## 3. Décisions clés (résumé)

| Q | Choix | Conséquence |
|---|---|---|
| Q1 — découpage Contact | B : 2 sous-projets (Mailer 7a + Contact 7b) | Calque S3 → Projects. Mailer testable et réutilisable indépendamment |
| Q2 — lib mail | A : `nodemailer` direct (pas de wrapper) | Calque Hono. Contrôle total, dépendances minimales |
| Q3 — API + templates | A : `sendMail({ to, subject, html })` minimal + helpers `renderTemplate`/`loadTemplate` | Templates vivent à côté de leur feature module, découplé |
| Q4 — SMTP dev | A : container Mailpit dans `compose.yaml` | Onboarding zero-friction, calque MinIO |
| (lock) — Retry | 3 tentatives, backoff linéaire 1s/2s/3s | Calque Hono, robuste contre blips SMTP |
| (lock) — Lifecycle | `OnModuleDestroy` + `transporter.close()` | Calque `StorageModule.s3.destroy()` |
| (lock) — `renderTemplate` | Standalone export depuis `mailer.utils.ts` | Pareil que `MIME_TO_EXT` dans `projects.utils.ts` |

## 4. Architecture & graphe de modules

```
┌──────────────────────────────────────────────────────────────┐
│ AppModule (existant après Avatar Profile)                    │
│                                                              │
│  Imports actuels :                                           │
│   ├── ConfigModule + AppConfigModule                         │
│   ├── LoggerModule (Pino)            ← @Global               │
│   ├── DatabaseModule                  ← @Global              │
│   ├── HealthModule                                           │
│   ├── AuthModule                                             │
│   ├── 7 modules Profile public                               │
│   ├── StorageModule                   ← @Global              │
│   └── ProjectsModule                                         │
│                                                              │
│  AJOUT de ce sous-projet :                                   │
│   └── MailerModule                    ← @Global              │
│         providers: MAIL_TRANSPORTER (Symbol → Transporter)   │
│                    MailerService                             │
│         exports:   MailerService                             │
└──────────────────────────────────────────────────────────────┘
```

### Principes

- **`MailerModule @Global`** : calque exact `StorageModule`/`DatabaseModule`. Une fois importé dans `AppModule`, `MailerService` est injectable sans `imports: [MailerModule]` dans les feature modules.
- **`MAIL_TRANSPORTER` injection token (Symbol)** : calque `S3_CLIENT`/`DRIZZLE`. Le `Transporter` nodemailer est créé une seule fois via `useFactory` qui inject `AppConfigService`.
- **`MailerService` exporté** (pas le transporter direct) : abstraction propre, les consumers utilisent l'API NestJS-friendly.
- **Pas de controller HTTP** : `MailerService` est purement consommé par d'autres services.
- **Pas d'interaction DB** : pure couche I/O réseau SMTP.
- **`OnModuleDestroy`** : cleanup keep-alive SMTP via `transporter.close()` sur SIGTERM.

## 5. Arborescence des fichiers

```
src/
├── app.module.ts                        # MODIFIÉ : +MailerModule
│
├── config/                              # MODIFIÉ : +6 env vars
│   ├── env.schema.ts                    # +SMTP_*
│   ├── env.validation.spec.ts           # +tests
│   ├── app-config.service.ts            # +6 getters
│   └── app-config.module.ts             # INCHANGÉ
│
├── (autres modules — INCHANGÉS)
│
└── mailer/                              # NEW
    ├── mailer.module.ts                 # @Global, OnModuleDestroy
    ├── mailer.service.ts                # sendMail() avec retry
    ├── mailer.service.spec.ts           # ~6 tests (Transporter mock)
    ├── mailer.constants.ts              # MAIL_TRANSPORTER = Symbol(...)
    ├── mailer.utils.ts                  # renderTemplate, loadTemplate
    └── mailer.utils.spec.ts             # ~4 tests purs

compose.yaml                             # MODIFIÉ : +mailpit service
.env.example                             # MODIFIÉ : +6 env vars
package.json                             # MODIFIÉ : +nodemailer + scripts mail:*
```

### Notes structurelles

- Calque `src/storage/` : `module.ts`, `service.ts`, `service.spec.ts`, `constants.ts`. On a `mailer.utils.ts` (avec son spec) à la place de `storage.types.ts` car on n'a pas de type custom à exporter (`Transporter` vient déjà de `nodemailer`), mais on a 2 helpers utiles.
- `compose.yaml` final : 4 services (`postgres`, `minio`, `minio-init`, `mailpit`).
- Mailpit n'a pas de volume : les mails de dev sont éphémères. Acceptable, redémarrer Mailpit les vide.

## 6. Configuration

### Env vars

6 nouvelles. Toutes requises sauf `SMTP_PORT` (défaut `587`) et `SMTP_SECURE` (défaut `false`).

| Variable | Type | Défaut | Rôle |
|---|---|---|---|
| `SMTP_HOST` | string min 1 | *(requis)* | Hôte SMTP (`localhost` Mailpit, `smtp.gmail.com` prod) |
| `SMTP_PORT` | int 1-65535 | `587` | Port SMTP (`1025` Mailpit, `587` STARTTLS, `465` TLS direct) |
| `SMTP_SECURE` | boolean | `false` | TLS direct (`true` pour port 465, `false` pour STARTTLS ou plain) |
| `SMTP_USER` | string min 1 | *(requis)* | Authentification SMTP user |
| `SMTP_PASS` | string min 1 | *(requis)* | Authentification SMTP password |
| `SMTP_FROM` | email | *(requis)* | Adresse expéditeur (peut différer de `SMTP_USER`) |

> **Note** : Mailpit dev n'a pas d'auth réelle. On met des creds bidons (`SMTP_USER=mailpit`/`SMTP_PASS=mailpit`) qui sont ignorés. La validation Zod exige les champs même si Mailpit ne les utilise pas — c'est cohérent avec le fail-fast (si tu passes en prod sans changer, tu sais que tu dois les remplir).

### `env.schema.ts` étendu

```typescript
SMTP_HOST: z.string().min(1),
SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
SMTP_SECURE: z.coerce.boolean().default(false),
SMTP_USER: z.string().min(1),
SMTP_PASS: z.string().min(1),
SMTP_FROM: z.string().email(),
```

### `AppConfigService` étendu

```typescript
get smtpHost() { return this.config.get('SMTP_HOST', { infer: true }); }
get smtpPort() { return this.config.get('SMTP_PORT', { infer: true }); }
get smtpSecure() { return this.config.get('SMTP_SECURE', { infer: true }); }
get smtpUser() { return this.config.get('SMTP_USER', { infer: true }); }
get smtpPass() { return this.config.get('SMTP_PASS', { infer: true }); }
get smtpFrom() { return this.config.get('SMTP_FROM', { infer: true }); }
```

### `.env.example` étendu

```bash
# Mailer — Mailpit local en dev, vrai SMTP en prod
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=mailpit
SMTP_PASS=mailpit
SMTP_FROM=noreply@nedellec-julien.fr
```

## 7. `compose.yaml` étendu

```yaml
services:
  postgres:
    # ... existant inchangé ...

  minio:
    # ... existant inchangé ...

  minio-init:
    # ... existant inchangé ...

  mailpit:
    image: docker.io/axllent/mailpit:latest
    container_name: portfolio-nest-mail
    restart: unless-stopped
    ports:
      - "1025:1025"   # SMTP
      - "8025:8025"   # Web UI
    environment:
      MP_SMTP_AUTH_ACCEPT_ANY: 1
      MP_SMTP_AUTH_ALLOW_INSECURE: 1
    healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost:8025"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  portfolio_nest_pgdata:
  portfolio_nest_minio_data:
```

### Décisions clés

> **`mailpit:latest`** : Mailpit publie souvent sans break SMTP. Pin si reproductibilité absolue voulue.
>
> **`MP_SMTP_AUTH_ACCEPT_ANY=1`** : Mailpit accepte n'importe quels creds (utile pour que notre code prod-like avec auth fonctionne sans config Mailpit-spécifique).
>
> **`MP_SMTP_AUTH_ALLOW_INSECURE=1`** : permet l'auth en clair sur la connexion SMTP non-TLS (port 1025).
>
> **Pas de volume** : éphémère, calque l'absence de persistence pour les mails de dev. Si besoin, on ajoutera `MP_DATABASE=/data/mailpit.db` + un volume.

## 8. Code détaillé

### `src/mailer/mailer.constants.ts`

```typescript
export const MAIL_TRANSPORTER = Symbol('MAIL_TRANSPORTER');
```

### `src/mailer/mailer.utils.ts`

```typescript
import { readFileSync } from 'node:fs';

export function renderTemplate(
  html: string,
  variables: Record<string, string>,
): string {
  let result = html;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

export function loadTemplate(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf-8');
}
```

> Port 1:1 du Hono `replaceVariables`. Pas de gestion HTML escaping — les variables sont supposées safe (admin-trusted ou validées par DTO du consumer).

### `src/mailer/mailer.service.ts`

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { AppConfigService } from '../config/app-config.service';
import { MAIL_TRANSPORTER } from './mailer.constants';

const MAX_RETRIES = 3;

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(
    @Inject(MAIL_TRANSPORTER) private readonly transporter: Transporter,
    private readonly cfg: AppConfigService,
  ) {}

  async sendMail({ to, subject, html }: SendMailOptions): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.transporter.sendMail({
          from: this.cfg.smtpFrom,
          to,
          subject,
          html,
        });
        return;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * attempt),
          );
        }
      }
    }
    this.logger.error(
      `Failed to send email to ${to} after ${MAX_RETRIES} attempts`,
      lastError,
    );
    throw lastError;
  }
}
```

### `src/mailer/mailer.module.ts`

```typescript
import {
  Global,
  Inject,
  Module,
  OnModuleDestroy,
  type Provider,
} from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { MAIL_TRANSPORTER } from './mailer.constants';
import { MailerService } from './mailer.service';

const transporterProvider: Provider = {
  provide: MAIL_TRANSPORTER,
  inject: [AppConfigService],
  useFactory: (cfg: AppConfigService): Transporter =>
    createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: cfg.smtpSecure,
      auth: {
        user: cfg.smtpUser,
        pass: cfg.smtpPass,
      },
    }),
};

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [transporterProvider, MailerService],
  exports: [MailerService],
})
export class MailerModule implements OnModuleDestroy {
  constructor(
    @Inject(MAIL_TRANSPORTER) private readonly transporter: Transporter,
  ) {}

  onModuleDestroy(): void {
    this.transporter.close();
  }
}
```

## 9. Tests

### `src/mailer/mailer.utils.spec.ts` (~4 tests)

- `renderTemplate` remplace une variable simple
- `renderTemplate` remplace plusieurs occurrences de la même variable
- `renderTemplate` laisse intactes les variables non fournies
- `renderTemplate` gère un template sans variables / variables vides

> `loadTemplate` est un wrapper trivial sur `readFileSync` — testable via `jest.spyOn(fs, 'readFileSync')` mais YAGNI : on omet le test (couvert implicitement par les tests d'intégration au sous-projet Contact).

### `src/mailer/mailer.service.spec.ts` (~6 tests)

| # | Cas |
|---|---|
| 1 | `sendMail` succès → `transporter.sendMail` appelé une fois avec les bons params |
| 2 | `sendMail` utilise `cfg.smtpFrom` comme expéditeur |
| 3 | Première tentative échoue, deuxième réussit → retry, pas de throw |
| 4 | 3 tentatives échouent → throw l'erreur, log error |
| 5 | Backoff respecté (mock `setTimeout` ou `jest.useFakeTimers()`) |
| 6 | Sujet et HTML passés tels quels (pas de transformation par le service) |

**Stack** : mock du `Transporter` via Jest (`jest.fn().mockResolvedValue` / `mockRejectedValueOnce` pour le scénario retry), mock de `AppConfigService` avec un `smtpFrom: 'noreply@test'`.

### Pas de tests d'intégration Mailpit

Validation e2e remontée au sous-projet **Contact** (premier vrai consommateur). Les tests de ce sous-projet vérifient la logique du service (retry, signature des appels), pas la connectivité réseau SMTP.

## 10. Scripts pnpm finaux

```json
"mail:up": "podman compose up -d mailpit",
"mail:down": "podman compose stop mailpit",
"mail:logs": "podman compose logs -f mailpit",
"mail:console": "echo 'Mailpit web UI: http://localhost:8025'",
"predev": "pnpm db:up && pnpm db:wait && pnpm s3:up && pnpm mail:up"
```

## 11. Critères de done

Le sous-projet est terminé quand toutes ces conditions sont vraies :

1. **Dépendances** : `nodemailer` (prod) + `@types/nodemailer` (dev). `pnpm install` idempotent.
2. **Env vars** : 6 nouvelles dans `env.schema.ts`, 6 getters dans `AppConfigService`, validation Zod fail-fast au boot. Tests env étendus.
3. **`compose.yaml` étendu** : service `mailpit` opérationnel. `pnpm mail:up` démarre le container, web UI répond sur `http://localhost:8025`.
4. **`MailerModule @Global`** wiré dans `AppModule`. Boot logs montrent `MailerModule dependencies initialized`.
5. **`MailerService.sendMail`** : retry 3x linear backoff, throws final si tous échouent, log error.
6. **`OnModuleDestroy`** appelle `transporter.close()` (vérifié manuellement : Ctrl+C ferme proprement, pas de hang).
7. **Helpers `renderTemplate`/`loadTemplate`** exportés et testés.
8. **Tests** : ~10 nouveaux (~4 utils + ~6 service), tous verts. Total projet ~167 tests.
9. **Build prod** OK, **lint** clean.
10. **Vérification end-to-end manuelle** :
    ```bash
    pnpm mail:up
    curl -fsS http://localhost:8025                     # Mailpit web UI répond 200
    # Test rapide via REPL ou un script ad-hoc :
    # transporter.sendMail({ from, to, subject, html: '<p>hi</p>' })
    # Vérifier que le mail apparaît dans Mailpit (UI http://localhost:8025)
    ```
11. **README mis à jour** : section "Mailer" + liste des sous-projets : `7. ✅ Mailer (MailerModule + Mailpit local)`, `8. **Contact** *(prochain)* (consomme Mailer)`.

## 12. Hors scope (suite du chantier)

Une fois ce sous-projet terminé :

8. **Contact** (table `contact_message`, 6 endpoints, 2 templates, premier consommateur du `MailerService`).
9. **Bookings** (réservations + slots + 2 templates booking, deuxième consommateur du `MailerService`).
10. **CV** (`POST /cv` + `GET /cv/download` qui consomment `StorageService`).
11. **Analytics** (page views + agrégats).
12. **Frontend Angular adaptation** + **migration des données réelles** depuis le backend Hono.
