# Analytics — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter le sous-projet "Analytics" (3 tables + 8 endpoints + cron rollup nocturne + bot filter + UA parsing + géoloc IP) selon `2026-04-26-analytics-design.md`. ~25 nouveaux tests, total projet ~260. Dernier sous-projet de la migration Hono → NestJS.

**Architecture:** Module `AnalyticsModule` standard, décomposé en 4 fichiers à responsabilité unique : controller (8 endpoints), `AnalyticsTrackerService` (write-path public), `AnalyticsStatsService` (7 read-paths admin), `AnalyticsAggregatorService` (cron quotidien UTC + purge 30j). Trois services indépendants, communicent uniquement via la DB. ScheduleModule.forRoot() ajouté à `AppModule`. `app.set('trust proxy', 1)` ajouté à `main.ts`.

**Tech Stack:** NestJS 11, Drizzle ORM, `@nestjs/schedule` (nouveau), `geoip-lite` + `ua-parser-js` + `isbot` (nouveaux), `date-fns` (déjà installé), `class-validator`, Jest + `createMockDb()` partagé.

**Référence spec :** `docs/superpowers/specs/2026-04-26-analytics-design.md`

---

## File Structure

### Fichiers à créer

| Chemin | Rôle |
|---|---|
| `src/database/schema/analytics.ts` | 3 tables Drizzle + types `PageView`/`AnalyticsEvent`/`DailyStat` |
| `src/analytics/analytics.module.ts` | imports `[AuthModule]`, providers + controller |
| `src/analytics/analytics.controller.ts` | 8 endpoints (1 public POST + 7 admin GET) |
| `src/analytics/analytics-tracker.service.ts` | `track(dto, ip, ua)` — write-path |
| `src/analytics/analytics-stats.service.ts` | 7 méthodes lecture |
| `src/analytics/analytics-aggregator.service.ts` | `@Cron('0 0 * * *', { timeZone: 'UTC' })` |
| `src/analytics/analytics-tracker.service.spec.ts` | ~10 tests |
| `src/analytics/analytics-stats.service.spec.ts` | ~10 tests |
| `src/analytics/analytics-aggregator.service.spec.ts` | ~5 tests |
| `src/analytics/dto/track-event.dto.ts` | `TrackEventDto` + const `ANALYTICS_EVENT_TYPES` |
| `src/analytics/dto/date-range-query.dto.ts` | `DateRangeQueryDto` + `MetricsQueryDto extends ...` |
| `scripts/run-analytics-aggregator.ts` | Standalone script pour test e2e du cron |

### Fichiers à modifier

| Chemin | Modification |
|---|---|
| `src/database/schema/index.ts` | +export `analytics` (3 endroits : import, export, schema spread) |
| `src/app.module.ts` | +import `ScheduleModule.forRoot()` + `AnalyticsModule` |
| `src/main.ts` | +`app.set('trust proxy', 1)` |
| `package.json` | +deps `@nestjs/schedule`, `geoip-lite`, `ua-parser-js`, `isbot` + types |
| `drizzle/` | +`0006_*.sql` (généré) |
| `README.md` | +section `## Analytics` + liste sous-projets renumérotée (item 11 ✅, **migration 100% terminée**) |

### Nouvelles dépendances npm

- `@nestjs/schedule` (^4.x ou compatible avec NestJS 11)
- `geoip-lite` + `@types/geoip-lite`
- `ua-parser-js` + `@types/ua-parser-js`
- `isbot` (lib TS native, pas de @types nécessaire)

---

## Task 1: Schéma DB + barrel + migration 0006

**Files:**
- Create: `src/database/schema/analytics.ts`
- Modify: `src/database/schema/index.ts`
- Generated: `drizzle/0006_*.sql`

- [ ] **Step 1: Créer le fichier schéma**

Créer `src/database/schema/analytics.ts` :

```typescript
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const pageView = pgTable(
  'page_view',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionHash: text('session_hash').notNull(),
    url: text('url').notNull(),
    referrer: text('referrer'),
    browser: text('browser'),
    os: text('os'),
    country: text('country'),
    duration: integer('duration'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionHashIdx: index('page_view_session_hash_idx').on(t.sessionHash),
    createdAtIdx: index('page_view_created_at_idx').on(t.createdAt),
    urlIdx: index('page_view_url_idx').on(t.url),
  }),
);

export type PageView = typeof pageView.$inferSelect;
export type NewPageView = typeof pageView.$inferInsert;

export const analyticsEvent = pgTable(
  'analytics_event',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionHash: text('session_hash').notNull(),
    eventType: text('event_type').notNull(),
    entityId: text('entity_id'),
    entityTitle: text('entity_title'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionHashIdx: index('analytics_event_session_hash_idx').on(t.sessionHash),
    eventTypeCreatedIdx: index('analytics_event_type_created_idx').on(
      t.eventType,
      t.createdAt,
    ),
    entityIdx: index('analytics_event_entity_idx').on(t.eventType, t.entityId),
  }),
);

export type AnalyticsEvent = typeof analyticsEvent.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvent.$inferInsert;

export const dailyStat = pgTable(
  'daily_stat',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    date: date('date', { mode: 'string' }).notNull().unique(),
    visitors: integer('visitors').notNull().default(0),
    pageviews: integer('pageviews').notNull().default(0),
    sessions: integer('sessions').notNull().default(0),
    bounces: integer('bounces').notNull().default(0),
    totalDuration: integer('total_duration').notNull().default(0),
    projectClicks: integer('project_clicks').notNull().default(0),
    articleViews: integer('article_views').notNull().default(0),
    cvDownloads: integer('cv_downloads').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dateIdx: index('daily_stat_date_idx').on(t.date),
  }),
);

export type DailyStat = typeof dailyStat.$inferSelect;
export type NewDailyStat = typeof dailyStat.$inferInsert;
```

- [ ] **Step 2: Étendre le barrel `src/database/schema/index.ts`**

Lire d'abord. État actuel : 12 modules avec `cv-files` en dernier. Ajouter `analytics` en 13e à 3 endroits.

1. Après `import * as cvFiles from './cv-files';` :
```typescript
import * as analytics from './analytics';
```

2. Après `export * from './cv-files';` :
```typescript
export * from './analytics';
```

3. Après `...cvFiles,` dans le spread `schema` :
```typescript
  ...analytics,
```

- [ ] **Step 3: Vérifier le build**

```bash
pnpm build
```

Expected: clean.

- [ ] **Step 4: Démarrer Postgres**

```bash
pnpm db:up && pnpm db:wait
```

Expected: container `portfolio-nest-db` healthy.

- [ ] **Step 5: Générer la migration**

```bash
pnpm db:generate
```

Expected:
- Drizzle Kit détecte 3 nouvelles tables (`page_view`, `analytics_event`, `daily_stat`).
- Crée `drizzle/0006_<random>.sql`.

- [ ] **Step 6: Inspecter la migration**

Lire `drizzle/0006_*.sql`. Vérifier :
- ✅ `CREATE TABLE "page_view"` (9 colonnes : id, session_hash, url, referrer, browser, os, country, duration, created_at)
- ✅ `CREATE TABLE "analytics_event"` (7 colonnes : id, session_hash, event_type, entity_id, entity_title, metadata, created_at)
- ✅ `CREATE TABLE "daily_stat"` (12 colonnes : id, date, visitors, pageviews, sessions, bounces, total_duration, project_clicks, article_views, cv_downloads, created_at, updated_at)
- ✅ 7 indexes : 3 sur `page_view`, 3 sur `analytics_event`, 1 sur `daily_stat`
- ✅ `UNIQUE` constraint sur `daily_stat.date`
- ✅ Defaults : `gen_random_uuid()`, `now()`, `0` (sur les integer counters de daily_stat)
- ✅ Pas de DROP statements
- ✅ Pas d'INSERT statements

- [ ] **Step 7: Appliquer la migration**

```bash
pnpm db:migrate
```

Expected: clean.

- [ ] **Step 8: Vérifier les tables en DB**

```bash
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c "\d page_view"
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c "\d analytics_event"
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c "\d daily_stat"
```

Expected: 3 tables avec colonnes/indexes/contraintes attendus.

- [ ] **Step 9: Commit**

```bash
git add src/database/schema/analytics.ts src/database/schema/index.ts drizzle/
git commit -m "feat(analytics): schéma Drizzle + migration 0006 (3 tables : page_view, analytics_event, daily_stat)"
```

---

## Task 2: Installer les deps + créer les DTOs

