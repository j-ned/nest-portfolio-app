# Bookings — Design

| | |
|---|---|
| **Date** | 2026-04-26 |
| **Statut** | En attente de relecture utilisateur |
| **Périmètre** | Sous-projet "Bookings" du chantier de migration Hono → NestJS |
| **Projet cible** | `/home/jned/WebstormProjects/J-Ned/nest-portfolio-app` |
| **Specs précédents** | Fondations, Auth, Profile public, S3 Storage, Projects, Avatar Profile, Mailer (7a), Contact (7b) |
| **Spec suivant prévu** | CV (upload S3 + download) |

---

## 1. Contexte & motivation

Huit sous-projets sont terminés. Le sous-projet **Mailer (7a)** a livré le `MailerModule @Global`, **Contact (7b)** a été le 1er consommateur réel. **Bookings** est le **2ème consommateur**, qui valide la généralisation du pattern `MailerService` + `loadTemplate`/`renderTemplate` + fire-and-forget après DB insert.

Bookings gère le système de prise de rendez-vous public du portfolio : un visiteur soumet une demande de RDV avec date/heure/durée + ses coordonnées, l'admin reçoit une notification, le visiteur une confirmation, et le RDV est persisté en DB. L'admin peut aussi désactiver des dates entières (vacances, indisponibilités) via un sous-modèle `disabled_date`.

**Différence clé vs Contact** : Bookings introduit une **validation de conflit serveur** (date disabled OU slot overlap) — premier endroit du backend où le service renvoie 409 sur une contrainte métier complexe, pas juste sur une violation DB.

## 2. Scope

### Inclus

