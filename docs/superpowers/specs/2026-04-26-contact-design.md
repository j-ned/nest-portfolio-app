# Contact — Design

| | |
|---|---|
| **Date** | 2026-04-26 |
| **Statut** | En attente de relecture utilisateur |
| **Périmètre** | Sous-projet "Contact" (7b) du chantier de migration Hono → NestJS |
| **Projet cible** | `/home/jned/WebstormProjects/J-Ned/nest-portfolio-app` |
| **Specs précédents** | Fondations, Auth, Profile public, S3 Storage, Projects, Avatar Profile, Mailer (7a) |
| **Spec suivant prévu** | Bookings (réservations + slots + 2 mails — 2ème consommateur Mailer) |

---

## 1. Contexte & motivation

Sept sous-projets sont terminés. Le sous-projet **Mailer (7a)** a livré un `MailerModule @Global` exposant `MailerService.sendMail({ to, subject, html })` + helpers `renderTemplate`/`loadTemplate`. Aucun consommateur réel pour l'instant.

**Contact (7b)** est le **premier vrai consommateur du Mailer** — calque exact du pattern S3 → Projects (infra livrée puis premier consumer qui valide e2e). Il porte la feature Contact du backend Hono : table de messages + 6 endpoints + 2 templates HTML.

L'admin du portfolio reçoit une notification email à chaque message envoyé via le formulaire de contact ; le visiteur reçoit une confirmation. Les messages sont persistés en DB pour consultation/archive admin.

## 2. Scope

### Inclus

- **Schéma Drizzle** `contact_message` (uuid + 6 cols + 3 indexes : `read`, `createdAt`, composite `read+createdAt`).
- **Migration Drizzle** `0003_*.sql` (autogénérée standard).
- **`ContactModule`** : controller + service + 2 DTOs + tests.
- **6 endpoints sous `/contact`** :
  - `GET /contact/info` (public) → `{ email, phone, location }` depuis env vars
  - `POST /contact/messages` (public, **throttled 5/60s par IP**) → DB insert puis 2 mails fire-and-forget → 201
  - `GET /contact/messages?page&limit` (admin, paginated) → `{ data, total, page, limit }`
  - `GET /contact/messages/unread-count` (admin) → `{ count }`
  - `PATCH /contact/messages/:id/read` (admin) → marque le message lu, retourne row
  - `DELETE /contact/messages/:id` (admin) → suppression hard, 204
- **`@nestjs/throttler`** : `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])` global (default permissif). `@Throttle({ default: { limit: 5, ttl: 60_000 } })` sur `POST /messages`. Guard `ThrottlerGuard` registered via `APP_GUARD`.
- **3 nouvelles env vars** validées Zod : `CONTACT_EMAIL` (email destinataire des notifications admin), `CONTACT_PHONE`, `CONTACT_LOCATION`.
- **3 getters** dans `AppConfigService`.
- **Helper partagé `src/common/pagination.ts`** : `parsePagination(input): { page, limit, offset }` + types `PaginationParams`/`PaginatedResult<T>`. Premier utilitaire transversal — réutilisable par Bookings et autres modules paginés.
- **Templates HTML** : port 1:1 depuis Hono → `src/contact/mail-templates/contact-notification.html` + `contact-confirmation.html`.
- **Wiring** : `ContactModule` + `ThrottlerModule` dans `AppModule.imports`. Schéma dans le barrel `src/database/schema/index.ts`.
- **Deps** : `@nestjs/throttler` (prod). `class-transformer` est déjà installé (`ValidationPipe` global).
- **Tests** : ~18 nouveaux (5 pagination utils + 13 service avec MailerService mock).
- **Mise à jour README** : section "Contact" + liste des sous-projets renumérotée.

### Explicitement exclus