**Files:**
- Modify: `package.json` (via pnpm add)
- Create: `src/analytics/dto/track-event.dto.ts`
- Create: `src/analytics/dto/date-range-query.dto.ts`

- [ ] **Step 1: Installer les dépendances**

```bash
pnpm add @nestjs/schedule geoip-lite ua-parser-js isbot
pnpm add -D @types/geoip-lite @types/ua-parser-js
```

Expected: ajouts dans `package.json` + `pnpm-lock.yaml`. Notes :
- `geoip-lite` télécharge sa DB MaxMind à l'install (~22MB)
- `isbot` n'a pas de package `@types/*` séparé (il fournit ses propres types)
- `ua-parser-js` v2+ exporte `UAParser` en named export

- [ ] **Step 2: Vérifier l'install**

```bash
pnpm list @nestjs/schedule geoip-lite ua-parser-js isbot
ls -lh node_modules/geoip-lite/data/ | head
```

Expected:
- 4 packages présents avec versions
- `node_modules/geoip-lite/data/` contient des fichiers `.dat` (~20MB cumulés)

- [ ] **Step 3: Créer `src/analytics/dto/track-event.dto.ts`**

```typescript
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const ANALYTICS_EVENT_TYPES = [
  'project_click',
  'article_view',
  'cv_download',
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export class TrackEventDto {
  @ApiProperty({
    description: 'Path uniquement (ex: /projects/foo)',
    maxLength: 2048,
  })
  @IsString()
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  referrer?: string;

  @ApiPropertyOptional({ description: 'Durée en secondes (0-86400)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  duration?: number;

  @ApiPropertyOptional({ enum: ANALYTICS_EVENT_TYPES })
  @IsOptional()
  @IsIn([...ANALYTICS_EVENT_TYPES])
  eventType?: AnalyticsEventType;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  entityId?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  entityTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
```

- [ ] **Step 4: Créer `src/analytics/dto/date-range-query.dto.ts`**

```typescript
import { IsDateString, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export const METRIC_TYPES = [
  'url',
  'referrer',
  'browser',
  'country',
  'os',
] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

export class DateRangeQueryDto {
  @ApiPropertyOptional({
    format: 'date',
    description: 'Default = il y a 30 jours (UTC)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    format: 'date',
    description: "Default = aujourd'hui (UTC)",
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class MetricsQueryDto extends DateRangeQueryDto {
  @ApiProperty({ enum: METRIC_TYPES })
  @IsIn([...METRIC_TYPES])
  type!: MetricType;
}
```

- [ ] **Step 5: Vérifier le build**

```bash
pnpm build
```

Expected: clean. Aucun import error.

- [ ] **Step 6: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/analytics/dto/
git commit -m "feat(analytics): DTOs (TrackEvent, DateRangeQuery, MetricsQuery) + deps (@nestjs/schedule, geoip-lite, ua-parser-js, isbot)"
```

---

## Task 3: AnalyticsTrackerService + tests TDD

**Files:**
- Create: `src/analytics/analytics-tracker.service.ts`
- Create: `src/analytics/analytics-tracker.service.spec.ts`

- [ ] **Step 1: Écrire les tests d'abord (TDD)**

Créer `src/analytics/analytics-tracker.service.spec.ts` :

```typescript
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsTrackerService } from './analytics-tracker.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import * as isbotModule from 'isbot';
import * as geoipModule from 'geoip-lite';

jest.mock('isbot');
jest.mock('geoip-lite');