- **2 tables Drizzle** : `booking` (uuid + 9 cols + 2 indexes) + `disabled_date` (uuid + 2 cols + unique constraint sur date)
- **Migration Drizzle** `0004_*.sql` (autogénérée, pas d'INSERT manuel)
- **`BookingsModule`** : controller + service + 4 DTOs + 2 templates + utils + tests
- **7 endpoints sous `/bookings`** :
  - `POST /bookings` (public, **throttle 3/60s**, validation conflit serveur, 2 mails fire-and-forget) → 201 ou 409
  - `GET /bookings?page&limit` (admin, paginated, sort `createdAt DESC`)
  - `GET /bookings/slots?month=YYYY-MM` (public) → tableau de bookings filtrés sur le mois (frontend calcule la disponibilité)
  - `DELETE /bookings/:id` (admin)
  - `GET /bookings/disabled-dates` (public) → liste complète, ordre `date ASC`
  - `POST /bookings/disabled-dates` (admin) → 201 ou 409 si date déjà désactivée
  - `DELETE /bookings/disabled-dates/:id` (admin)
- **Validation conflit serveur** sur `POST /bookings` :
  - Date dans `disabled_date` → `ConflictException` 409 (`Date X is disabled for bookings`)
  - Chevauchement avec booking existant (même date, intervalle qui chevauche) → `ConflictException` 409 (`Time slot overlaps...`)
- **Helpers `src/bookings/bookings.utils.ts`** :
  - `parseTimeToMinutes(time: 'HH:mm'): number`
  - `toSlot(startTime: string, duration: number): TimeSlot`
  - `slotsOverlap(a: TimeSlot, b: TimeSlot): boolean`
- **Réutilisation** : `parsePagination` (`src/common/`), `isUniqueViolation` (`src/projects/projects.utils.ts`)
- **2 templates HTML** (port 1:1 Hono) : `booking-notification.html` (~86 lignes), `booking-confirmation.html` (~76 lignes)
- **Wiring** : `BookingsModule` dans `AppModule.imports` après `ContactModule`. Schéma dans le barrel.
- **Tests** : ~6 utils + ~14 service = **~20 nouveaux**, total projet ~215.

### Explicitement exclus

- **Pas de validation business hours / future-date côté serveur** : frontend gardien (calque Hono).
- **Pas de calcul d'availability serveur** : `GET /slots` retourne du brut, le frontend calcule les créneaux libres avec sa connaissance des heures de bureau.
- **Pas de `PATCH /:id`** : admin ne modifie pas un RDV, il delete + re-réservation.
- **Pas de notification au visiteur sur DELETE admin** — YAGNI.
- **Pas de soft delete, pas de tags, pas de réponse client direct depuis l'app** — admin répond avec son client mail externe.
- **Pas de rappel email J-1** — YAGNI (cron + scheduler hors scope).
- **Pas de détection de chevauchement multi-jours** — durations < 24h en pratique, complication inutile.
- **Pas de timezone handling explicite** — toutes les dates sont locales (Europe/Paris implicite, calque Hono).
- **Pas de validation de durée maximale** — l'admin peut booker 8h+ si le visiteur l'écrit.
- **Pas de support phone international** — `^\d{10}$` FR-only (calque Hono).
- **Pas d'upgrade `time` Postgres** sur `startTime` — `text 'HH:mm'` parsé en JS (cohérent avec le calcul de chevauchement).

## 3. Décisions clés (résumé)

| Q | Choix | Conséquence |
|---|---|---|
| Q1 — découpage | A : 1 sous-projet groupé (booking + disabled_date) | Cohésion métier forte, pas de fragmentation artificielle |
| Q2 — validation conflit | B : check disabled + check overlap côté serveur | Robuste contre double-booking et frontend bypass, ~30 lignes + 4 tests |
| Q3 — phone | A1 : `^\d{10}$` FR-only | Calque Hono, simple |
| Q3 — date type | B2 : Postgres `date` natif (mode 'string') | Type-safe, comparaisons SQL natives, API TS string identique |
| (lock) — startTime | text `^\d{2}:\d{2}$` | Calque Hono, pas de complication time type |
| (lock) — throttle | 3/60s sur POST | Calque Hono, plus strict que Contact (5/60s) |
| (lock) — `GET /slots` shape | brut `[{ date, startTime, duration }]` | Frontend calcule disponibilité (calque Hono) |
| (lock) — `disabled_date.date` | unique | Calque Hono, évite doublons |
| (lock) — duration | int min 15 minutes, pas de max | Simple, calque Hono |

## 4. Architecture & graphe de modules

```
┌──────────────────────────────────────────────────────────────┐
│ AppModule (existant après Contact 7b)                        │
│                                                              │
│  Imports actuels (extraits) :                                │
│   ├── ConfigModule + AppConfigModule                         │
│   ├── DatabaseModule                  ← @Global              │
│   ├── AuthModule                                             │
│   ├── 7 modules Profile public                               │
│   ├── StorageModule                   ← @Global              │
│   ├── ProjectsModule                                         │
│   ├── MailerModule                    ← @Global              │
│   ├── ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])  │
│   └── ContactModule                                          │
│                                                              │
│  AJOUT de ce sous-projet :                                   │
│   └── BookingsModule                                         │
│         imports: [AuthModule, AppConfigModule]               │
│         controllers: [BookingsController]                    │
│         providers: [BookingsService]                         │
│         BookingsService injecte :                            │
│           ├── DRIZZLE     (DatabaseModule @Global)           │
│           ├── AppConfigService (cfg.contactEmail pour mails) │
│           └── MailerService (MailerModule @Global)           │
└──────────────────────────────────────────────────────────────┘
```

### Principes

- **`BookingsModule`** : feature module standard (calque `ContactModule` exactement).
- **`ContactEmail` réutilisé** : `cfg.contactEmail` est le destinataire des notifications admin pour booking aussi (même destination). Pas de nouvelle env var dédiée Bookings.
- **`AppConfigModule` importé explicitement** : leçon Contact (n'est pas `@Global`).
- **`MailerModule @Global`** consommé sans import.
- **Pattern fire-and-forget** réutilisé tel quel.
- **`@nestjs/throttler`** déjà wiré globalement par Contact subproject — `@Throttle({ default: { limit: 3, ttl: 60_000 } })` override sur `POST /bookings`.

## 5. Arborescence des fichiers

```
src/
├── app.module.ts                         # MODIFIÉ : +BookingsModule
│
├── database/schema/
│   ├── index.ts                          # MODIFIÉ : +export bookings
│   └── bookings.ts                       # NEW : 2 tables (booking + disabled_date)
│
└── bookings/                             # NEW
    ├── bookings.module.ts
    ├── bookings.controller.ts            # 7 endpoints
    ├── bookings.service.ts               # 7 méthodes publiques + sendNotificationMails
    ├── bookings.service.spec.ts          # ~14 tests
    ├── bookings.utils.ts                 # parseTimeToMinutes, toSlot, slotsOverlap
    ├── bookings.utils.spec.ts            # ~6 tests
    ├── dto/
    │   ├── create-booking.dto.ts
    │   ├── list-bookings.dto.ts          # = ListContactMessagesDto (page/limit), copie locale
    │   ├── list-slots.dto.ts             # month: YYYY-MM
    │   └── create-disabled-date.dto.ts
    └── mail-templates/
        ├── booking-notification.html     # port 1:1 Hono (~86 lignes)
        └── booking-confirmation.html     # port 1:1 Hono (~76 lignes)

drizzle/                                  # MODIFIÉ : +0004_*.sql (généré)
README.md                                 # MODIFIÉ : +section Bookings
```

## 6. Schéma DB

`src/database/schema/bookings.ts` :

```typescript
import {
  pgTable,
  uuid,
  text,
  integer,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const bookings = pgTable(
  'booking',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    date: date('date', { mode: 'string' }).notNull(),
    startTime: text('start_time').notNull(),
    duration: integer('duration').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    subject: text('subject').notNull(),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dateIdx: index('booking_date_idx').on(t.date),
    createdAtIdx: index('booking_created_at_idx').on(t.createdAt),
  }),
);

export const disabledDates = pgTable('disabled_date', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  date: date('date', { mode: 'string' }).notNull().unique(),
  reason: text('reason'),
});

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type DisabledDate = typeof disabledDates.$inferSelect;
export type NewDisabledDate = typeof disabledDates.$inferInsert;
```

### Adaptations vs Hono

- `id` : `uuid` natif (vs `text` + `crypto.randomUUID()`)
- `date` : Postgres `date` avec `mode: 'string'` côté Drizzle (TS API reste `string`, mais validation/comparaison DB-level)
- `createdAt` : `withTimezone: true`
- Naming index : `booking_*_idx` (calque codebase)
- TS export `bookings`/`disabledDates` (pluriel), tables SQL `booking`/`disabled_date` (singulier — calque Hono)

### Notes structurelles

- **`startTime` reste `text`** : on le parse en JS (`parseTimeToMinutes`) pour le calcul de chevauchement. Postgres `time` apporterait peu pour notre usage et compliquerait les comparaisons.
- **Pas de FK booking → disabled_date** : la validation conflit est applicative, pas DB. La date du booking est juste vérifiée à l'insertion ; si l'admin désactive une date après-coup, les bookings existants ne sont PAS supprimés (à l'admin de gérer).

## 7. DTOs

### `src/bookings/dto/create-booking.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ format: 'date', example: '2026-04-26' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ example: '14:30' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time must be HH:mm' })
  startTime!: string;

  @ApiProperty({ example: 60, minimum: 15 })
  @IsInt()
  @Min(15)
  duration!: number;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ format: 'email', maxLength: 320 })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: '0612345678' })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Phone must be 10 digits (FR)' })
  phone!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message!: string;
}
```

### `src/bookings/dto/list-bookings.dto.ts`

Identique à `ListContactMessagesDto` (page/limit avec `@Type(() => Number)`). Copie locale plutôt que partage cross-module — si un 3ème consumer apparaît, on hoisera dans `src/common/`.

### `src/bookings/dto/list-slots.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class ListSlotsDto {
  @ApiProperty({ example: '2026-04', description: 'Month in YYYY-MM format' })
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'Month must be YYYY-MM' })
  month!: string;
}
```

### `src/bookings/dto/create-disabled-date.dto.ts`

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateDisabledDateDto {
  @ApiProperty({ format: 'date', example: '2026-12-25' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be YYYY-MM-DD' })
  date!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
```