- **Pas de filtres serveur autres que pagination** : pas de `?read=true`, `?email=...`, `?from=...`. Le frontend admin filtre côté client si besoin (vu le volume bas attendu).
- **Pas de soft delete, pas de tags, pas d'archivage**.
- **Pas de `PATCH /messages/:id/unread`** (toggle inverse) — YAGNI. Si besoin un jour, extension du PATCH avec body `{ read: boolean }`.
- **Pas de `POST /messages/:id/reply`** (réponse admin depuis l'app) — l'admin répond avec son client mail externe (`mailto:` ou copie de l'adresse).
- **Pas de Redis-store pour throttler** : in-memory suffit pour 1 instance backend. Si on scale horizontalement plus tard, on migrera.
- **Pas de captcha / hCaptcha / reCAPTCHA** : le throttler 5/60s est notre seule défense anti-spam pour l'instant. Si abus détecté en prod, on rajoutera un captcha.
- **Pas de signature DKIM / SPF / DMARC** : config DNS hors scope (à faire en prod chez l'utilisateur côté domaine).
- **Pas de gestion HTML escaping dans les templates** : les variables sont DTO-validées (email, name, subject, message — text courts plain). `renderTemplate` est déjà résistant aux `$`-injection (cf. fix `3075f46` dans Mailer subproject). Si une var contient du HTML, le mail sera rendu avec — admin trusted (l'admin reçoit ses propres mails) et visiteur reçoit ce qu'il a saisi (auto-XSS).
- **Pas de tests d'intégration Mailpit** : on mock `MailerService` dans les tests unitaires. La validation e2e via Mailpit a déjà été faite au sous-projet Mailer (7a).

## 3. Décisions clés (résumé)

| Q | Choix | Conséquence |
|---|---|---|
| Q1 — endpoints scope | A : 6 endpoints (parité Hono complète) | Pagination + unread-count utiles pour admin avec historique long |
| Q2 — rate limiting | A : `@nestjs/throttler` officiel par route | Idiomatique NestJS, scalable Redis si besoin |
| Q3 — stratégie mails | A : fire-and-forget après DB insert | Réponse rapide visiteur, persistence garantie même si SMTP down |
| (lock) — `CONTACT_*` | 3 env vars Zod-validées | Cohérent Hono, simple |
| (lock) — pagination defaults | `page=1, limit=10, max=100` | Calque Hono `parsePagination` |
| (lock) — validation DTO | bornes 200/320/200/5000 | Anti-DoS sur message length |
| (lock) — read flag | PATCH read-only (pas de toggle unread) | YAGNI |
| (lock) — pagination helper | `src/common/pagination.ts` partagé | Premier consumer Contact, ré-utilisable Bookings |

## 4. Architecture & graphe de modules

```
┌──────────────────────────────────────────────────────────────┐
│ AppModule (existant après Mailer 7a)                         │
│                                                              │
│  Imports actuels :                                           │
│   ├── ConfigModule + AppConfigModule                         │
│   ├── LoggerModule (Pino)            ← @Global               │
│   ├── DatabaseModule                  ← @Global              │
│   ├── HealthModule                                           │
│   ├── AuthModule                                             │
│   ├── 7 modules Profile public                               │
│   ├── StorageModule                   ← @Global              │
│   ├── ProjectsModule                                         │
│   └── MailerModule                    ← @Global              │
│                                                              │
│  AJOUT de ce sous-projet :                                   │
│   ├── ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])  │
│   │     + APP_GUARD provider {ThrottlerGuard}                │
│   └── ContactModule                                          │
│         imports: [AuthModule]                                │
│         controllers: [ContactController]                     │
│         providers: [ContactService]                          │
│         ContactService injecte :                             │
│           ├── DRIZZLE     (DatabaseModule @Global)           │
│           ├── AppConfigService                               │
│           └── MailerService (MailerModule @Global)           │
└──────────────────────────────────────────────────────────────┘
```

### Principes

- **`ContactModule`** : feature module standard (calque `DiplomasModule`/`ProjectsModule`).
- **`ThrottlerModule` configuré root-level** : guard global `APP_GUARD` permet le décorateur `@Throttle` partout. Default 10/60s permissif, override fin sur `POST /messages` à 5/60s.
- **`ContactService`** consomme 3 dépendances `@Global` (`DRIZZLE`, `MailerService`) + 1 standard (`AppConfigService` exposé par `AppConfigModule`, déjà disponible globalement via `ConfigModule.forRoot({ isGlobal: true })`).
- **Pas d'import explicite de `MailerModule`** : il est `@Global`, son `MailerService` est injectable directement.
- **Templates loadés dynamiquement** par `loadTemplate(absolutePath)` au moment de chaque envoi. Pas de cache (l'admin reload son binaire pour update les templates → c'est OK).
- **`__dirname` stable** : NestJS compile en `dist/`, on a `dist/contact/contact.service.js` qui peut résoudre `dist/contact/mail-templates/...`. Les templates HTML doivent être copiés dans `dist/` au build (cf. `nest-cli.json` `assets` config — à vérifier ou ajouter).

## 5. Arborescence des fichiers

```
src/
├── app.module.ts                         # MODIFIÉ : +ThrottlerModule + ContactModule + APP_GUARD
│
├── config/                               # MODIFIÉ : +3 env vars
│   ├── env.schema.ts                     # +CONTACT_*
│   ├── env.validation.spec.ts            # +tests
│   ├── app-config.service.ts             # +3 getters
│   └── app-config.module.ts              # INCHANGÉ
│
├── common/                               # NEW directory
│   ├── pagination.ts                     # parsePagination + types
│   └── pagination.spec.ts                # ~5 tests
│
├── database/
│   └── schema/
│       ├── index.ts                      # MODIFIÉ : +export contact-messages
│       └── contact-messages.ts           # NEW : table + types
│
└── contact/                              # NEW
    ├── contact.module.ts                 # imports AuthModule, controllers/providers
    ├── contact.controller.ts             # 6 endpoints
    ├── contact.service.ts                # 5 méthodes + helper privé sendNotificationMails
    ├── contact.service.spec.ts           # ~10-15 tests
    ├── dto/
    │   ├── create-contact-message.dto.ts # name/email/subject/message validés
    │   └── list-contact-messages.dto.ts  # page/limit query params
    └── mail-templates/
        ├── contact-notification.html     # port 1:1 Hono (~69 lignes)
        └── contact-confirmation.html     # port 1:1 Hono (~52 lignes)

drizzle/                                  # MODIFIÉ : +0003_*.sql (généré)
nest-cli.json                             # MODIFIÉ (si nécessaire) : +assets pattern *.html
package.json                              # MODIFIÉ : +@nestjs/throttler
README.md                                 # MODIFIÉ : +section Contact
```

## 6. Schéma DB

`src/database/schema/contact-messages.ts` :

```typescript
import {
  pgTable, uuid, text, boolean, timestamp, index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const contactMessages = pgTable(
  'contact_message',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    email: text('email').notNull(),
    subject: text('subject').notNull(),
    message: text('message').notNull(),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    readIdx: index('contact_message_read_idx').on(t.read),
    createdAtIdx: index('contact_message_created_at_idx').on(t.createdAt),
    readCreatedIdx: index('contact_message_read_created_idx').on(t.read, t.createdAt),
  }),
);

export type ContactMessage = typeof contactMessages.$inferSelect;
export type NewContactMessage = typeof contactMessages.$inferInsert;
```

### Adaptations vs Hono

- **`id`** : `uuid` natif Postgres (vs Hono `text` + `crypto.randomUUID()`).
- **Pas de colonne `updatedAt`** : un message est immutable une fois inséré (sauf le `read` flag, mais on n'a pas besoin de tracer quand il a été lu).
- **Naming index** : `contact_message_*_idx` (calque la convention `service_pricing_order_idx`).
- **Timestamps** : `withTimezone: true` (convention NestJS).

## 7. Configuration

### Env vars

3 nouvelles, toutes requises.

| Variable | Type | Rôle |
|---|---|---|
| `CONTACT_EMAIL` | email | Destinataire des notifications admin |
| `CONTACT_PHONE` | string min 1 | Affiché dans `GET /contact/info` |
| `CONTACT_LOCATION` | string min 1 | Affiché dans `GET /contact/info` |

> **`CONTACT_EMAIL` ≠ `SMTP_FROM`** : `CONTACT_EMAIL` est le destinataire des notifications (où l'admin reçoit), `SMTP_FROM` (Mailer subproject) est l'expéditeur (d'où ça part). Souvent identiques en pratique mais conceptuellement distincts.

### `env.schema.ts` ajouts

```typescript
// Contact
CONTACT_EMAIL: z.string().email(),
CONTACT_PHONE: z.string().min(1),
CONTACT_LOCATION: z.string().min(1),
```

### `AppConfigService` ajouts

```typescript
get contactEmail() {
  return this.config.get('CONTACT_EMAIL', { infer: true });
}
get contactPhone() {
  return this.config.get('CONTACT_PHONE', { infer: true });
}
get contactLocation() {
  return this.config.get('CONTACT_LOCATION', { infer: true });
}
```

### `.env.example` ajouts

```bash
# Contact
CONTACT_EMAIL=admin@nedellec-julien.fr
CONTACT_PHONE=+33 6 00 00 00 00
CONTACT_LOCATION=Lyon, France
```

## 8. Helper pagination

`src/common/pagination.ts` (NEW) :

```typescript
export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

export function parsePagination(input: {
  page?: number;
  limit?: number;
}): PaginationParams {
  const page = Math.max(1, input.page ?? DEFAULT_PAGE);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, input.limit ?? DEFAULT_LIMIT),
  );
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}
```

Tests : `src/common/pagination.spec.ts` (~5 tests : defaults, page < 1 capé, limit < 1 capé, limit > 100 capé, offset compute correct).

## 9. DTOs

### `src/contact/dto/create-contact-message.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateContactMessageDto {
  @ApiProperty({ maxLength: 200 })
  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string;

  @ApiProperty({ format: 'email', maxLength: 320 })
  @IsEmail() @MaxLength(320)
  email!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString() @IsNotEmpty() @MaxLength(200)
  subject!: string;

  @ApiProperty({ maxLength: 5000 })
  @IsString() @IsNotEmpty() @MaxLength(5000)
  message!: string;
}
```

### `src/contact/dto/list-contact-messages.dto.ts`

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListContactMessagesDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
```

> `@Type(() => Number)` : query params arrivent en string, `class-transformer` coerce avec ce décorateur. Le `ValidationPipe` global du projet a `enableImplicitConversion: true` donc `@Type` est en théorie redondant — explicit pour la lisibilité et safety.

## 10. Service

`src/contact/contact.service.ts` :

```typescript
import { resolve } from 'node:path';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  contactMessages,
  type ContactMessage,
} from '../database/schema/contact-messages';
import { AppConfigService } from '../config/app-config.service';
import { MailerService } from '../mailer/mailer.service';
import { loadTemplate, renderTemplate } from '../mailer/mailer.utils';
import {
  type PaginatedResult,
  type PaginationParams,
} from '../common/pagination';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  private static readonly TEMPLATES_DIR = resolve(
    __dirname,
    'mail-templates',
  );

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly cfg: AppConfigService,
    private readonly mailer: MailerService,
  ) {}

  async create(dto: CreateContactMessageDto): Promise<ContactMessage> {
    const [row] = await this.db
      .insert(contactMessages)
      .values(dto)
      .returning();

    // Fire-and-forget : la persistence est garantie, les mails sont best-effort.
    // Si SMTP down, le message est en DB et l'admin pourra le voir dans son panel.
    this.sendNotificationMails(row).catch((err) => {
      this.logger.error(
        `Failed to send contact mails for ${row.id}`,
        err instanceof Error ? err.stack : String(err),
      );
    });

    return row;
  }

  async findAll(
    params: PaginationParams,
  ): Promise<PaginatedResult<ContactMessage>> {
    const [data, totalRow] = await Promise.all([
      this.db
        .select()
        .from(contactMessages)
        .orderBy(desc(contactMessages.createdAt))
        .limit(params.limit)
        .offset(params.offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(contactMessages),
    ]);
    return {
      data,
      total: totalRow[0]?.count ?? 0,
      page: params.page,
      limit: params.limit,
    };
  }

  async unreadCount(): Promise<{ count: number }> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(contactMessages)
      .where(eq(contactMessages.read, false));
    return { count: row?.count ?? 0 };
  }

  async markRead(id: string): Promise<ContactMessage> {
    const [row] = await this.db
      .update(contactMessages)
      .set({ read: true })
      .where(eq(contactMessages.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Contact message ${id} not found`);
    return row;
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(contactMessages)
      .where(eq(contactMessages.id, id))
      .returning({ id: contactMessages.id });
    if (rows.length === 0)
      throw new NotFoundException(`Contact message ${id} not found`);
  }

  // Helper privé non-bloquant. Les erreurs sont catch chez l'appelant.
  private async sendNotificationMails(msg: ContactMessage): Promise<void> {
    const adminTpl = loadTemplate(
      resolve(ContactService.TEMPLATES_DIR, 'contact-notification.html'),
    );
    const visitorTpl = loadTemplate(
      resolve(ContactService.TEMPLATES_DIR, 'contact-confirmation.html'),
    );
    const variables = {
      name: msg.name,
      email: msg.email,
      subject: msg.subject,
      message: msg.message,
    };
    await Promise.all([
      this.mailer.sendMail({
        to: this.cfg.contactEmail,
        subject: `Nouveau message de contact: ${msg.subject}`,
        html: renderTemplate(adminTpl, variables),
      }),
      this.mailer.sendMail({
        to: msg.email,
        subject: 'Confirmation de votre message',
        html: renderTemplate(visitorTpl, variables),
      }),
    ]);
  }
}
```

## 11. Controller

`src/contact/contact.controller.ts` :

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppConfigService } from '../config/app-config.service';
import { parsePagination } from '../common/pagination';
import { ContactService } from './contact.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
import { ListContactMessagesDto } from './dto/list-contact-messages.dto';

@ApiTags('Contact')
@Controller('contact')
export class ContactController {
  constructor(
    private readonly contact: ContactService,
    private readonly cfg: AppConfigService,
  ) {}

  @Get('info')
  @ApiOperation({
    summary: 'Get public contact info from env (email, phone, location)',
  })
  getInfo() {
    return {
      email: this.cfg.contactEmail,
      phone: this.cfg.contactPhone,
      location: this.cfg.contactLocation,
    };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit a contact message (public, rate-limited 5/60s par IP)',
  })
  @ApiResponse({ status: 201, description: 'Message saved' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  create(@Body() dto: CreateContactMessageDto) {
    return this.contact.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('messages')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List contact messages (admin, paginated, sorted createdAt DESC)',
  })
  findAll(@Query() query: ListContactMessagesDto) {
    return this.contact.findAll(parsePagination(query));
  }

  @UseGuards(JwtAuthGuard)
  @Get('messages/unread-count')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Count unread messages (admin)' })
  unreadCount() {
    return this.contact.unreadCount();
  }

  @UseGuards(JwtAuthGuard)
  @Patch('messages/:id/read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a message as read (admin)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.contact.markRead(id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('messages/:id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a message (admin)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.contact.remove(id);
  }
}
```

> **Ordre des routes** : `Get('messages/unread-count')` est déclaré AVANT `Patch('messages/:id/read')` pour que NestJS résolve correctement (sinon `:id = 'unread-count'` serait matché). NestJS résout dans l'ordre déclaré.

## 12. Module

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [AuthModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
```

`AuthModule` importé pour le `JwtAuthGuard` (calque autres modules métier). `MailerModule` est `@Global` (Mailer subproject) — pas d'import explicite. Idem `DatabaseModule`.

## 13. AppModule modifié

```typescript
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
// ... existing imports

@Module({
  imports: [
    // ... existing
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    // ... ContactModule à la fin
    ContactModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
```

> **Default global 10/60s par IP** sur **toutes les routes**. C'est permissif — le seul endroit qui doit être plus strict est `POST /contact/messages` qui override à 5/60s via `@Throttle`.
>
> **Effet collatéral** : toutes les routes du backend deviennent throttle-limitées à 10/60s par IP. C'est OK pour les routes admin (l'admin n'envoie pas 11+ requêtes/min en usage normal), et c'est même bénéfique pour `GET /profile` ou `GET /projects` qui pourraient être abusés sinon. Si une route a besoin de plus, on peut `@SkipThrottle()` au cas par cas.

## 14. Templates

Port direct depuis le backend Hono :
- Source : `/home/jned/WebstormProjects/J-Ned/angular-portfolio-app/server/mail-templates/contact-notification.html` (~69 lignes) → `src/contact/mail-templates/contact-notification.html`
- Source : `/home/jned/WebstormProjects/J-Ned/angular-portfolio-app/server/mail-templates/contact-confirmation.html` (~52 lignes) → `src/contact/mail-templates/contact-confirmation.html`

Aucune transformation. Les variables sont déjà en `{{name}}`/`{{email}}`/`{{subject}}`/`{{message}}` compatibles avec notre `renderTemplate`.

### `nest-cli.json` — copie des assets HTML au build

NestJS ne copie par défaut que les fichiers TS compilés. Pour que `loadTemplate(resolve(__dirname, 'mail-templates', 'xxx.html'))` fonctionne en prod (lecture depuis `dist/`), il faut configurer `assets`.

État actuel de `nest-cli.json` :

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

À remplacer par (ajout `assets` + `watchAssets` dans `compilerOptions`) :

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "assets": [
      { "include": "**/mail-templates/**/*.html" }
    ],
    "watchAssets": true
  }
}
```

Le `outDir` est implicite (`dist/`, défaut NestJS). `watchAssets: true` recharge les templates en mode `pnpm dev`.

## 15. Tests

### `src/common/pagination.spec.ts` (~5 tests)

| # | Cas |
|---|---|
| 1 | defaults : `parsePagination({})` → `{ page: 1, limit: 10, offset: 0 }` |
| 2 | `page < 1` capé à 1 : `parsePagination({ page: 0 })` → `page: 1` |
| 3 | `limit < 1` capé à 1 : `parsePagination({ limit: 0 })` → `limit: 1` |
| 4 | `limit > 100` capé : `parsePagination({ limit: 200 })` → `limit: 100` |
| 5 | offset compute : `parsePagination({ page: 3, limit: 20 })` → `offset: 40` |

### `src/contact/contact.service.spec.ts` (13 tests)

Stack : `createMockDb()` (helper partagé) + mock `MailerService` + mock `AppConfigService`.

| # | Bloc | Cas |
|---|---|---|
| 1 | `create` | insert + retourne row + déclenche fire-and-forget `sendNotificationMails` |
| 2 | `create` | retourne IMMÉDIATEMENT après le DB insert (pas d'attente des mails) |
| 3 | `create` | `MailerService.sendMail` appelé 2 fois (admin + visitor) |
| 4 | `create` | mail admin envoyé à `cfg.contactEmail` avec sujet `Nouveau message de contact: <subject>` |
| 5 | `create` | mail visitor envoyé à `dto.email` avec sujet `Confirmation de votre message` |
| 6 | `create` | si `mailer.sendMail` reject → `create` resolve quand même (fire-and-forget), erreur loggée |
| 7 | `findAll` | retourne `{ data, total, page, limit }` paginé |
| 8 | `findAll` | tri `createdAt DESC` (Drizzle `desc`) |
| 9 | `unreadCount` | retourne `{ count: N }` filtré sur `read: false` |
| 10 | `markRead` | met `read: true`, retourne row |
| 11 | `markRead` | throw `NotFoundException` si id absent |
| 12 | `remove` | supprime row sans erreur |
| 13 | `remove` | throw `NotFoundException` si id absent |

> Tests des templates (chargement fichier + rendu) : implicite via les tests `create` (les mocks vérifient que `sendMail` est appelé avec un `html` non-vide). On ne mock PAS `loadTemplate` — les fichiers `mail-templates/*.html` doivent exister avant le test (sinon test fail). On peut mock `loadTemplate` si on préfère isoler purement le service.

### Pas de tests d'intégration mailpit

Validation e2e via Mailpit déjà couverte au sous-projet Mailer (7a). Ici on mock `MailerService` pour rester focused sur la logique Contact.

## 16. Critères de done

1. Schéma + migration `0003` appliquée (`\d contact_message` montre 7 colonnes + 3 indexes).
2. `@nestjs/throttler` installé, `ThrottlerModule` + `APP_GUARD` configurés dans `AppModule`.
3. 3 env vars `CONTACT_*` + 3 getters fonctionnels, validation Zod fail-fast.
4. Helper `parsePagination` partagé dans `src/common/`, testé.
5. 6 endpoints fonctionnels :
   - `GET /contact/info` → 200 avec env values
   - `POST /contact/messages` → 201, mails arrivent dans Mailpit (vérification e2e)
   - `POST /contact/messages` 6e fois en 60s → 429
   - `GET /contact/messages?page=2&limit=5` → 200 paginé
   - `GET /contact/messages/unread-count` → 200 avec count correct
   - `PATCH /contact/messages/:id/read` → 200 / 404
   - `DELETE /contact/messages/:id` → 204 / 404
6. Templates HTML copiés dans `dist/` au build (vérifier via `pnpm build && ls dist/contact/mail-templates/`).
7. ~18 nouveaux tests verts (5 pagination + 13 service), total projet ~192.
8. Build prod OK, lint clean.
9. Vérification e2e manuelle : flow complet `POST /messages` → DB row + 2 mails Mailpit + 429 si > 5/60s.
10. README mis à jour : section "Contact" + sous-projets `8. ✅ Contact`, `9. **Bookings** *(prochain)*`.

## 17. Hors scope (suite)

Une fois Contact terminé :
9. **Bookings** (réservations + slots + 2 templates booking — 2ème consommateur Mailer, valide la généralisation du pattern).
10. **CV** (`POST /cv` + `GET /cv/download` qui consomment `StorageService`).
11. **Analytics** (page views + agrégats).
12. **Frontend Angular adaptation** + **migration des données réelles** depuis le backend Hono.
