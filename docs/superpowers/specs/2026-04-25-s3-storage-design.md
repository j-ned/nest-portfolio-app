# S3 Storage — Design

| | |
|---|---|
| **Date** | 2026-04-25 |
| **Statut** | Approuvé (sections), en attente de relecture finale |
| **Périmètre** | Sous-projet "S3 Storage" du chantier de migration Hono → NestJS |
| **Projet cible** | `/home/jned/WebstormProjects/J-Ned/nest-portfolio-app` |
| **Spec précédents** | Fondations, Auth, Profile public |

---

## 1. Contexte & motivation

Les sous-projets Fondations, Auth et Profile public sont terminés. Il reste 7 sous-projets pour atteindre la parité fonctionnelle avec le backend Hono. Plusieurs de ces sous-projets ont besoin de stocker des fichiers (Projects → image projet, CV → PDF téléchargeable, Avatar Profile → photo de profil). Le backend Hono utilise **Garage** (S3-compatible) sur un VPS, accédé via le SDK officiel `@aws-sdk/client-s3`.

Plutôt que d'implémenter le S3 en même temps que Projects (ce qui ferait un sous-projet trop large), on **isole l'infrastructure S3 dans un sous-projet dédié**. Ce sous-projet livre un module NestJS `@Global` exposant un `StorageService` générique réutilisable par tous les feature modules futurs.

L'utilisateur a son **prod sur Garage VPS**. Pour le dev local, on utilise **MinIO** (S3-compatible) via container Podman, configuré identiquement (mêmes APIs, juste l'endpoint change). Le code NestJS est portable sans branche.

## 2. Scope

### Inclus

- **`StorageModule`** `@Global` exposant le service.
- **`StorageService`** générique : `upload`, `get`, `delete`, `list`, `getPublicUrl` (5 méthodes).
- **`S3_CLIENT`** injection token (Symbol) avec provider factory créant le `S3Client` depuis `AppConfigService`.
- **`OnModuleDestroy`** qui appelle `s3.destroy()` (cleanup keep-alive HTTP).
- **`compose.yaml` étendu** : services `minio` (S3-compatible) + `minio-init` (création bucket `portfolio-storage` + politique anonymous-read).
- **5 nouvelles env vars** (`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_URL`).
- **5 getters** dans `AppConfigService`.
- **Tests unitaires** (~9) sur `StorageService` via `aws-sdk-client-mock`.
- **Scripts pnpm** : `s3:up`, `s3:down`, `s3:logs`, `s3:console`, `s3:reset`. Extension `predev`.
- **Mise à jour README** : section "S3 Storage" avec API + usage + config prod.

### Explicitement exclus

- **Aucun controller HTTP** : pas d'endpoint `/upload`, `/storage/...`, etc. La couche HTTP appartient aux feature modules métier (Projects, CV, Avatar futur).
- **Aucune logique métier** : pas de validation taille/MIME, pas de naming convention. Chaque feature module fait sa validation et calcule sa key.
- **Pas de support Stream** : `upload(body: Buffer)` et `get(): Buffer`. OK pour images <5MB. Stream serait over-engineering.
- **Pas de signed URLs** (`getSignedDownloadUrl(...)`) : YAGNI tant que tous les assets sont publics. À ajouter le jour où un feature module a besoin d'assets privés.
- **`/health` ne teste pas S3** : reste sur le test DB minimaliste de Fondations. Si S3 est down, un upload futur échouera proprement, c'est suffisant.
- **Pas de tests d'intégration MinIO** dans ce sous-projet : validation e2e remontée au sous-projet **Projects** (premier consommateur réel).
- **Pas de configuration CORS dans le init container** (MinIO autorise tout par défaut en dev). En prod sur Garage, à configurer manuellement (documenté dans le README).
- **Pas de lifecycle/versioning** : à configurer manuellement sur Garage prod si besoin.
- **Bucket Garage prod non automatisé** : ce sous-projet ne touche pas à la config Garage. C'est l'admin qui crée le bucket sur le VPS et ajuste les ACLs.

## 3. Architecture & graphe de modules