## 8. Utils

`src/bookings/bookings.utils.ts` :

```typescript
export interface TimeSlot {
  startMin: number;
  endMin: number;
}

export function parseTimeToMinutes(time: string): number {
  const [hh, mm] = time.split(':').map(Number);
  return hh * 60 + mm;
}

export function toSlot(startTime: string, duration: number): TimeSlot {
  const startMin = parseTimeToMinutes(startTime);
  return { startMin, endMin: startMin + duration };
}

/**
 * Two time slots overlap iff: a.startMin < b.endMin && b.startMin < a.endMin.
 * Adjacent slots (a.endMin === b.startMin) do NOT overlap.
 */
export function slotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}
```

### Tests `bookings.utils.spec.ts` (~6 tests)

| # | Cas |
|---|---|
| 1 | `parseTimeToMinutes('00:00')` = 0 |
| 2 | `parseTimeToMinutes('14:30')` = 870 |
| 3 | `parseTimeToMinutes('23:59')` = 1439 |
| 4 | `slotsOverlap` chevauchement partiel → `true` |
| 5 | `slotsOverlap` adjacent (`a.endMin === b.startMin`) → `false` |
| 6 | `slotsOverlap` complètement disjoints → `false` |

## 9. Service

```typescript
import { resolve } from 'node:path';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  bookings,
  disabledDates,
  type Booking,
  type DisabledDate,
} from '../database/schema/bookings';
import { AppConfigService } from '../config/app-config.service';
import { MailerService } from '../mailer/mailer.service';
import { loadTemplate, renderTemplate } from '../mailer/mailer.utils';
import { isUniqueViolation } from '../projects/projects.utils';
import {
  type PaginatedResult,
  type PaginationParams,
} from '../common/pagination';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateDisabledDateDto } from './dto/create-disabled-date.dto';
import { slotsOverlap, toSlot } from './bookings.utils';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);
  private static readonly TEMPLATES_DIR = resolve(
    __dirname,
    'mail-templates',
  );

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly cfg: AppConfigService,
    private readonly mailer: MailerService,
  ) {}

  async create(dto: CreateBookingDto): Promise<Booking> {
    // 1. Date is disabled?
    const disabled = await this.db
      .select({ id: disabledDates.id })
      .from(disabledDates)
      .where(eq(disabledDates.date, dto.date))
      .limit(1);
    if (disabled.length > 0) {
      throw new ConflictException(
        `Date ${dto.date} is disabled for bookings`,
      );
    }

    // 2. Slot overlap with existing booking on same date?
    const sameDay = await this.db
      .select({
        startTime: bookings.startTime,
        duration: bookings.duration,
      })
      .from(bookings)
      .where(eq(bookings.date, dto.date));
    const newSlot = toSlot(dto.startTime, dto.duration);
    for (const existing of sameDay) {
      if (slotsOverlap(newSlot, toSlot(existing.startTime, existing.duration))) {
        throw new ConflictException(
          `Time slot overlaps with an existing booking on ${dto.date}`,
        );
      }
    }

    // 3. Insert + fire-and-forget mails
    const [row] = await this.db.insert(bookings).values(dto).returning();
    this.sendNotificationMails(row).catch((err: unknown) => {
      this.logger.error(
        `Failed to send booking mails for ${row.id}`,
        err instanceof Error ? err.stack : String(err),
      );
    });
    return row;
  }

  async findAll(
    params: PaginationParams,
  ): Promise<PaginatedResult<Booking>> {
    const [totalRow, data] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(bookings),
      this.db
        .select()
        .from(bookings)
        .orderBy(desc(bookings.createdAt))
        .limit(params.limit)
        .offset(params.offset),
    ]);
    return {
      data,
      total: totalRow[0]?.count ?? 0,
      page: params.page,
      limit: params.limit,
    };
  }

  findSlotsByMonth(
    month: string,
  ): Promise<Pick<Booking, 'date' | 'startTime' | 'duration'>[]> {
    const startDate = `${month}-01`;
    const [year, monthNum] = month.split('-').map(Number);
    const nextMonth =
      monthNum === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(monthNum + 1).padStart(2, '0')}-01`;
    return this.db
      .select({
        date: bookings.date,
        startTime: bookings.startTime,
        duration: bookings.duration,
      })
      .from(bookings)
      .where(
        and(gte(bookings.date, startDate), lt(bookings.date, nextMonth)),
      );
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(bookings)
      .where(eq(bookings.id, id))
      .returning({ id: bookings.id });
    if (rows.length === 0)
      throw new NotFoundException(`Booking ${id} not found`);
  }

  // Disabled dates ----------------------------------------------------------

  findAllDisabledDates(): Promise<DisabledDate[]> {
    return this.db
      .select()
      .from(disabledDates)
      .orderBy(asc(disabledDates.date));
  }

  async createDisabledDate(
    dto: CreateDisabledDateDto,
  ): Promise<DisabledDate> {
    try {
      const [row] = await this.db
        .insert(disabledDates)
        .values(dto)
        .returning();
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'date')) {
        throw new ConflictException(`Date ${dto.date} already disabled`);
      }
      throw err;
    }
  }

  async removeDisabledDate(id: string): Promise<void> {
    const rows = await this.db
      .delete(disabledDates)
      .where(eq(disabledDates.id, id))
      .returning({ id: disabledDates.id });
    if (rows.length === 0)
      throw new NotFoundException(`Disabled date ${id} not found`);
  }

  // Helper privé non-bloquant
  private async sendNotificationMails(booking: Booking): Promise<void> {
    const adminTpl = loadTemplate(
      resolve(BookingsService.TEMPLATES_DIR, 'booking-notification.html'),
    );
    const visitorTpl = loadTemplate(
      resolve(BookingsService.TEMPLATES_DIR, 'booking-confirmation.html'),
    );
    const variables = {
      name: booking.name,
      email: booking.email,
      phone: booking.phone,
      date: booking.date,
      startTime: booking.startTime,
      duration: String(booking.duration),
      subject: booking.subject,
      message: booking.message,
    };
    await Promise.all([
      this.mailer.sendMail({
        to: this.cfg.contactEmail,
        subject: `Nouvelle demande de rendez-vous: ${booking.subject}`,
        html: renderTemplate(adminTpl, variables),
      }),
      this.mailer.sendMail({
        to: booking.email,
        subject: 'Confirmation de votre demande de rendez-vous',
        html: renderTemplate(visitorTpl, variables),
      }),
    ]);
  }
}
```

> **Note variables templates** : les templates Hono utilisent un sous-ensemble des 8 variables passées (notification : 7, confirmation : 4). `renderTemplate` ignore silencieusement les variables non utilisées dans le HTML — pas un problème.

## 10. Controller

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
import { parsePagination } from '../common/pagination';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateDisabledDateDto } from './dto/create-disabled-date.dto';
import { ListBookingsDto } from './dto/list-bookings.dto';
import { ListSlotsDto } from './dto/list-slots.dto';

@ApiTags('Bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a booking (public, rate-limited 3/60s par IP, conflict-checked)',
  })
  @ApiResponse({ status: 201, description: 'Booking created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Date disabled or slot overlaps' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  create(@Body() dto: CreateBookingDto) {
    return this.bookings.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List bookings (admin, paginated, sorted createdAt DESC)',
  })
  findAll(@Query() query: ListBookingsDto) {
    return this.bookings.findAll(parsePagination(query));
  }

  @Get('slots')
  @ApiOperation({
    summary:
      'List bookings of a month (public, frontend computes availability)',
  })
  findSlots(@Query() query: ListSlotsDto) {
    return this.bookings.findSlotsByMonth(query.month);
  }

  @Get('disabled-dates')
  @ApiOperation({
    summary: 'List disabled dates (public, ordered date ASC)',
  })
  findDisabledDates() {
    return this.bookings.findAllDisabledDates();
  }

  @UseGuards(JwtAuthGuard)
  @Post('disabled-dates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable a date (admin)' })
  @ApiResponse({ status: 201, description: 'Date disabled' })
  @ApiResponse({ status: 409, description: 'Date already disabled' })
  createDisabledDate(@Body() dto: CreateDisabledDateDto) {
    return this.bookings.createDisabledDate(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('disabled-dates/:id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Re-enable (delete) a disabled date (admin)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  removeDisabledDate(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.removeDisabledDate(id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a booking (admin)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.remove(id);
  }
}
```

