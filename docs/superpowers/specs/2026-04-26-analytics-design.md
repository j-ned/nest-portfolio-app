# Analytics — Design (NestJS)

> **Sous-projet 11/11** (dernier) du backend NestJS. Migre l'`analytics` du backend Hono `angular-portfolio-app/server` (référence : `services/analytics-tracker.ts`, `routes/analytics.ts`, `lib/cron.ts`, `db/schema/analytics.ts`).

## 1. Objectif

Capturer les page-views et events custom du portfolio public, agréger en stats quotidiennes via cron nocturne, exposer 8 endpoints (1 public POST + 7 admin GET) pour alimenter le dashboard admin Angular existant.

## 2. Périmètre

**Inclus** :
- 3 tables : `page_view`, `analytics_event`, `daily_stat`
- 1 endpoint public `POST /analytics/track` (page-views + events custom)
- 7 endpoints admin `GET /analytics/stats/*` (overview, chart, metrics, active, projects, articles, cv-downloads)
- Cron quotidien 00:00 UTC : agrégation J-1 + purge 30j sur les events bruts
- Bot filter (lib `isbot`), UA parsing (`ua-parser-js`), géoloc IP (`geoip-lite`)
- Session hash déterministe : `SHA256(IP + User-Agent + YYYY-MM-DD)` — pas de cookies
- Throttle `10 req/sec/IP` sur `POST /track`

**Exclus (YAGNI)** :
- Cookies / consentement RGPD côté backend (responsabilité front Angular)
- Export CSV/JSON (peut être ajouté ultérieurement)
- Dashboard temps réel (websockets) — `/stats/active` suffit
- Soft-delete sur les tables analytics (hard delete via cron purge)
- Multi-tenant ou multi-site (mono-portfolio)
- Tracking des erreurs front (Sentry-like) — autre responsabilité

## 3. Stack technique

| Bibliothèque | Rôle |
|---|---|
| `@nestjs/schedule` | Cron decorators (`@Cron('0 0 * * *', { timeZone: 'UTC' })`) |
| `geoip-lite` (+ `@types/geoip-lite`) | Lookup IP → pays (offline, DB MaxMind embarquée ~22MB) |
| `ua-parser-js` (+ `@types/ua-parser-js`) | Parse User-Agent → browser, OS |
| `isbot` | Filtre crawlers (Googlebot, Bingbot, etc.) |
| `node:crypto` (built-in) | SHA256 pour session hash |
| `date-fns` (déjà installé) | Formatage et calculs de dates |

Toutes les autres deps (Drizzle, NestJS, Throttler, JwtAuthGuard, `class-validator`, Swagger) sont déjà en place.

## 4. Architecture

```
src/analytics/
├── analytics.module.ts                 // imports [AuthModule], providers + controller
├── analytics.controller.ts             // 8 endpoints, JwtAuthGuard sur les 7 GET
├── analytics-tracker.service.ts        // POST /track logic (write-path)
├── analytics-stats.service.ts          // 7 GET /stats/* (read-path, SQL agrégés)
├── analytics-aggregator.service.ts     // cron J-1 → daily_stat + purge 30j
├── dto/
│   ├── track-event.dto.ts
│   └── date-range-query.dto.ts
├── analytics-tracker.service.spec.ts   // ~10 tests
├── analytics-stats.service.spec.ts     // ~10 tests
└── analytics-aggregator.service.spec.ts // ~5 tests
```

**Responsabilité par service** :
- **Tracker** : 1 méthode publique `track(dto, req)` — extract IP/UA, filtre bot, hash session, UA parse, géoloc, branch INSERT/UPDATE selon page-view vs custom event. Fire-and-forget côté controller.
- **Stats** : 7 méthodes lecture (1 par endpoint), DB-side aggregation via Drizzle (`count`, `countDistinct`, `groupBy`, `desc`, `limit`).
- **Aggregator** : 2 méthodes — `aggregateYesterday()` (cron) + `manualRun(date)` (utilisé en e2e). UPSERT idempotent sur `daily_stat.date` + DELETE > 30j.

**Aucun lien fort** entre les 3 services : ils partagent uniquement la table `daily_stat` (Aggregator écrit, Stats lit) et les 2 tables raw (Tracker écrit, Stats lit, Aggregator lit puis purge).

## 5. Schéma DB

### `page_view` (events bruts)

```typescript
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const pageView = pgTable(
  'page_view',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
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
```

### `analytics_event` (events custom)

```typescript
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const analyticsEvent = pgTable(
  'analytics_event',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
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
```

### `daily_stat` (rollup quotidien)