```
┌──────────────────────────────────────────────────────────────┐
│ AppModule (existant après Profile public)                    │
│                                                              │
│  Imports actuels :                                           │
│   ├── ConfigModule + AppConfigModule                         │
│   ├── LoggerModule (Pino)            ← @Global               │
│   ├── DatabaseModule                  ← @Global              │
│   ├── HealthModule                                           │
│   ├── AuthModule                                             │
│   └── 7 modules Profile public                               │
│                                                              │
│  AJOUT de ce sous-projet :                                   │
│   └── StorageModule                   ← @Global              │
│         providers: S3_CLIENT (Symbol → S3Client via factory) │
│                    StorageService                            │
│         exports:   StorageService                            │
└──────────────────────────────────────────────────────────────┘
```

### Principes

- **`StorageModule` est `@Global`** : calque exact `DatabaseModule`. Une fois importé dans `AppModule`, tout feature module futur peut injecter `StorageService` sans `imports: [StorageModule]`.
- **`S3_CLIENT` injection token (Symbol)** : calque exact `DRIZZLE`. Le client `S3Client` créé une seule fois via `useFactory` qui inject `AppConfigService`.
- **`StorageService` exporté** (pas le client direct) : abstraction propre, les consumers utilisent l'API NestJS-friendly.
- **Pas de controller HTTP** : `StorageService` est purement consommé par d'autres services.
- **Pas d'interaction DB** : pure couche I/O réseau S3.
- **`OnModuleDestroy`** : cleanup keep-alive HTTP via `s3.destroy()` sur SIGTERM.

## 4. Arborescence des fichiers

```
src/
├── app.module.ts                       # MODIFIÉ : +StorageModule
│
├── config/                              # MODIFIÉ : +5 env vars
│   ├── env.schema.ts                   # +S3_*
│   ├── env.validation.spec.ts          # +tests
│   ├── app-config.service.ts           # +5 getters
│   └── app-config.module.ts            # INCHANGÉ
│
├── (autres modules — INCHANGÉS)
│
└── storage/                            # NEW
    ├── storage.module.ts               # @Global, OnModuleDestroy
    ├── storage.service.ts              # 5 méthodes
    ├── storage.service.spec.ts         # ~9 tests (aws-sdk-client-mock)
    ├── s3.constants.ts                 # S3_CLIENT = Symbol(...)
    └── storage.types.ts                # interface S3Object

compose.yaml                            # MODIFIÉ : +minio + minio-init
.env.example                            # MODIFIÉ : +5 env vars
package.json                            # MODIFIÉ : +deps + scripts s3:*
```

### Notes structurelles