describe('AnalyticsTrackerService', () => {
  let service: AnalyticsTrackerService;
  let db: ReturnType<typeof createMockDb>;
  const isbotMock = isbotModule.isbot as unknown as jest.Mock;
  const geoipLookup = geoipModule.lookup as unknown as jest.Mock;

  const NORMAL_UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  beforeEach(async () => {
    db = createMockDb();
    isbotMock.mockReturnValue(false);
    geoipLookup.mockReturnValue({ country: 'FR' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsTrackerService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(AnalyticsTrackerService);

    // Date fixe pour tester le hash
    jest.useFakeTimers().setSystemTime(new Date('2026-04-26T10:30:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('bot filter', () => {
    it('skip silencieusement si UA est un bot', async () => {
      isbotMock.mockReturnValue(true);
      await service.track(
        { url: '/' },
        '1.2.3.4',
        'Googlebot/2.1 (+http://www.google.com/bot.html)',
      );
      // Aucun appel DB
      expect(db.select).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe('page-view', () => {
    it('INSERT page_view si rien d\'existant pour (session, url, jour)', async () => {
      db.limit.mockResolvedValueOnce([]); // pas de row existante
      db.returning.mockResolvedValueOnce([{ id: 'new-pv' }]);

      await service.track({ url: '/projects' }, '1.2.3.4', NORMAL_UA);

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/projects',
          country: 'FR',
        }),
      );
    });

    it('UPDATE duration si row existante (cumul)', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'existing-pv', duration: 10 },
      ]);
      db.returning.mockResolvedValueOnce([{ id: 'existing-pv' }]);

      await service.track(
        { url: '/projects', duration: 5 },
        '1.2.3.4',
        NORMAL_UA,
      );

      expect(db.update).toHaveBeenCalledTimes(1);
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ duration: 15 }), // 10 + 5
      );
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('URL différente → 2e INSERT (pas UPDATE)', async () => {
      db.limit.mockResolvedValueOnce([]); // pas de match pour /home
      db.returning.mockResolvedValueOnce([{ id: 'pv' }]);

      await service.track({ url: '/home' }, '1.2.3.4', NORMAL_UA);

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('custom event', () => {
    it("eventType='project_click' → INSERT analytics_event, pas page_view", async () => {
      db.returning.mockResolvedValueOnce([{ id: 'ev' }]);

      await service.track(
        {
          url: '/projects/foo',
          eventType: 'project_click',
          entityId: 'foo-id',
          entityTitle: 'Foo Project',
          metadata: { source: 'card' },
        },
        '1.2.3.4',
        NORMAL_UA,
      );

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'project_click',
          entityId: 'foo-id',
          entityTitle: 'Foo Project',
          metadata: { source: 'card' },
        }),
      );
      // Pas de SELECT (page-view branch only)
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('UA parsing fallback', () => {
    it('UA inconnu → browser/os null', async () => {
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([{ id: 'pv' }]);

      await service.track({ url: '/' }, '1.2.3.4', 'totally-unknown-ua');

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          browser: null,
          os: null,
        }),
      );
    });
  });

  describe('géoloc fallback', () => {
    it('IP locale → country null (pas crash)', async () => {
      geoipLookup.mockReturnValue(null);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([{ id: 'pv' }]);

      await service.track({ url: '/' }, '127.0.0.1', NORMAL_UA);

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ country: null }),
      );
    });
  });

  describe('session hash', () => {
    it('même IP+UA+jour → même hash sur 2 calls', async () => {
      db.limit.mockResolvedValue([]);
      db.returning.mockResolvedValue([{ id: 'x' }]);

      await service.track({ url: '/a' }, '1.2.3.4', NORMAL_UA);
      const firstCall = db.values.mock.calls[0][0] as { sessionHash: string };

      await service.track({ url: '/b' }, '1.2.3.4', NORMAL_UA);
      const secondCall = db.values.mock.calls[1][0] as { sessionHash: string };

      expect(firstCall.sessionHash).toBe(secondCall.sessionHash);
      expect(firstCall.sessionHash).toHaveLength(64); // SHA256 hex = 64 chars
    });

    it('même IP+UA mais 2 jours différents → hash différent', async () => {
      db.limit.mockResolvedValue([]);
      db.returning.mockResolvedValue([{ id: 'x' }]);

      await service.track({ url: '/a' }, '1.2.3.4', NORMAL_UA);
      const day1Hash = (db.values.mock.calls[0][0] as { sessionHash: string })
        .sessionHash;

      jest.setSystemTime(new Date('2026-04-27T10:30:00Z')); // J+1
      await service.track({ url: '/a' }, '1.2.3.4', NORMAL_UA);
      const day2Hash = (db.values.mock.calls[1][0] as { sessionHash: string })
        .sessionHash;

      expect(day1Hash).not.toBe(day2Hash);
    });
  });

  describe('error swallowing', () => {
    it('erreur DB pendant INSERT → ne propage pas (track ne throw jamais)', async () => {
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockRejectedValueOnce(new Error('DB down'));

      // Ne doit PAS rejeter
      await expect(
        service.track({ url: '/' }, '1.2.3.4', NORMAL_UA),
      ).resolves.toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

```bash
pnpm test src/analytics/analytics-tracker.service.spec.ts
```

Expected: erreur `Cannot find module './analytics-tracker.service'`. Normal — service inexistant.

- [ ] **Step 3: Créer le service**

Créer `src/analytics/analytics-tracker.service.ts` :

```typescript
import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte } from 'drizzle-orm';
import { format, startOfDay } from 'date-fns';
import { isbot } from 'isbot';
import geoip from 'geoip-lite';
import { UAParser } from 'ua-parser-js';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  pageView,
  analyticsEvent,
} from '../database/schema/analytics';
import { TrackEventDto } from './dto/track-event.dto';

@Injectable()
export class AnalyticsTrackerService {
  private readonly logger = new Logger(AnalyticsTrackerService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Track une page-view ou un custom event. Ne throw JAMAIS — toute erreur
   * interne est loggée et avalée pour ne pas bloquer le client.
   */
  async track(
    dto: TrackEventDto,
    ip: string,
    ua: string,
  ): Promise<void> {
    try {
      // 1. Bot filter
      if (isbot(ua)) {
        return;
      }

      // 2. Session hash déterministe par jour (UTC)
      const day = format(new Date(), 'yyyy-MM-dd');
      const sessionHash = createHash('sha256')
        .update(`${ip}|${ua}|${day}`)
        .digest('hex');

      // 3. UA parsing
      const parsed = new UAParser(ua).getResult();
      const browser =
        parsed.browser.name && parsed.browser.version
          ? `${parsed.browser.name} ${parsed.browser.version}`
          : null;
      const os =
        parsed.os.name && parsed.os.version
          ? `${parsed.os.name} ${parsed.os.version}`
          : null;

      // 4. Géoloc IP
      const country = geoip.lookup(ip)?.country ?? null;

      // 5. Branch : page-view vs custom event
      if (dto.eventType) {
        await this.insertCustomEvent(dto, sessionHash);
      } else {
        await this.upsertPageView(dto, sessionHash, browser, os, country);
      }
    } catch (err) {
      this.logger.error(
        `track failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private async upsertPageView(
    dto: TrackEventDto,
    sessionHash: string,
    browser: string | null,
    os: string | null,
    country: string | null,
  ): Promise<void> {
    const todayStart = startOfDay(new Date());
    const [existing] = await this.db
      .select()
      .from(pageView)
      .where(
        and(
          eq(pageView.sessionHash, sessionHash),
          eq(pageView.url, dto.url),
          gte(pageView.createdAt, todayStart),
        ),
      )
      .limit(1);

    if (existing) {
      const newDuration = (existing.duration ?? 0) + (dto.duration ?? 0);
      await this.db
        .update(pageView)
        .set({ duration: newDuration })
        .where(eq(pageView.id, existing.id))
        .returning();
      return;
    }

    await this.db
      .insert(pageView)
      .values({
        sessionHash,
        url: dto.url,
        referrer: dto.referrer ?? null,
        browser,
        os,
        country,
        duration: dto.duration ?? null,
      })
      .returning();
  }

  private async insertCustomEvent(
    dto: TrackEventDto,
    sessionHash: string,
  ): Promise<void> {
    await this.db
      .insert(analyticsEvent)
      .values({
        sessionHash,
        eventType: dto.eventType!,
        entityId: dto.entityId ?? null,
        entityTitle: dto.entityTitle ?? null,
        metadata: dto.metadata ?? null,
      })
      .returning();
  }
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

```bash
pnpm test src/analytics/analytics-tracker.service.spec.ts
```

Expected: 10 tests verts.

> **Si un test échoue** : c'est presque toujours un problème de mock chain. Le test `'UPDATE duration si row existante'` mock `db.limit.mockResolvedValueOnce([row])` puis `db.returning.mockResolvedValueOnce([{ id }])`. Vérifier dans le code service que la chaîne SELECT termine sur `.limit(1)` et que UPDATE termine sur `.returning()`.
> **Ne JAMAIS modifier le service** pour faire passer un test. Toujours ajuster les tests/mocks.

- [ ] **Step 5: Lancer la suite complète**

```bash
pnpm test
```

Expected: ~245 tests verts (était 235, +10 new).

- [ ] **Step 6: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/analytics/analytics-tracker.service.ts src/analytics/analytics-tracker.service.spec.ts
git commit -m "feat(analytics): AnalyticsTrackerService (bot filter + session hash + UA + géoloc + INSERT/UPDATE) + 10 tests"
```

---

## Task 4: AnalyticsStatsService + tests TDD

**Files:**
- Create: `src/analytics/analytics-stats.service.ts`
- Create: `src/analytics/analytics-stats.service.spec.ts`

- [ ] **Step 1: Écrire les tests d'abord (TDD)**

Créer `src/analytics/analytics-stats.service.spec.ts` :

```typescript
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsStatsService } from './analytics-stats.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';

describe('AnalyticsStatsService', () => {
  let service: AnalyticsStatsService;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsStatsService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(AnalyticsStatsService);
    jest.useFakeTimers().setSystemTime(new Date('2026-04-26T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('overview', () => {
    it('agrège les 8 champs depuis page_view + analytics_event', async () => {
      // 8 sub-queries en parallèle. Le mock builder retourne des terminators :
      // - countDistinct sessionHash (visitors)        → [{ value: 100 }]
      // - count(*) page_view (pageviews)              → [{ value: 250 }]
      // - countDistinct sessionHash (sessions, dup)   → [{ value: 100 }]
      // - bounces (subquery HAVING count=1)           → [{ value: 30 }]
      // - sum(duration) totalDuration                 → [{ value: 12000 }]
      // - count event_type='project_click'            → [{ value: 15 }]
      // - count event_type='article_view'             → [{ value: 8 }]
      // - count event_type='cv_download'              → [{ value: 5 }]
      db.where
        .mockResolvedValueOnce([{ value: 100 }]) // visitors
        .mockResolvedValueOnce([{ value: 250 }]) // pageviews
        .mockResolvedValueOnce([{ value: 100 }]) // sessions
        .mockResolvedValueOnce([{ value: 30 }]) // bounces
        .mockResolvedValueOnce([{ value: 12000 }]) // totalDuration
        .mockResolvedValueOnce([{ value: 15 }]) // projectClicks
        .mockResolvedValueOnce([{ value: 8 }]) // articleViews
        .mockResolvedValueOnce([{ value: 5 }]); // cvDownloads

      const result = await service.overview({});

      expect(result.totalVisitors).toBe(100);
      expect(result.totalPageviews).toBe(250);
      expect(result.totalSessions).toBe(100);
      expect(result.bounceRate).toBe(30); // 30/100 = 30%
      expect(result.avgDuration).toBe(48); // 12000/250 = 48
      expect(result.projectClicks).toBe(15);
      expect(result.articleViews).toBe(8);
      expect(result.cvDownloads).toBe(5);
    });

    it('bounceRate = 0 quand pas de sessions', async () => {
      db.where
        .mockResolvedValueOnce([{ value: 0 }]) // visitors
        .mockResolvedValueOnce([{ value: 0 }]) // pageviews
        .mockResolvedValueOnce([{ value: 0 }]) // sessions
        .mockResolvedValueOnce([{ value: 0 }]) // bounces
        .mockResolvedValueOnce([{ value: null }]) // totalDuration
        .mockResolvedValueOnce([{ value: 0 }])
        .mockResolvedValueOnce([{ value: 0 }])
        .mockResolvedValueOnce([{ value: 0 }]);

      const result = await service.overview({});
      expect(result.bounceRate).toBe(0);
      expect(result.avgDuration).toBe(0);
    });
  });

  describe('chart', () => {
    it('retourne les rows daily_stat triées', async () => {
      const rows = [
        { date: '2026-04-25', visitors: 100, pageviews: 250 },
        { date: '2026-04-24', visitors: 80, pageviews: 200 },
      ];
      db.orderBy.mockResolvedValueOnce(rows);

      const result = await service.chart({
        from: '2026-04-24',
        to: '2026-04-25',
      });

      expect(result.data).toEqual(rows);
    });

    it("si to=today, append une row live calculée depuis page_view", async () => {
      const histRows = [
        { date: '2026-04-25', visitors: 50, pageviews: 100 },
      ];
      db.orderBy.mockResolvedValueOnce(histRows);
      // Live agg today : visitors + pageviews
      db.where
        .mockResolvedValueOnce([{ value: 12 }])
        .mockResolvedValueOnce([{ value: 30 }]);

      const result = await service.chart({
        from: '2026-04-25',
        to: '2026-04-26', // today
      });

      expect(result.data).toHaveLength(2);
      expect(result.data[1]).toEqual({
        date: '2026-04-26',
        visitors: 12,
        pageviews: 30,
      });
    });
  });

  describe('metrics', () => {
    it('top N par type, exclut NULL', async () => {
      const rows = [
        { value: '/home', count: 50 },
        { value: '/projects', count: 30 },
      ];
      db.limit.mockResolvedValueOnce(rows);

      const result = await service.metrics({ type: 'url', limit: 10 });

      expect(result.type).toBe('url');
      expect(result.data).toEqual(rows);
    });

    it('limit par défaut = 20', async () => {
      db.limit.mockResolvedValueOnce([]);

      await service.metrics({ type: 'browser' });

      expect(db.limit).toHaveBeenCalledWith(20);
    });
  });

  describe('active', () => {
    it('count + top URLs des 5 dernières minutes', async () => {
      // 2 sub-queries : countDistinct + groupBy URLs
      db.where.mockResolvedValueOnce([{ value: 7 }]); // count
      db.limit.mockResolvedValueOnce([
        { url: '/home', count: 4 },
        { url: '/projects', count: 3 },
      ]);

      const result = await service.active();

      expect(result.count).toBe(7);
      expect(result.pages).toHaveLength(2);
      expect(result.pages[0].url).toBe('/home');
    });
  });

  describe('projects / articles', () => {
    it("projects() filtre event_type='project_click' et group by entity", async () => {
      const rows = [
        { entityId: 'proj-1', entityTitle: 'Foo', count: 10 },
        { entityId: 'proj-2', entityTitle: 'Bar', count: 5 },
      ];
      db.limit.mockResolvedValueOnce(rows);

      const result = await service.projects({ limit: 5 });

      expect(result.data).toEqual(rows);
      expect(db.limit).toHaveBeenCalledWith(5);
    });
  });

  describe('cvDownloads', () => {
    it('total + timeline 30 jours', async () => {
      // 2 queries : count(*) + groupBy date
      db.where.mockResolvedValueOnce([{ value: 42 }]); // total
      db.orderBy.mockResolvedValueOnce([
        { date: '2026-04-25', count: 3 },
        { date: '2026-04-24', count: 2 },
      ]);

      const result = await service.cvDownloads({});

      expect(result.total).toBe(42);
      expect(result.timeline).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

```bash
pnpm test src/analytics/analytics-stats.service.spec.ts
```

Expected: erreur `Cannot find module './analytics-stats.service'`.

- [ ] **Step 3: Créer le service**

Créer `src/analytics/analytics-stats.service.ts` :

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  isNotNull,
  lt,
  sql,
  sum,
} from 'drizzle-orm';
import { format, subDays, subMinutes, startOfDay, endOfDay } from 'date-fns';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  pageView,
  analyticsEvent,
  dailyStat,
} from '../database/schema/analytics';
import {
  DateRangeQueryDto,
  MetricsQueryDto,
} from './dto/date-range-query.dto';

interface DateBounds {
  start: Date;
  end: Date;
  toDateStr: string;
  isTodayIncluded: boolean;
}

@Injectable()
export class AnalyticsStatsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async overview(query: DateRangeQueryDto) {
    const { start, end } = this.bounds(query);

    const [
      [vRow],
      [pvRow],
      [sRow],
      [bRow],
      [dRow],
      [pcRow],
      [avRow],
      [cdRow],
    ] = await Promise.all([
      this.db
        .select({ value: countDistinct(pageView.sessionHash) })
        .from(pageView)
        .where(and(gte(pageView.createdAt, start), lt(pageView.createdAt, end))),
      this.db
        .select({ value: count() })
        .from(pageView)
        .where(and(gte(pageView.createdAt, start), lt(pageView.createdAt, end))),
      this.db
        .select({ value: countDistinct(pageView.sessionHash) })
        .from(pageView)
        .where(and(gte(pageView.createdAt, start), lt(pageView.createdAt, end))),
      this.db
        .select({
          value: sql<number>`(SELECT COUNT(*) FROM (
            SELECT ${pageView.sessionHash} FROM ${pageView}
            WHERE ${pageView.createdAt} >= ${start}
              AND ${pageView.createdAt} < ${end}
            GROUP BY ${pageView.sessionHash}
            HAVING COUNT(*) = 1
          ) AS bounced)`,
        })
        .from(pageView)
        .where(and(gte(pageView.createdAt, start), lt(pageView.createdAt, end))),
      this.db
        .select({ value: sum(pageView.duration) })
        .from(pageView)
        .where(and(gte(pageView.createdAt, start), lt(pageView.createdAt, end))),
      this.db
        .select({ value: count() })
        .from(analyticsEvent)
        .where(
          and(
            eq(analyticsEvent.eventType, 'project_click'),
            gte(analyticsEvent.createdAt, start),
            lt(analyticsEvent.createdAt, end),
          ),
        ),
      this.db
        .select({ value: count() })
        .from(analyticsEvent)
        .where(
          and(
            eq(analyticsEvent.eventType, 'article_view'),
            gte(analyticsEvent.createdAt, start),
            lt(analyticsEvent.createdAt, end),
          ),
        ),
      this.db
        .select({ value: count() })
        .from(analyticsEvent)
        .where(
          and(
            eq(analyticsEvent.eventType, 'cv_download'),
            gte(analyticsEvent.createdAt, start),
            lt(analyticsEvent.createdAt, end),
          ),
        ),
    ]);

    const totalVisitors = Number(vRow?.value ?? 0);
    const totalPageviews = Number(pvRow?.value ?? 0);
    const totalSessions = Number(sRow?.value ?? 0);
    const bounces = Number(bRow?.value ?? 0);
    const totalDuration = Number(dRow?.value ?? 0);
    const projectClicks = Number(pcRow?.value ?? 0);
    const articleViews = Number(avRow?.value ?? 0);
    const cvDownloads = Number(cdRow?.value ?? 0);

    const bounceRate =
      totalSessions > 0
        ? Math.round((bounces / totalSessions) * 10000) / 100
        : 0;
    const avgDuration =
      totalPageviews > 0 ? Math.round(totalDuration / totalPageviews) : 0;

    return {
      totalVisitors,
      totalPageviews,
      totalSessions,
      bounceRate,
      avgDuration,
      projectClicks,
      articleViews,
      cvDownloads,
    };
  }

  async chart(query: DateRangeQueryDto) {
    const { start, end, toDateStr, isTodayIncluded } = this.bounds(query);
    const today = format(new Date(), 'yyyy-MM-dd');

    const histRows = await this.db
      .select({
        date: dailyStat.date,
        visitors: dailyStat.visitors,
        pageviews: dailyStat.pageviews,
      })
      .from(dailyStat)
      .where(
        and(
          gte(dailyStat.date, format(start, 'yyyy-MM-dd')),
          lt(
            dailyStat.date,
            isTodayIncluded ? today : format(end, 'yyyy-MM-dd'),
          ),
        ),
      )
      .orderBy(desc(dailyStat.date));

    const data = histRows.reverse(); // ASC

    if (isTodayIncluded && toDateStr === today) {
      const todayStart = startOfDay(new Date());
      const todayEnd = endOfDay(new Date());
      const [[v], [p]] = await Promise.all([
        this.db
          .select({ value: countDistinct(pageView.sessionHash) })
          .from(pageView)
          .where(
            and(
              gte(pageView.createdAt, todayStart),
              lt(pageView.createdAt, todayEnd),
            ),
          ),
        this.db
          .select({ value: count() })
          .from(pageView)
          .where(
            and(
              gte(pageView.createdAt, todayStart),
              lt(pageView.createdAt, todayEnd),
            ),
          ),
      ]);
      data.push({
        date: today,
        visitors: Number(v?.value ?? 0),
        pageviews: Number(p?.value ?? 0),
      });
    }

    return { data };
  }

  async metrics(query: MetricsQueryDto) {
    const { start, end } = this.bounds(query);
    const limit = query.limit ?? 20;
    const col = pageView[query.type as keyof typeof pageView] as never;

    const rows = await this.db
      .select({
        value: col,
        count: count(),
      })
      .from(pageView)
      .where(
        and(
          isNotNull(col),
          gte(pageView.createdAt, start),
          lt(pageView.createdAt, end),
        ),
      )
      .groupBy(col)
      .orderBy(desc(count()))
      .limit(limit);

    return { type: query.type, data: rows };
  }

  async active() {
    const cutoff = subMinutes(new Date(), 5);

    const [[c], pages] = await Promise.all([
      this.db
        .select({ value: countDistinct(pageView.sessionHash) })
        .from(pageView)
        .where(gte(pageView.createdAt, cutoff)),
      this.db
        .select({ url: pageView.url, count: count() })
        .from(pageView)
        .where(gte(pageView.createdAt, cutoff))
        .groupBy(pageView.url)
        .orderBy(desc(count()))
        .limit(20),
    ]);

    return { count: Number(c?.value ?? 0), pages };
  }

  async projects(query: DateRangeQueryDto) {
    return this.entityCounts('project_click', query);
  }

  async articles(query: DateRangeQueryDto) {
    return this.entityCounts('article_view', query);
  }

  private async entityCounts(
    eventType: 'project_click' | 'article_view',
    query: DateRangeQueryDto,
  ) {
    const { start, end } = this.bounds(query);
    const limit = query.limit ?? 20;

    const rows = await this.db
      .select({
        entityId: analyticsEvent.entityId,
        entityTitle: analyticsEvent.entityTitle,
        count: count(),
      })
      .from(analyticsEvent)
      .where(
        and(
          eq(analyticsEvent.eventType, eventType),
          gte(analyticsEvent.createdAt, start),
          lt(analyticsEvent.createdAt, end),
        ),
      )
      .groupBy(analyticsEvent.entityId, analyticsEvent.entityTitle)
      .orderBy(desc(count()))
      .limit(limit);

    return { data: rows };
  }

  async cvDownloads(query: DateRangeQueryDto) {
    const { start, end } = this.bounds(query);

    const [[totalRow], timeline] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(analyticsEvent)
        .where(
          and(
            eq(analyticsEvent.eventType, 'cv_download'),
            gte(analyticsEvent.createdAt, start),
            lt(analyticsEvent.createdAt, end),
          ),
        ),
      this.db
        .select({
          date: sql<string>`DATE(${analyticsEvent.createdAt})`,
          count: count(),
        })
        .from(analyticsEvent)
        .where(
          and(
            eq(analyticsEvent.eventType, 'cv_download'),
            gte(analyticsEvent.createdAt, start),
            lt(analyticsEvent.createdAt, end),
          ),
        )
        .groupBy(sql`DATE(${analyticsEvent.createdAt})`)
        .orderBy(desc(sql`DATE(${analyticsEvent.createdAt})`)),
    ]);

    return {
      total: Number(totalRow?.value ?? 0),
      timeline,
    };
  }

  private bounds(query: DateRangeQueryDto): DateBounds {
    const now = new Date();
    const today = format(now, 'yyyy-MM-dd');
    const fromStr = query.from ?? format(subDays(now, 30), 'yyyy-MM-dd');
    const toStr = query.to ?? today;

    const start = startOfDay(new Date(`${fromStr}T00:00:00Z`));
    const end = endOfDay(new Date(`${toStr}T00:00:00Z`));

    return {
      start,
      end,
      toDateStr: toStr,
      isTodayIncluded: toStr === today,
    };
  }
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

```bash
pnpm test src/analytics/analytics-stats.service.spec.ts
```

Expected: 10 tests verts.

> **Si un test échoue** : les méthodes `overview` et `chart` font plusieurs queries en parallèle via `Promise.all`. Le mock builder `createMockDb()` n'a qu'un terminator par méthode (`where`, `limit`, etc.) mais `mockResolvedValueOnce` est consommé séquentiellement dans l'ordre de résolution. Si l'ordre de résolution `Promise.all` n'est pas déterministe, **utiliser `mockResolvedValueOnce` dans l'ordre des items du tableau passé à `Promise.all`** — Jest les consomme dans cet ordre car les chaînes Drizzle sont synchrones jusqu'à `await`.
>
> **Ne JAMAIS modifier le service** pour les tests.

- [ ] **Step 5: Lancer la suite complète**

```bash
pnpm test
```

Expected: ~255 tests verts (+10 new).

- [ ] **Step 6: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/analytics/analytics-stats.service.ts src/analytics/analytics-stats.service.spec.ts
git commit -m "feat(analytics): AnalyticsStatsService (7 méthodes : overview, chart, metrics, active, projects, articles, cvDownloads) + 10 tests"
```

---

## Task 5: AnalyticsAggregatorService + tests TDD

**Files:**
- Create: `src/analytics/analytics-aggregator.service.ts`
- Create: `src/analytics/analytics-aggregator.service.spec.ts`

- [ ] **Step 1: Écrire les tests d'abord (TDD)**

Créer `src/analytics/analytics-aggregator.service.spec.ts` :

```typescript
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { AnalyticsAggregatorService } from './analytics-aggregator.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';

describe('AnalyticsAggregatorService', () => {
  let service: AnalyticsAggregatorService;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsAggregatorService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(AnalyticsAggregatorService);
    jest.useFakeTimers().setSystemTime(new Date('2026-04-26T01:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // Helper : 8 mocks pour les 8 sub-queries de computeAggregates
  const mockAggregateValues = (overrides: Partial<Record<string, number>> = {}) => {
    db.where
      .mockResolvedValueOnce([{ value: overrides.visitors ?? 50 }])
      .mockResolvedValueOnce([{ value: overrides.pageviews ?? 120 }])
      .mockResolvedValueOnce([{ value: overrides.sessions ?? 50 }])
      .mockResolvedValueOnce([{ value: overrides.bounces ?? 10 }])
      .mockResolvedValueOnce([{ value: overrides.totalDuration ?? 5000 }])
      .mockResolvedValueOnce([{ value: overrides.projectClicks ?? 8 }])
      .mockResolvedValueOnce([{ value: overrides.articleViews ?? 4 }])
      .mockResolvedValueOnce([{ value: overrides.cvDownloads ?? 2 }]);
  };

  describe('aggregateYesterday', () => {
    it('calcule les agrégats J-1 et UPSERT daily_stat', async () => {
      mockAggregateValues();
      // onConflictDoUpdate terminator (insert path)
      db.values.mockReturnThis();
      // purge raw events terminators
      db.where.mockResolvedValueOnce(undefined); // delete page_view
      db.where.mockResolvedValueOnce(undefined); // delete analytics_event

      await service.aggregateYesterday();

      expect(db.insert).toHaveBeenCalledTimes(1); // upsert daily_stat
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-04-25', // J-1
          visitors: 50,
          pageviews: 120,
          bounces: 10,
        }),
      );
    });

    it('purge raw events > 30j (DELETE sur page_view + analytics_event)', async () => {
      mockAggregateValues();
      db.where.mockResolvedValueOnce(undefined); // delete page_view
      db.where.mockResolvedValueOnce(undefined); // delete analytics_event

      await service.aggregateYesterday();

      expect(db.delete).toHaveBeenCalledTimes(2);
    });
  });

  describe('manualRun', () => {
    it('agrège la date passée (pas J-1)', async () => {
      mockAggregateValues({ visitors: 200, pageviews: 500 });

      await service.manualRun(new Date('2026-04-20T12:00:00Z'));

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-04-20',
          visitors: 200,
          pageviews: 500,
        }),
      );
    });

    it('idempotent : 2 runs sur même date → 1 row (UPSERT path)', async () => {
      mockAggregateValues();
      mockAggregateValues();

      await service.manualRun(new Date('2026-04-20T12:00:00Z'));
      await service.manualRun(new Date('2026-04-20T12:00:00Z'));

      // 2 INSERTs avec onConflictDoUpdate (Drizzle gère le UPSERT côté SQL)
      expect(db.insert).toHaveBeenCalledTimes(2);
      // Les 2 calls passent par .onConflictDoUpdate, pas de duplicate row côté DB
    });
  });

  describe('logging', () => {
    it('émet une log line au succès', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      mockAggregateValues();
      db.where.mockResolvedValueOnce(undefined);
      db.where.mockResolvedValueOnce(undefined);

      await service.aggregateYesterday();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Aggregated 2026-04-25'),
      );
    });
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

```bash
pnpm test src/analytics/analytics-aggregator.service.spec.ts
```

Expected: erreur `Cannot find module './analytics-aggregator.service'`.

- [ ] **Step 3: Créer le service**

Créer `src/analytics/analytics-aggregator.service.ts` :

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  and,
  count,
  countDistinct,
  eq,
  gte,
  lt,
  sql,
  sum,
} from 'drizzle-orm';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  pageView,
  analyticsEvent,
  dailyStat,
} from '../database/schema/analytics';

interface DayAggregates {
  visitors: number;
  pageviews: number;
  sessions: number;
  bounces: number;
  totalDuration: number;
  projectClicks: number;
  articleViews: number;
  cvDownloads: number;
}

@Injectable()
export class AnalyticsAggregatorService {
  private readonly logger = new Logger(AnalyticsAggregatorService.name);
  private static readonly RETENTION_DAYS = 30;

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Cron('0 0 * * *', { timeZone: 'UTC' })
  async aggregateYesterday(): Promise<void> {
    const yesterday = subDays(new Date(), 1);
    await this.runAggregation(yesterday);
    await this.purgeOldRawEvents();
  }

  async manualRun(date: Date): Promise<void> {
    await this.runAggregation(date);
  }

  private async runAggregation(day: Date): Promise<void> {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dayStart = startOfDay(day);
    const dayEnd = endOfDay(day);

    const aggregates = await this.computeAggregates(dayStart, dayEnd);

    await this.db
      .insert(dailyStat)
      .values({ date: dateStr, ...aggregates })
      .onConflictDoUpdate({
        target: dailyStat.date,
        set: { ...aggregates, updatedAt: new Date() },
      });

    this.logger.log(
      `Aggregated ${dateStr}: ${aggregates.visitors} visitors, ${aggregates.pageviews} pv, ${aggregates.bounces} bounces`,
    );
  }

  private async computeAggregates(
    start: Date,
    end: Date,
  ): Promise<DayAggregates> {
    const [
      [vRow],
      [pvRow],
      [sRow],
      [bRow],
      [dRow],
      [pcRow],
      [avRow],
      [cdRow],
    ] = await Promise.all([
      this.db
        .select({ value: countDistinct(pageView.sessionHash) })
        .from(pageView)
        .where(and(gte(pageView.createdAt, start), lt(pageView.createdAt, end))),
      this.db
        .select({ value: count() })
        .from(pageView)
        .where(and(gte(pageView.createdAt, start), lt(pageView.createdAt, end))),
      this.db
        .select({ value: countDistinct(pageView.sessionHash) })
        .from(pageView)
        .where(and(gte(pageView.createdAt, start), lt(pageView.createdAt, end))),
      this.db
        .select({
          value: sql<number>`(SELECT COUNT(*) FROM (
            SELECT ${pageView.sessionHash} FROM ${pageView}
            WHERE ${pageView.createdAt} >= ${start}
              AND ${pageView.createdAt} < ${end}
            GROUP BY ${pageView.sessionHash}
            HAVING COUNT(*) = 1
          ) AS bounced)`,
        })
        .from(pageView)
        .where(and(gte(pageView.createdAt, start), lt(pageView.createdAt, end))),
      this.db
        .select({ value: sum(pageView.duration) })
        .from(pageView)
        .where(and(gte(pageView.createdAt, start), lt(pageView.createdAt, end))),
      this.db
        .select({ value: count() })
        .from(analyticsEvent)
        .where(
          and(
            eq(analyticsEvent.eventType, 'project_click'),
            gte(analyticsEvent.createdAt, start),
            lt(analyticsEvent.createdAt, end),
          ),
        ),
      this.db
        .select({ value: count() })
        .from(analyticsEvent)
        .where(
          and(
            eq(analyticsEvent.eventType, 'article_view'),
            gte(analyticsEvent.createdAt, start),
            lt(analyticsEvent.createdAt, end),
          ),
        ),
      this.db
        .select({ value: count() })
        .from(analyticsEvent)
        .where(
          and(
            eq(analyticsEvent.eventType, 'cv_download'),
            gte(analyticsEvent.createdAt, start),
            lt(analyticsEvent.createdAt, end),
          ),
        ),
    ]);

    return {
      visitors: Number(vRow?.value ?? 0),
      pageviews: Number(pvRow?.value ?? 0),
      sessions: Number(sRow?.value ?? 0),
      bounces: Number(bRow?.value ?? 0),
      totalDuration: Number(dRow?.value ?? 0),
      projectClicks: Number(pcRow?.value ?? 0),
      articleViews: Number(avRow?.value ?? 0),
      cvDownloads: Number(cdRow?.value ?? 0),
    };
  }

  private async purgeOldRawEvents(): Promise<void> {
    const cutoff = subDays(
      new Date(),
      AnalyticsAggregatorService.RETENTION_DAYS,
    );
    await this.db.delete(pageView).where(lt(pageView.createdAt, cutoff));
    await this.db
      .delete(analyticsEvent)
      .where(lt(analyticsEvent.createdAt, cutoff));
    this.logger.log(
      `Purged page_view + analytics_event older than ${cutoff.toISOString()}`,
    );
  }
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

```bash
pnpm test src/analytics/analytics-aggregator.service.spec.ts
```

Expected: 5 tests verts.

> **Si test "logging" échoue** : `jest.spyOn(Logger.prototype, 'log')` doit être déclaré **avant** l'instanciation du service. Le `Logger` du `service.logger` est créé dans le constructeur ; spier sur le prototype attrape tous les calls. Si le spy n'attrape rien, vérifier qu'aucun `.mockReset()` global n'efface les spies entre tests.

- [ ] **Step 5: Lancer la suite complète**

```bash
pnpm test
```

Expected: ~260 tests verts (+5 new).

- [ ] **Step 6: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/analytics/analytics-aggregator.service.ts src/analytics/analytics-aggregator.service.spec.ts
git commit -m "feat(analytics): AnalyticsAggregatorService (cron 00:00 UTC + UPSERT idempotent + purge 30j) + 5 tests"
```

---

## Task 6: Controller + Module + AppModule + ScheduleModule + trust proxy

**Files:**
- Create: `src/analytics/analytics.controller.ts`
- Create: `src/analytics/analytics.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Créer le controller**

Créer `src/analytics/analytics.controller.ts` :

```typescript
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
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
import { AnalyticsTrackerService } from './analytics-tracker.service';
import { AnalyticsStatsService } from './analytics-stats.service';
import { TrackEventDto } from './dto/track-event.dto';
import {
  DateRangeQueryDto,
  MetricsQueryDto,
} from './dto/date-range-query.dto';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly tracker: AnalyticsTrackerService,
    private readonly stats: AnalyticsStatsService,
  ) {}

  @Post('track')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 1000 } })
  @ApiOperation({
    summary: 'Track a page-view or custom event (public, fire-and-forget)',
  })
  @ApiResponse({ status: 204, description: 'Tracked (or silently filtered)' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 429, description: 'Throttle exceeded' })
  async track(
    @Body() dto: TrackEventDto,
    @Ip() ip: string,
    @Headers('user-agent') ua: string | undefined,
  ): Promise<void> {
    await this.tracker.track(dto, ip, ua ?? '');
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/overview')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Aggregate stats over a date range (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  overview(@Query() query: DateRangeQueryDto) {
    return this.stats.overview(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/chart')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Daily time-series (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  chart(@Query() query: DateRangeQueryDto) {
    return this.stats.chart(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/metrics')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Top N values for url|referrer|browser|country|os (admin)',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  metrics(@Query() query: MetricsQueryDto) {
    return this.stats.metrics(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/active')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Active sessions in last 5 minutes (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  active() {
    return this.stats.active();
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/projects')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Top clicked projects (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  projects(@Query() query: DateRangeQueryDto) {
    return this.stats.projects(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/articles')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Top viewed articles (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  articles(@Query() query: DateRangeQueryDto) {
    return this.stats.articles(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/cv-downloads')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'CV download total + 30d timeline (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  cvDownloads(@Query() query: DateRangeQueryDto) {
    return this.stats.cvDownloads(query);
  }
}
```

- [ ] **Step 2: Créer le module**

Créer `src/analytics/analytics.module.ts` :

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsTrackerService } from './analytics-tracker.service';
import { AnalyticsStatsService } from './analytics-stats.service';
import { AnalyticsAggregatorService } from './analytics-aggregator.service';

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsTrackerService,
    AnalyticsStatsService,
    AnalyticsAggregatorService,
  ],
  exports: [AnalyticsAggregatorService], // exporté pour le standalone script du Task 7
})
export class AnalyticsModule {}
```

- [ ] **Step 3: Wirer ScheduleModule + AnalyticsModule dans `src/app.module.ts`**

Lire `src/app.module.ts` d'abord. Trouver l'import de `CvModule` :

```typescript
import { CvModule } from './cv/cv.module';
```

Ajouter immédiatement après :

```typescript
import { ScheduleModule } from '@nestjs/schedule';
import { AnalyticsModule } from './analytics/analytics.module';
```

Trouver la fin du `imports` array (devrait se terminer par `CvModule`) :

```typescript
    BookingsModule,
    CvModule,
  ],