> **Ordre des routes critique** :
> - `Get('slots')` AVANT `Get(':id')` — sinon `:id = 'slots'` matche
> - `Get('disabled-dates')` / `Post('disabled-dates')` / `Delete('disabled-dates/:id')` AVANT `Delete(':id')` — pour la même raison
> - **Pas de `Get(':id')`** dans ce module : on n'a que `findAll` paginé, pas de get-by-id (admin lit toute la liste)

## 11. Module

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AppConfigModule } from '../config/app-config.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [AuthModule, AppConfigModule],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
```

`AppConfigModule` importé explicitement (calque Contact, leçon apprise).

## 12. Templates

Port direct depuis Hono :
- `src/bookings/mail-templates/booking-notification.html` (~86 lignes Hono)
- `src/bookings/mail-templates/booking-confirmation.html` (~76 lignes Hono)

**Variables vérifiées** :
- `booking-notification.html` : `{{date}}`, `{{duration}}`, `{{email}}`, `{{message}}`, `{{name}}`, `{{phone}}`, `{{subject}}` (7 variables, **pas `startTime`** dans le HTML — le service passe la var quand même, ignorée silencieusement)
- `booking-confirmation.html` : `{{date}}`, `{{duration}}`, `{{name}}`, `{{subject}}` (4 variables, idem)

`nest-cli.json` : asset glob `**/mail-templates/**/*.html` couvre déjà ce nouveau dossier (config existante depuis Contact subproject).

## 13. Tests

| # | Bloc | Cas |
|---|---|---|
| **utils** | | |
| 1 | `parseTimeToMinutes` | `'00:00'` → 0 |
| 2 | `parseTimeToMinutes` | `'14:30'` → 870 |
| 3 | `parseTimeToMinutes` | `'23:59'` → 1439 |
| 4 | `slotsOverlap` | chevauchement partiel → true |
| 5 | `slotsOverlap` | adjacent (endA == startB) → false |
| 6 | `slotsOverlap` | disjoints → false |
| **service** | | |
| 7 | `create` | succès → DB insert + fire-and-forget mails |
| 8 | `create` | date désactivée → ConflictException, pas d'insert |
| 9 | `create` | slot chevauche → ConflictException, pas d'insert |
| 10 | `create` | slot adjacent → succès |
| 11 | `create` | mailer reject → resolve quand même |
| 12 | `findAll` | retourne `{ data, total, page, limit }` |
| 13 | `findSlotsByMonth` | filtre du mois (gte + lt) |
| 14 | `findSlotsByMonth` | bordure année (décembre → janvier) |
| 15 | `remove` | succès |
| 16 | `remove` | 404 si absent |
| 17 | `findAllDisabledDates` | retourne tableau ordonné |
| 18 | `createDisabledDate` | succès avec/sans reason |
| 19 | `createDisabledDate` | doublon (unique violation) → ConflictException |
| 20 | `removeDisabledDate` | succès / 404 |

Total **~20 tests** (6 utils + 14 service). Total projet ~215.

### Pas de tests d'intégration Mailpit

Pattern bien établi (Mailer/Contact validation e2e déjà couverte). Ici, on mock `MailerService` dans les tests unitaires.

## 14. Critères de done

1. Schéma + migration `0004` appliquée (`\d booking` montre 10 colonnes + 2 indexes ; `\d disabled_date` montre 3 colonnes + unique constraint).
2. 7 endpoints fonctionnels (e2e validé manuellement).
3. Throttle `POST /bookings` à 3/60s, retourne 429 au-delà.
4. Validation conflit serveur :
   - `POST /bookings` rejette 409 si date dans `disabled_date`
   - `POST /bookings` rejette 409 si slot chevauche un booking existant (même date)
5. 2 mails (notif admin + confirm visiteur) reçus dans Mailpit après POST réussi.
6. Templates copiés dans `dist/src/bookings/mail-templates/` au build (asset config existant).
7. `GET /bookings/disabled-dates` accessible sans auth.
8. `POST /bookings/disabled-dates` rejette 409 si date déjà désactivée.
9. ~20 nouveaux tests verts, total ~215.
10. Build prod + lint clean.
11. Vérification e2e manuelle (POST + 2 mails Mailpit, conflit 409, throttle 429, admin endpoints).
12. README mis à jour : section "Bookings" + sous-projets `9. ✅ Bookings`, `10. **CV** *(prochain)*`.

## 15. Hors scope (suite)

10. **CV** (`POST /cv` admin upload + `GET /cv/download` public — 3ème consommateur de S3 Storage).
11. **Analytics** (page views + agrégats).
12. **Frontend Angular adaptation** + **migration des données réelles** depuis le backend Hono.