- `src/storage/` calque exactement `src/database/` (`module.ts`, `service.ts`, `service.spec.ts`, `constants.ts`, `types.ts`). Pas de DTO (pas d'endpoint HTTP).
- `compose.yaml` final : 3 services (`postgres`, `minio`, `minio-init`).
- Volume MinIO `portfolio_nest_minio_data` séparé du volume Postgres.
- MinIO ports : `9000` (API S3), `9001` (console web). Pas de conflit avec Postgres `55432` ni NestJS `3000`.

## 5. Configuration

### Env vars

5 nouvelles variables. Toutes requises sauf `S3_PUBLIC_URL` (défaut intelligent).

| Variable | Type | Défaut | Rôle |
|---|---|---|---|
| `S3_ENDPOINT` | URL `http(s)://...` | *(requis)* | Endpoint S3 (`http://localhost:9000` en dev MinIO, `https://garage-s3.j-ned.dev` en prod) |
| `S3_REGION` | string min 1 | *(requis)* | Région S3 (`us-east-1` MinIO, `garage` Garage) |
| `S3_ACCESS_KEY` | string min 4 | *(requis)* | Access key |
| `S3_SECRET_KEY` | string min 8 | *(requis)* | Secret key |
| `S3_PUBLIC_URL` | URL optionnelle | défaut = `S3_ENDPOINT` | URL externe pour `getPublicUrl()`. Permet CDN/nginx devant S3 sans toucher au code. |

### `env.schema.ts` étendu

```typescript
S3_ENDPOINT: z.string().url(),
S3_REGION: z.string().min(1),
S3_ACCESS_KEY: z.string().min(4),
S3_SECRET_KEY: z.string().min(8),
S3_PUBLIC_URL: z.string().url().optional(),
```

Et dans `validateEnv()`, après le défaut LOG_LEVEL :

```typescript
S3_PUBLIC_URL: result.data.S3_PUBLIC_URL ?? result.data.S3_ENDPOINT,
```

### `AppConfigService` étendu

```typescript
get s3Endpoint() { return this.config.get('S3_ENDPOINT', { infer: true }); }
get s3Region() { return this.config.get('S3_REGION', { infer: true }); }
get s3AccessKey() { return this.config.get('S3_ACCESS_KEY', { infer: true }); }
get s3SecretKey() { return this.config.get('S3_SECRET_KEY', { infer: true }); }
get s3PublicUrl() { return this.config.get('S3_PUBLIC_URL', { infer: true }); }
```

> Pas de getter `s3Bucket` : le bucket est passé en argument par les feature modules. Le bucket par défaut `portfolio-storage` est nommé en dur dans `compose.yaml` (init container) et dans le README pour la prod manuelle.

### `.env.example` étendu

```bash
# S3 — MinIO local en dev, Garage en prod
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=portfolio-admin
S3_SECRET_KEY=portfolio-admin-secret
# S3_PUBLIC_URL=  # défaut = S3_ENDPOINT. Override si CDN/nginx devant S3.
```

## 6. `compose.yaml` étendu

```yaml
services:
  postgres:
    # ... existant inchangé ...

  minio:
    image: docker.io/minio/minio:latest
    container_name: portfolio-nest-s3
    restart: unless-stopped
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: portfolio-admin
      MINIO_ROOT_PASSWORD: portfolio-admin-secret
    volumes:
      - portfolio_nest_minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:9000/minio/health/live"]
      interval: 5s
      timeout: 3s
      retries: 5

  minio-init:
    image: docker.io/minio/mc:latest
    container_name: portfolio-nest-s3-init
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      sh -c "
        mc alias set local http://minio:9000 portfolio-admin portfolio-admin-secret &&
        (mc mb local/portfolio-storage --ignore-existing) &&
        mc anonymous set download local/portfolio-storage &&
        echo 'MinIO bucket portfolio-storage ready (public-read).'
      "
    restart: "no"

volumes:
  portfolio_nest_pgdata:
  portfolio_nest_minio_data:
```

### Décisions clés

> **Pourquoi `minio:latest`** : MinIO publie ~hebdomadaire sans break compat S3. Pour ce projet, suffisant. Pin si tu veux la reproductibilité absolue.
>
> **Pourquoi `mc anonymous set download local/portfolio-storage`** : applique une bucket policy "anonymous read" — n'importe quel client peut `GET /portfolio-storage/...` sans auth, mais `PUT/DELETE` reste réservé aux clés admin. C'est ce qu'on veut pour servir des images publiquement (cf. ADR-5).
>
> **Pourquoi `restart: "no"` sur minio-init** : c'est un one-shot. Une fois la config appliquée, exit clean.
>
> **Pourquoi `--ignore-existing` sur `mc mb`** : idempotence. Le init container peut tourner plusieurs fois sans erreur.

## 7. Code détaillé

### `src/storage/s3.constants.ts`

```typescript
export const S3_CLIENT = Symbol('S3_CLIENT');
```

### `src/storage/storage.types.ts`

```typescript
export interface S3Object {
  key: string;
  size: number;
  lastModified: Date;
}
```

> Type custom (3 champs) plutôt que `_Object` raw du SDK : (1) pas de leak de la dépendance AWS SDK aux consumers ; (2) on peut switcher de SDK plus tard sans casser l'API.

### `src/storage/storage.service.ts`

```typescript
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import { AppConfigService } from '../config/app-config.service';
import { S3_CLIENT } from './s3.constants';
import type { S3Object } from './storage.types';

@Injectable()
export class StorageService {
  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly cfg: AppConfigService,
  ) {}

  async upload(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
  }

  async get(bucket: string, key: string): Promise<Buffer> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!res.Body) {
        throw new NotFoundException(`S3 object ${bucket}/${key} has empty body`);
      }
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err: unknown) {
      if (err instanceof NoSuchKey) {
        throw new NotFoundException(`S3 object ${bucket}/${key} not found`);
      }
      throw err;
    }
  }

  async delete(bucket: string, key: string): Promise<void> {
    // S3 DeleteObject est idempotent : pas d'erreur si la clé n'existe pas.
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async list(bucket: string, prefix?: string): Promise<S3Object[]> {
    const res = await this.s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
    }));
    return (res.Contents ?? []).map((o) => ({
      key: o.Key!,
      size: o.Size ?? 0,
      lastModified: o.LastModified ?? new Date(0),
    }));
  }

  getPublicUrl(bucket: string, key: string): string {
    const base = this.cfg.s3PublicUrl.replace(/\/$/, '');
    return `${base}/${bucket}/${encodeURIComponent(key)}`;
  }
}
```

### `src/storage/storage.module.ts`

```typescript
import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { S3_CLIENT } from './s3.constants';
import { StorageService } from './storage.service';

const s3ClientProvider: Provider = {
  provide: S3_CLIENT,
  inject: [AppConfigService],
  useFactory: (cfg: AppConfigService): S3Client =>
    new S3Client({
      endpoint: cfg.s3Endpoint,
      region: cfg.s3Region,
      credentials: {
        accessKeyId: cfg.s3AccessKey,
        secretAccessKey: cfg.s3SecretKey,
      },
      forcePathStyle: true,    // requis pour MinIO et Garage
    }),
};

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [s3ClientProvider, StorageService],
  exports: [StorageService],
})
export class StorageModule implements OnModuleDestroy {
  constructor(@Inject(S3_CLIENT) private readonly s3: S3Client) {}

  onModuleDestroy(): void {
    this.s3.destroy();
  }
}
```

## 8. Tests

### `src/storage/storage.service.spec.ts`

~9 tests via `aws-sdk-client-mock` (lib idiomatique pour mocker l'AWS SDK v3). Couvre :

- `upload` : émet `PutObjectCommand` avec les bons params
- `get` : retourne Buffer (success), throw `NotFoundException` si `NoSuchKey`, rethrow toute autre erreur
- `delete` : émet `DeleteObjectCommand` (idempotent)
- `list` : retourne `S3Object[]` (avec et sans `Contents`)
- `getPublicUrl` : construit URL avec encoding key, strip trailing slash de `s3PublicUrl`

```typescript
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client, PutObjectCommand, GetObjectCommand,
  DeleteObjectCommand, ListObjectsV2Command, NoSuchKey,
} from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import { Readable } from 'node:stream';
// ... (cf. section 5 du brainstorm pour le code complet)
```

### Pas de tests d'intégration MinIO

Validation e2e remontée au sous-projet **Projects** (premier vrai consommateur). Les tests de ce sous-projet vérifient la logique du service, pas la connectivité réseau S3.

## 9. Décisions d'architecture (ADRs résumés)

| # | Décision | Pourquoi |
|---|---|---|
| ADR-1 | 2 sous-projets séparés (S3 Storage seul, Projects ensuite) | Séparation infra / métier. S3 réutilisable par Projects, CV, Avatar. (Q1 → A) |
| ADR-2 | Container MinIO en dev (vs Garage distant) | Onboarding offline, pas de pollution VPS. (Q2 → A) |
| ADR-3 | API `StorageService` générique (`upload(bucket, key, body, mime)`) | Couche infra pure, pas de couplage métier. (Q3 → A) |
| ADR-4 | 1 seul bucket `portfolio-storage` avec préfixes | YAGNI sur la segmentation, ACL unique. Réversible. (Q4 → A+1bucket) |
| ADR-5 | URL directe S3 publique (bucket anonymous-read) | Pas de proxy backend, perf native S3. (Q5 → A) |
| ADR-6 | Lib `@aws-sdk/client-s3` v3 (calque Hono) | SDK officiel, compat Garage via `forcePathStyle: true`. |
| ADR-7 | 5 méthodes `upload/get/delete/list/getPublicUrl`. Pas de signed URL pour l'instant. | YAGNI tant que tout est public. |
| ADR-8 | `/health` ne teste PAS S3 | Garde minimaliste. Upload futur retournera 500 si S3 down. |
| ADR-9 | Tests : `aws-sdk-client-mock` | Idiomatique AWS SDK v3, rapide en CI. |
| ADR-10 | Body en `Buffer` (pas Stream) | Suffisant pour images <5MB. |
| ADR-11 | `StorageModule` `@Global` (calque DatabaseModule) | Évite le boilerplate `imports: [StorageModule]` partout. |
| ADR-12 | Token `S3_CLIENT` (Symbol), `StorageService` exporté | Calque `DRIZZLE` token. |
| ADR-13 | `OnModuleDestroy` + `s3.destroy()` | Calque cleanup postgres-js. |
| ADR-14 | Aucun controller HTTP dans ce sous-projet | Couche infra pure. |
| ADR-15 | Init container crée bucket + applique anonymous-read | Onboarding zéro friction. |
| ADR-16 | `S3_PUBLIC_URL` env var optionnelle (défaut = `S3_ENDPOINT`) | Permet CDN/nginx devant S3. |
| ADR-17 | `db:down`/`db:reset` ciblent `postgres` (vs tout le compose) | Symétrie avec `s3:down`/`s3:reset`. |
| ADR-18 | Pas de validation taille/MIME dans `StorageService` | Métier (chaque feature module a ses règles). |

## 10. Scripts pnpm finaux

```json
"s3:up": "podman compose up -d minio minio-init",
"s3:down": "podman compose stop minio minio-init",
"s3:logs": "podman compose logs -f minio",
"s3:console": "echo 'MinIO console: http://localhost:9001 (login: portfolio-admin / portfolio-admin-secret)'",
"s3:reset": "podman compose down -v minio minio-init && pnpm s3:up",
"predev": "pnpm db:up && pnpm db:wait && pnpm s3:up",
"db:down": "podman compose down postgres",
"db:reset": "podman compose down -v postgres && pnpm db:up && pnpm db:wait && pnpm db:migrate && pnpm db:seed",
```

> Modification notable : `db:down` et `db:reset` ciblent désormais le service `postgres` plutôt que tout le compose, par symétrie avec `s3:down`/`s3:reset`.

## 11. Critères de done

Le sous-projet S3 Storage est terminé quand toutes ces conditions sont vraies :

1. **Dépendances installées** : `@aws-sdk/client-s3` (prod), `aws-sdk-client-mock` + `@smithy/util-stream` (dev). `pnpm install` idempotent.
2. **Env vars étendues** : 5 nouvelles vars dans `env.schema.ts`, `validateEnv()` calcule défaut `S3_PUBLIC_URL = S3_ENDPOINT`, 5 getters dans `AppConfigService`. Boot fail-fast si une var manque.
3. **`compose.yaml` étendu** : services `minio` + `minio-init` opérationnels. `pnpm s3:up` démarre, le bucket `portfolio-storage` est créé en anonymous-read.
4. **`StorageModule` `@Global`** wiré dans `AppModule`. App boot OK, log montre `StorageModule dependencies initialized`.
5. **`StorageService`** : 5 méthodes avec comportements définis (404 sur `NoSuchKey`, idempotence delete, encoding URL).
6. **`OnModuleDestroy`** appelle `s3.destroy()` (vérifié manuellement : Ctrl+C ferme l'app sans hang).
7. **Tests** : ~9 nouveaux tests + tests env étendus, **tous verts** (~108 tests au total).
8. **Build prod** OK, lint clean.
9. **Vérification end-to-end manuelle** :
   ```bash
   pnpm s3:up
   curl -fsS http://localhost:9001          # console MinIO doit répondre 200
   # Via la console : créer un fichier test, vérifier qu'il apparaît dans bucket portfolio-storage
   curl http://localhost:9000/portfolio-storage/test.txt   # doit télécharger l'objet (anonymous read)
   ```
10. **README mis à jour** avec section "S3 Storage" : API + usage exemple + config prod Garage + mise à jour liste sous-projets (S3 Storage ✅, Projects prochain).

## 12. Hors scope (suite)

Une fois ce sous-projet terminé :

5. **Projects** (CRUD + endpoint upload `POST /projects/:slug/image` qui consomme `StorageService`) — sera le premier vrai consommateur du module.
6. **Avatar Profile** (revisitable — `POST /profile/avatar` qui consomme `StorageService`).
7. **Contact** (messages + mailer).
8. **Bookings** (réservations + mail confirmation).
9. **CV** (`POST /cv` + `GET /cv/download` qui consomment `StorageService`).
10. **Analytics**.
11. **Frontend Angular adaptation**.