```

Le remplacer par (ajout `ScheduleModule.forRoot()` + `AnalyticsModule` après `CvModule`) :

```typescript
    BookingsModule,
    CvModule,
    ScheduleModule.forRoot(),
    AnalyticsModule,
  ],
```

- [ ] **Step 4: Activer trust proxy dans `src/main.ts`**

Lire `src/main.ts`. Après `const app = await NestFactory.create(AppModule, { bufferLogs: true });`, ajouter immédiatement :

```typescript
  // Pour que req.ip lise X-Forwarded-For derrière un reverse proxy (Caddy/Nginx)
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
```

(Note : `app.getHttpAdapter().getInstance()` retourne l'instance Express sous-jacente. `app.set` n'existe pas directement.)

- [ ] **Step 5: Vérifier que TypeScript compile**

```bash
pnpm build
```

Expected: clean.

- [ ] **Step 6: Suite de tests**

```bash
pnpm test
```

Expected: ~260 tests verts (idem fin Task 5 — pas de nouveau test).

- [ ] **Step 7: Smoke test boot**

```bash
pnpm db:up && pnpm db:wait
sleep 3
timeout 25 pnpm dev > /tmp/analytics-boot.log 2>&1 || true
grep -E 'AnalyticsModule|/analytics|ScheduleModule|Cron' /tmp/analytics-boot.log
```

Expected (au moins) :
- `ScheduleModule dependencies initialized`
- `AnalyticsModule dependencies initialized`
- `Mapped {/analytics/track, POST}`
- `Mapped {/analytics/stats/overview, GET}` + 6 autres routes stats
- `Nest application successfully started`

Si une route manque, STOP et reporter.

- [ ] **Step 8: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/analytics/analytics.controller.ts src/analytics/analytics.module.ts src/app.module.ts src/main.ts
git commit -m "feat(analytics): controller (8 endpoints) + module + ScheduleModule + AppModule wiring + trust proxy"
```