```typescript
import {
  pgTable,
  uuid,
  date,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const dailyStat = pgTable(
  'daily_stat',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
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

**Notes** :
- Pas de FK : les tables sont indépendantes, liées seulement par `session_hash` (champ texte, non unique)
- Pas de colonne `is_bot` : les bots sont filtrés en amont (no INSERT)
- Pas de `createdAt`/`updatedAt` cohérents partout : `daily_stat` a les deux, les events bruts juste `createdAt`
- Migration : `drizzle/0006_<random>.sql` (3 CREATE TABLE + 7 indexes + 1 unique constraint sur `daily_stat.date`)

## 6. DTOs

### `TrackEventDto`

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
  @ApiProperty({ description: 'Path uniquement (ex: /projects/foo)', maxLength: 2048 })
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
  @IsIn(ANALYTICS_EVENT_TYPES as unknown as string[])
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

### `DateRangeQueryDto`

Partagé par tous les `GET /stats/*`.

```typescript
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DateRangeQueryDto {
  @ApiPropertyOptional({ format: 'date', description: 'Default = il y a 30 jours' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Default = aujourd\'hui' })
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
```

`limit` n'est utilisé que par `metrics`, `projects`, `articles`. Mais le mettre dans le DTO partagé est plus simple (les autres ignorent simplement le champ). Default `limit = 20`.

### `MetricsQueryDto extends DateRangeQueryDto`

Spécifique à `/stats/metrics` car ajoute `type` :

```typescript
export class MetricsQueryDto extends DateRangeQueryDto {
  @IsIn(['url', 'referrer', 'browser', 'country', 'os'])
  type!: 'url' | 'referrer' | 'browser' | 'country' | 'os';
}
```

## 7. Endpoints

### `POST /analytics/track` (public)

- **Throttle** : `@Throttle({ default: { limit: 10, ttl: 1000 } })` — 10 req/sec/IP
- **Auth** : aucune
- **Input** : `TrackEventDto` (JSON body)
- **Logic** :
  1. Extract `req.ip` (Express trust proxy déjà configuré pour X-Forwarded-For), header `User-Agent`
  2. `if (isbot(ua)) return;` — silent skip 204
  3. `sessionHash = sha256(`${ip}|${ua}|${YYYY-MM-DD UTC}`).digest('hex')`
  4. UA parsing : `const r = new UAParser(ua).getResult(); browser = r.browser.name + ' ' + r.browser.version; os = r.os.name + ' ' + r.os.version;` (gère `undefined` → `null`)
  5. Géoloc : `country = geoip.lookup(ip)?.country ?? null`
  6. Branch :
     - **Page-view** (`eventType` absent) :
       - SELECT `page_view` WHERE `session_hash = ? AND url = ? AND created_at >= today_00h_UTC` LIMIT 1
       - Existe : `UPDATE` avec `duration += dto.duration ?? 0` (cumul)
       - Sinon : `INSERT` (`session_hash, url, referrer, browser, os, country, duration`)
     - **Custom event** (`eventType` présent) :
       - INSERT `analytics_event` (`session_hash, event_type, entity_id, entity_title, metadata`)
- **Response** : `204 No Content` (toujours, même si filtré bot ou erreur silencieuse interne — le client ne doit pas être bloqué par le tracking)
- **Error handling** : try/catch interne, log via `Logger.error` mais ne propage pas l'erreur. Le tracking ne doit jamais 500 le client.

### `GET /analytics/stats/overview` (admin)

- **Auth** : `JwtAuthGuard`
- **Query** : `DateRangeQueryDto` (default 30 derniers jours)
- **Response** :
  ```typescript
  {
    totalVisitors: number;       // countDistinct page_view.session_hash
    totalPageviews: number;      // count page_view
    totalSessions: number;       // countDistinct (= visitors par jour, mais col historique)
    bounceRate: number;          // % (sessions avec 1 seul page-view) / total sessions, 0-100, arrondi 2 décimales
    avgDuration: number;         // AVG(duration) seconds, NULL → 0
    projectClicks: number;       // count analytics_event WHERE event_type='project_click'
    articleViews: number;
    cvDownloads: number;
  }
  ```

### `GET /analytics/stats/chart` (admin)

- **Auth** : `JwtAuthGuard`
- **Query** : `DateRangeQueryDto`
- **Response** :
  ```typescript
  {
    data: Array<{
      date: string;       // 'YYYY-MM-DD'
      visitors: number;
      pageviews: number;
    }>
  }
  ```
- **Source** : SELECT `daily_stat` WHERE `date BETWEEN from AND to` ORDER BY date ASC. **Si `to` = aujourd'hui** : ajoute une row live agrégée à partir de `page_view` filtré sur today.

### `GET /analytics/stats/metrics?type=...` (admin)

- **Auth** : `JwtAuthGuard`
- **Query** : `MetricsQueryDto` (`type` requis, range optionnel)
- **Response** :
  ```typescript
  {
    type: 'url' | 'referrer' | 'browser' | 'country' | 'os';
    data: Array<{ value: string; count: number }>;
  }
  ```
- **Source** : SELECT `<type>, count(*)` FROM `page_view` WHERE `created_at BETWEEN from AND to AND <type> IS NOT NULL` GROUP BY `<type>` ORDER BY count DESC LIMIT `limit`.

### `GET /analytics/stats/active` (admin)

- **Auth** : `JwtAuthGuard`
- **Query** : aucun
- **Response** :
  ```typescript
  {
    count: number;                                  // countDistinct session_hash WHERE created_at > NOW() - 5 min
    pages: Array<{ url: string; count: number }>;   // top URLs viewed in last 5 min
  }
  ```

### `GET /analytics/stats/projects?limit=20` (admin)

- **Auth** : `JwtAuthGuard`
- **Query** : `DateRangeQueryDto`
- **Response** :
  ```typescript
  {
    data: Array<{
      entityId: string;
      entityTitle: string;
      count: number;
    }>
  }
  ```
- **Source** : SELECT `entity_id, entity_title, count(*)` FROM `analytics_event` WHERE `event_type = 'project_click' AND created_at BETWEEN from AND to` GROUP BY `entity_id, entity_title` ORDER BY count DESC LIMIT `limit`.

### `GET /analytics/stats/articles?limit=20` (admin)

Même structure que `/projects` mais `event_type = 'article_view'`.

### `GET /analytics/stats/cv-downloads` (admin)

- **Auth** : `JwtAuthGuard`
- **Query** : `DateRangeQueryDto`
- **Response** :
  ```typescript
  {
    total: number;
    timeline: Array<{ date: string; count: number }>;  // 30 derniers jours
  }
  ```

## 8. Cron `AnalyticsAggregatorService`

```typescript
@Injectable()
export class AnalyticsAggregatorService {
  private readonly logger = new Logger(AnalyticsAggregatorService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Cron('0 0 * * *', { timeZone: 'UTC' })
  async aggregateYesterday(): Promise<void> {
    const yesterday = subDays(new Date(), 1);
    await this.runAggregation(yesterday);
    await this.purgeOldRawEvents();
  }

  // Appelé en e2e pour tester sans attendre minuit
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

  private async computeAggregates(start: Date, end: Date) {
    // 8 sub-queries en parallèle (Promise.all) sur page_view + analytics_event filtrées par created_at
    // Renvoie { visitors, pageviews, sessions, bounces, totalDuration, projectClicks, articleViews, cvDownloads }
  }

  private async purgeOldRawEvents(): Promise<void> {
    const cutoff = subDays(new Date(), 30);
    await this.db.delete(pageView).where(lt(pageView.createdAt, cutoff));
    await this.db.delete(analyticsEvent).where(lt(analyticsEvent.createdAt, cutoff));
    this.logger.log(`Purged page_view + analytics_event older than ${cutoff.toISOString()}`);
  }
}
```

**Idempotence** : `onConflictDoUpdate` sur `date` UNIQUE → rerun = même résultat (sauf `updatedAt` qui bouge).

**Bounce computation** : sub-query — sessions avec exactement 1 row dans `page_view` ce jour-là :
```sql
SELECT COUNT(*) FROM (
  SELECT session_hash FROM page_view
  WHERE created_at >= $start AND created_at < $end
  GROUP BY session_hash
  HAVING COUNT(*) = 1
) AS bounced_sessions
```

## 9. Tests (~25)

### `analytics-tracker.service.spec.ts` (~10 tests)

Mock : `createMockDb()` + `jest.mock('geoip-lite')` + `jest.mock('isbot')` + jest fake timers (pour fixer date dans le hash).

1. `track()` page-view : INSERT `page_view` avec session hash déterministe
2. Bot UA → skip silencieusement (no DB call)
3. Page-view sur même `(session, url, day)` existant → UPDATE duration (somme)
4. Page-view sur même session, URL différente → 2e INSERT (pas UPDATE)
5. `eventType: 'project_click'` → INSERT `analytics_event`, pas `page_view`
6. UA inconnu → `browser = null, os = null` (pas crash)
7. IP locale (127.0.0.1) → `country = null` (pas crash sur geoip miss)
8. Session hash : 2 calls même IP+UA+jour → même hash
9. Session hash : 2 calls même IP+UA mais 2 jours différents → hash différent
10. Erreur DB pendant INSERT → log + retourne 204 (pas de propagation)

### `analytics-stats.service.spec.ts` (~10 tests)

Mock : `createMockDb()`. Pas de geoip/isbot ici.

1. `overview()` : agrégation correcte des 8 champs (1 test global)
2. `overview()` : `bounceRate = 0` quand pas de sessions
3. `overview()` : `avgDuration` = 0 si tous null
4. `chart()` : retourne rows `daily_stat` triées par date
5. `chart()` : si `to = today`, append live row
6. `metrics()` : top N par `type`, exclut NULL values
7. `metrics()` : `limit` cap à 100 (depuis DTO @Max(100))
8. `active()` : compte sessions des 5 dernières minutes
9. `projects()` / `articles()` : filtre `event_type` correct + LIMIT
10. `cvDownloads()` : timeline 30 jours, group by `DATE(created_at)`

### `analytics-aggregator.service.spec.ts` (~5 tests)

Mock : `createMockDb()` + jest fake timers.

1. `aggregateYesterday()` : insert avec date = J-1
2. Idempotence : 2 runs = 1 row (UPSERT path)
3. `purgeOldRawEvents()` : DELETE WHERE created_at < NOW() - 30j (sur les 2 tables)
4. `manualRun(date)` : agrège la date passée (pas J-1)
5. Log line émise (jest spy sur `logger.log`)

## 10. E2E manuel (Task 7)

15 steps couvrent :
1. POST /track page-view → 204, row insérée
2. POST /track 2e fois même session+URL → duration cumulée
3. POST /track avec eventType='project_click' → analytics_event INSERT
4. POST /track avec UA Googlebot → 204, **pas** de row insérée
5. POST /track avec URL > 2048 chars → 400
6. GET /stats/* sans auth → 401 (sur les 7 endpoints)
7. Login admin
8. GET /stats/overview → totaux non-zéro
9. GET /stats/chart → time-series live (today)
10. GET /stats/metrics?type=url → top URLs
11. GET /stats/active → 1+ session
12. GET /stats/projects → 1 click recordé
13. Trigger manuel `aggregator.manualRun(yesterday)` via script ou route debug → vérifier `daily_stat` row créée
14. Re-run aggregator même date → row mise à jour, pas dupliquée (UPSERT)
15. Verify cron schedule via logs au boot

## 11. Configuration

**Aucune nouvelle env var** :
- `geoip-lite` lit la DB embarquée du package node_modules
- `isbot` est offline
- Le cron utilise UTC en dur (pas configurable)

**Throttle** : override sur `POST /track` uniquement, le reste suit le default global (10 req / 60s).

## 12. Sécurité & privacy

- **Pas de cookies** posés ou lus côté backend
- **Pas de stockage d'IP** : l'IP est utilisée uniquement pour calculer le hash + lookup pays, jamais persistée
- **Pas de stockage de User-Agent brut** : on persiste seulement `browser`/`os` parsés
- Session hash non-réversible (SHA256 + grain journalier)
- Bots filtrés à l'entrée → pas pollués stats

## 13. Critères de done

1. ✅ 3 tables Drizzle + migration `0006`, 7 indexes + 1 unique constraint sur `daily_stat.date`
2. ✅ DTOs `TrackEventDto`, `DateRangeQueryDto`, `MetricsQueryDto` validés via `class-validator`
3. ✅ `AnalyticsTrackerService.track` : bot filter, session hash, UA parse, géoloc, INSERT/UPDATE branching, error swallowing
4. ✅ `AnalyticsStatsService` : 7 méthodes, SQL agrégés DB-side, agrégation live pour today
5. ✅ `AnalyticsAggregatorService` : `@Cron('0 0 * * *', { timeZone: 'UTC' })`, UPSERT idempotent, purge 30j, `manualRun` exposé
6. ✅ Controller : 8 endpoints, throttle 10/sec sur `POST /track`, `JwtAuthGuard` sur les 7 GET, Swagger annotations
7. ✅ `ScheduleModule.forRoot()` ajouté dans `AppModule`
8. ✅ ~25 nouveaux tests verts, total projet ~260
9. ✅ Build prod + lint + e2e manuel propres
10. ✅ README mis à jour : section `## Analytics`, item 11 ✅, **migration 100% terminée** 🎉

## 14. Décomposition en tasks

| Task | Contenu | Tests |
|---|---|---|
| 1 | Schéma DB (3 tables) + barrel + migration `0006` | 0 |
| 2 | DTOs (`TrackEventDto`, `DateRangeQueryDto`, `MetricsQueryDto`) | 0 |
| 3 | `AnalyticsTrackerService` + tests TDD | ~10 |
| 4 | `AnalyticsStatsService` + tests TDD | ~10 |
| 5 | `AnalyticsAggregatorService` + tests TDD | ~5 |
| 6 | Controller + Module + AppModule wiring + ScheduleModule | 0 |
| 7 | E2E manuel + README + clôture migration | 0 |

**Total : 7 tasks, ~25 tests, ~3-4h de travail subagent-driven.**