---

## Task 7: Standalone script + E2E manuel + README + clôture migration

**Files:**
- Create: `scripts/run-analytics-aggregator.ts`
- Modify: `README.md`

### Étape A — Script standalone pour test du cron en e2e

- [ ] **Step 1: Créer le script**

Créer `scripts/run-analytics-aggregator.ts` :

```typescript
/**
 * Standalone runner pour AnalyticsAggregatorService.manualRun().
 *
 * Usage:
 *   pnpm exec tsx scripts/run-analytics-aggregator.ts [YYYY-MM-DD]
 *
 * Si argument absent → agrège J-1.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AnalyticsAggregatorService } from '../src/analytics/analytics-aggregator.service';
import { subDays } from 'date-fns';

async function main(): Promise<void> {
  const arg = process.argv[2];
  const date = arg ? new Date(`${arg}T12:00:00Z`) : subDays(new Date(), 1);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const service = app.get(AnalyticsAggregatorService);
  await service.manualRun(date);
  await app.close();
  process.exit(0);
}

void main();
```

- [ ] **Step 2: Smoke test du script (sans arg → J-1)**

D'abord s'assurer que la stack tourne :

```bash
pnpm db:up && pnpm db:wait
pnpm exec tsx scripts/run-analytics-aggregator.ts
```

Expected: log `Aggregated <YYYY-MM-DD>: 0 visitors, 0 pv, 0 bounces` (probablement vide en dev neuf).

### Étape B — E2E manuel des endpoints (15 steps)

**Préparation** : avoir Postgres + l'app dispo. Pas besoin de S3/Mailpit (Analytics ne consomme ni l'un ni l'autre).

- [ ] **Step 3: Démarrer la stack et l'app**

```bash
pnpm db:up && pnpm db:wait
sleep 2
nohup pnpm dev > /tmp/analytics-e2e-dev.log 2>&1 &
echo $! > /tmp/analytics-e2e-pid
sleep 10
curl -fsS http://localhost:3000/health
```

Expected: `{"status":"ok"}`.

- [ ] **Step 4: POST /analytics/track page-view → 204**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/analytics/track \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0' \
  -d '{"url":"/projects","referrer":"https://google.com"}'
```

Expected: `204`.

```bash
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c "SELECT count(*), max(created_at) FROM page_view"
```

Expected: 1 row insérée.

- [ ] **Step 5: POST /analytics/track 2e fois même session+URL → duration cumulée**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/analytics/track \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0' \
  -d '{"url":"/projects","duration":15}'
```

Expected: `204`.

```bash
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c "SELECT count(*), duration FROM page_view WHERE url='/projects'"
```

Expected: toujours 1 row (UPDATE), `duration` cumulée à 15 (0 initial + 15 cumul).

- [ ] **Step 6: POST /analytics/track avec eventType='project_click' → analytics_event INSERT**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/analytics/track \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0' \
  -d '{"url":"/projects/foo","eventType":"project_click","entityId":"foo-id","entityTitle":"Foo Project"}'
```

Expected: `204`.

```bash
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c "SELECT count(*), event_type, entity_title FROM analytics_event GROUP BY event_type, entity_title"
```

Expected: 1 row `event_type='project_click', entity_title='Foo Project'`.

- [ ] **Step 7: POST /analytics/track avec UA Googlebot → 204 mais PAS de row**

D'abord noter le count actuel :

```bash
PV_BEFORE=$(podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -tAc "SELECT count(*) FROM page_view")
echo "PV avant : $PV_BEFORE"
```

Puis tracker en bot :

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/analytics/track \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: Googlebot/2.1 (+http://www.google.com/bot.html)' \
  -d '{"url":"/should-not-be-tracked"}'
```

Expected: `204`.

```bash
PV_AFTER=$(podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -tAc "SELECT count(*) FROM page_view")
echo "PV après : $PV_AFTER"
```

Expected: `PV_AFTER == PV_BEFORE` (le bot a été filtré).

- [ ] **Step 8: POST /analytics/track avec URL > 2048 chars → 400**

```bash
LONG_URL=$(printf '/path%.0s' {1..600})  # ~3000 chars
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/analytics/track \
  -H 'Content-Type: application/json' \
  -d "{\"url\":\"$LONG_URL\"}"
```

Expected: `400`.

- [ ] **Step 9: GET /analytics/stats/overview sans auth → 401**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/analytics/stats/overview
```

Expected: `401`.

- [ ] **Step 10: Login admin**

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@nedellec-julien.fr","password":"change-me-please-at-least-12-chars"}' \
  -c /tmp/analytics-cookies.txt -i 2>&1 | head -5
```

Expected: HTTP 200, Set-Cookie.

- [ ] **Step 11: GET /analytics/stats/overview (admin)**

```bash
curl -s -b /tmp/analytics-cookies.txt http://localhost:3000/analytics/stats/overview | python3 -m json.tool
```

Expected: JSON avec `totalVisitors >= 1`, `totalPageviews >= 1`, `projectClicks >= 1`.

- [ ] **Step 12: GET /analytics/stats/chart**

```bash
curl -s -b /tmp/analytics-cookies.txt "http://localhost:3000/analytics/stats/chart" | python3 -m json.tool
```

Expected: `{ "data": [...] }`. La date d'aujourd'hui doit être présente avec la live agg.

- [ ] **Step 13: GET /analytics/stats/metrics?type=url**

```bash
curl -s -b /tmp/analytics-cookies.txt "http://localhost:3000/analytics/stats/metrics?type=url" | python3 -m json.tool
```

Expected: `{ "type": "url", "data": [{ "value": "/projects", "count": 1 }, ...] }`.

- [ ] **Step 14: GET /analytics/stats/active**

```bash
curl -s -b /tmp/analytics-cookies.txt http://localhost:3000/analytics/stats/active | python3 -m json.tool
```

Expected: `{ "count": 1, "pages": [...] }` (au moins 1 session active vu qu'on vient de tracker).

- [ ] **Step 15: GET /analytics/stats/projects**

```bash
curl -s -b /tmp/analytics-cookies.txt http://localhost:3000/analytics/stats/projects | python3 -m json.tool
```

Expected: `{ "data": [{ "entityId": "foo-id", "entityTitle": "Foo Project", "count": 1 }] }`.

- [ ] **Step 16: Trigger manuel l'aggregator pour aujourd'hui**

```bash
TODAY=$(date -u +%Y-%m-%d)
pnpm exec tsx scripts/run-analytics-aggregator.ts "$TODAY"
```

Expected: log `Aggregated <TODAY>: 1+ visitors, ...`.

```bash
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c "SELECT date, visitors, pageviews FROM daily_stat ORDER BY date DESC LIMIT 1"
```

Expected: 1 row pour aujourd'hui avec visitors >= 1.

- [ ] **Step 17: Re-run aggregator même date → row updated, pas dupliquée (UPSERT)**

```bash
pnpm exec tsx scripts/run-analytics-aggregator.ts "$TODAY"
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c "SELECT count(*) FROM daily_stat WHERE date='$TODAY'"
```

Expected: `count = 1` (pas de duplicate).

- [ ] **Step 18: Cleanup e2e**

```bash
kill $(cat /tmp/analytics-e2e-pid) 2>/dev/null
sleep 1
rm /tmp/analytics-cookies.txt /tmp/analytics-e2e-pid /tmp/analytics-e2e-dev.log /tmp/analytics-boot.log 2>/dev/null
```

### Étape C — README + clôture

- [ ] **Step 19: Ajouter la section Analytics au README**

Ouvrir `README.md`. Localiser la section `## CV` (ajoutée au sous-projet précédent). Insérer la nouvelle section `## Analytics` **immédiatement après** la section CV et **avant** `## Migration depuis le backend Hono`.

Contenu à insérer :

```markdown
## Analytics

Module métier pour la collecte de page-views et events custom du portfolio public, avec agrégation quotidienne via cron. **Dernier sous-projet de la migration Hono → NestJS.**

**3 tables** :
- `page_view` (raw events, 9 colonnes, 3 indexes) — purgé après 30j par le cron
- `analytics_event` (events custom : project_click, article_view, cv_download, 7 colonnes, 3 indexes) — purgé après 30j
- `daily_stat` (rollup quotidien, 12 colonnes, unique sur `date`) — conservé indéfiniment

**8 endpoints sous `/analytics`** :

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| POST | `/analytics/track` | ❌ | Track page-view ou event custom (fire-and-forget, 204). Throttle 10/sec/IP. Filtre bots via `isbot`. |
| GET | `/analytics/stats/overview` | ✅ | Totaux (visitors, pv, sessions, bounceRate, avgDuration, eventCounts) sur date range. |
| GET | `/analytics/stats/chart` | ✅ | Time-series quotidien (depuis `daily_stat` + live agg pour today). |
| GET | `/analytics/stats/metrics?type=url\|referrer\|browser\|country\|os` | ✅ | Top N par dimension. |
| GET | `/analytics/stats/active` | ✅ | Sessions actives 5 dernières minutes. |
| GET | `/analytics/stats/projects` | ✅ | Top projets cliqués. |
| GET | `/analytics/stats/articles` | ✅ | Top articles vus. |
| GET | `/analytics/stats/cv-downloads` | ✅ | Total + timeline 30j. |

**Privacy / sécurité** :
- Pas de cookies posés ou lus
- IP utilisée uniquement pour calculer hash session + lookup pays, jamais persistée
- User-Agent jamais persisté brut, seulement parsé en `browser` + `os`
- Session hash = `SHA256(IP + UA + YYYY-MM-DD UTC)` — non-réversible, change chaque jour
- Bots filtrés à l'entrée (lib `isbot`)

**Cron quotidien** : `@Cron('0 0 * * *', { timeZone: 'UTC' })`. Agrège J-1 dans `daily_stat` (UPSERT idempotent), puis purge `page_view` + `analytics_event` > 30j.

**Trigger manuel** : `pnpm exec tsx scripts/run-analytics-aggregator.ts [YYYY-MM-DD]` pour agréger une date arbitraire (utile en cas de cron raté).

**Configuration** :
- Pas de nouvelle env var
- Nouvelles deps : `@nestjs/schedule`, `geoip-lite` (DB MaxMind ~22MB embarquée), `ua-parser-js`, `isbot`
- Throttle global = 10/60s, override 10/sec sur `POST /track`
- `app.set('trust proxy', 1)` activé dans `main.ts` pour lire `X-Forwarded-For` derrière un reverse proxy

**Voir le spec complet** : [`docs/superpowers/specs/2026-04-26-analytics-design.md`](docs/superpowers/specs/2026-04-26-analytics-design.md).
```

- [ ] **Step 20: Mettre à jour la liste des sous-projets**

Localiser la liste numérotée. État actuel :

```markdown
1. ✅ Fondations
2. ✅ Auth (Users + JWT + 2FA + backup codes)
3. ✅ Profile public (Profile, Hero, SocialLinks, Diplomas, Technologies, Expertises, ServicePricing)
4. ✅ S3 Storage (StorageModule + MinIO local + Garage prod)
5. ✅ Projects (CRUD + upload image qui consomme S3 Storage)
6. ✅ Avatar Profile (`POST /profile/avatar` + transformation key→URL en sortie API, cohérent Projects)
7. ✅ Mailer (MailerModule @Global + Mailpit local + nodemailer)
8. ✅ Contact (6 endpoints + 2 templates + throttling 5/60s, premier consumer Mailer)
9. ✅ Bookings (7 endpoints + 2 templates + validation conflit serveur, 2ème consumer Mailer)
10. ✅ CV (upload PDF + download stream + singleton, 3ème consumer S3)
11. **Analytics** *(prochain)* (page views + agrégats)
```

Le remplacer par (item 11 marqué ✅, mention "migration terminée") :

```markdown
1. ✅ Fondations
2. ✅ Auth (Users + JWT + 2FA + backup codes)
3. ✅ Profile public (Profile, Hero, SocialLinks, Diplomas, Technologies, Expertises, ServicePricing)
4. ✅ S3 Storage (StorageModule + MinIO local + Garage prod)
5. ✅ Projects (CRUD + upload image qui consomme S3 Storage)
6. ✅ Avatar Profile (`POST /profile/avatar` + transformation key→URL en sortie API, cohérent Projects)
7. ✅ Mailer (MailerModule @Global + Mailpit local + nodemailer)
8. ✅ Contact (6 endpoints + 2 templates + throttling 5/60s, premier consumer Mailer)
9. ✅ Bookings (7 endpoints + 2 templates + validation conflit serveur, 2ème consumer Mailer)
10. ✅ CV (upload PDF + download stream + singleton, 3ème consumer S3)
11. ✅ Analytics (3 tables + 8 endpoints + cron rollup nocturne + bot filter + UA + géoloc IP)

**🎉 Migration Hono → NestJS terminée — 11/11 sous-projets livrés.**
```

- [ ] **Step 21: Sanity check**

Visuellement inspecter :
- La section `## Analytics` est bien entre `## CV` et `## Migration depuis le backend Hono`
- Le tableau d'endpoints rend correctement
- Le lien spec pointe vers `2026-04-26-analytics-design.md`
- Tous les items 1-11 ✅
- Mention "Migration terminée" ajoutée

- [ ] **Step 22: Final check global**

```bash
pnpm lint && pnpm build && pnpm test
```

Expected: tout passe. ~260 tests verts.

- [ ] **Step 23: Commit final**

```bash
git add scripts/run-analytics-aggregator.ts README.md
git commit -m "docs(analytics): script standalone aggregator + README — migration Hono → NestJS terminée 🎉"
```

---

## Critères de done globaux (rappel du spec § 13)

Le sous-projet est terminé quand :

1. ✅ 3 tables Drizzle + migration `0006`, 7 indexes + 1 unique constraint sur `daily_stat.date` — Task 1
2. ✅ DTOs `TrackEventDto`, `DateRangeQueryDto`, `MetricsQueryDto` validés — Task 2
3. ✅ `AnalyticsTrackerService.track` : bot filter, session hash, UA parse, géoloc, INSERT/UPDATE branching, error swallowing — Task 3
4. ✅ `AnalyticsStatsService` : 7 méthodes, SQL agrégés DB-side, agrégation live pour today — Task 4
5. ✅ `AnalyticsAggregatorService` : `@Cron('0 0 * * *', { timeZone: 'UTC' })`, UPSERT idempotent, purge 30j, `manualRun` exposé — Task 5
6. ✅ Controller : 8 endpoints, throttle 10/sec sur `POST /track`, `JwtAuthGuard` sur les 7 GET, Swagger — Task 6
7. ✅ `ScheduleModule.forRoot()` ajouté dans `AppModule` + `trust proxy` dans `main.ts` — Task 6
8. ✅ ~25 nouveaux tests verts, total projet ~260 — Tasks 3+4+5
9. ✅ Build prod + lint + e2e manuel propres — Task 6 step 5/8 + Task 7
10. ✅ Vérification e2e manuelle complète + script standalone aggregator — Task 7
11. ✅ README mis à jour, item 11 ✅, **migration 100% terminée** 🎉 — Task 7
