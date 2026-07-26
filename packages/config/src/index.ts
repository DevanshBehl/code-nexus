import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Walk up from the current working directory to find the monorepo-root `.env`
 * (the directory containing `pnpm-workspace.yaml`). This makes config loading
 * work no matter which package directory a process is launched from (Turbo runs
 * each task with its own package as cwd).
 */
function findRootEnvPath(startDir: string = process.cwd()): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      const envPath = join(dir, '.env');
      return existsSync(envPath) ? envPath : undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Single source of environment configuration for every Node service.
 *
 * Rules (see prompt_phase1.md §3.1):
 *  - Nothing outside this package reads `process.env` directly.
 *  - Every consumer calls `loadConfig()` at boot.
 *  - Invalid/missing required vars => throw a readable error and fail fast.
 */

/** Treat blank env values (`FOO=`) as unset so `.optional()`/`.default()` apply. */
const emptyToUndefined = (v: unknown): unknown => (v === '' ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // API
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Postgres (required — the api cannot run without it)
  DATABASE_URL: z.string().url(),

  // Redis (required from Phase 2 — backs sessions; api fails fast if unreachable)
  REDIS_URL: z.string().url(),

  // Auth / sessions (Phase 2)
  SESSION_COOKIE_SECRET: z.string().min(16, 'SESSION_COOKIE_SECRET must be at least 16 chars'),
  SESSION_ABSOLUTE_TTL_SECONDS: z.coerce.number().int().positive().default(604800), // 7 days
  SESSION_IDLE_TTL_SECONDS: z.coerce.number().int().positive().default(86400), // 24 hours
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),

  // Web origin(s) allowed to call the API cross-origin with credentials (Phase 3).
  // Comma-separated. In dev the Vite proxy makes calls same-origin, so this is
  // only needed when web and api are served on different origins.
  WEB_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // Reserved for later phases — optional in Phase 1 so the api boots without them.
  RABBITMQ_URL: z.string().optional(),

  // Code Arena / execution (Phase 6). All optional so the api + worker boot
  // without them; the worker degrades gracefully if the engine is unreachable.
  //
  // EXECUTION_ENGINE selects how the worker runs code:
  //   'piston' — Piston REST (self-hosted; public API is whitelist-only)  [PISTON_URL]
  //   'judge0' — Judge0 REST (self-hosted or RapidAPI)  [JUDGE0_URL + key/host]
  //   'local'  — run on THIS machine under a macOS sandbox (sandbox-exec + ulimit
  //             + timeout). DEMO/DEV ONLY — not a production-grade sandbox.
  EXECUTION_ENGINE: z.enum(['judge0', 'piston', 'local']).default('judge0'),
  // Blank env values (e.g. `JUDGE0_URL=`) are treated as unset, not invalid URLs.
  PISTON_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default('https://emkc.org/api/v2/piston'),
  ),
  JUDGE0_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  JUDGE0_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  JUDGE0_API_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
  ARENA_QUEUE: z.string().default('arena.submissions'),
  ARENA_CPU_TIME_LIMIT: z.coerce.number().positive().default(5), // seconds per testcase
  ARENA_MEMORY_LIMIT_KB: z.coerce.number().int().positive().default(256_000), // 256 MB
  ARENA_WALL_TIME_LIMIT: z.coerce.number().positive().default(10), // seconds per testcase
  ARENA_MAX_INFLIGHT: z.coerce.number().int().positive().default(3), // per-student in-flight submissions
  ARENA_WORKER_PREFETCH: z.coerce.number().int().positive().default(2),
  S3_ENDPOINT: z.preprocess(emptyToUndefined, z.string().url().optional()),
  S3_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_BUCKET: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_REGION: z.preprocess(emptyToUndefined, z.string().default('us-east-1')),

  // ---- Interview recording (Phase 10) --------------------------------------
  // Storage is pluggable and infra-free by default, mirroring EXECUTION_ENGINE
  // and MEDIA_PROVIDER: 'local' writes chunks to disk and streams them back
  // through an authenticated api route; 's3' targets the S3_* config above
  // (MinIO in dev — already in docker-compose — or real AWS, same code path).
  RECORDING_STORAGE: z.enum(['local', 's3']).default('local'),
  RECORDING_LOCAL_DIR: z.string().default('.data/recordings'),
  // Per-chunk cap. MediaRecorder timeslices are small; this is abuse protection,
  // not a tuning knob. 8 MB comfortably fits a 5s slice of 1080p.
  RECORDING_MAX_CHUNK_BYTES: z.coerce.number().int().positive().default(8_388_608),
  // Whole-recording cap (~2 GB) so one room cannot fill the disk/bucket.
  RECORDING_MAX_TOTAL_BYTES: z.coerce.number().int().positive().default(2_147_483_648),
  // How long a minted playback URL stays valid.
  RECORDING_URL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  // Retention horizon for the documented cleanup story (0 = keep forever).
  RECORDING_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),

  // Webinars / real-time plane (Phase 8). The ws-gateway is a separate process;
  // the api mints RT tokens the gateway verifies with the SAME RT_TOKEN_SECRET.
  WS_GATEWAY_PORT: z.coerce.number().int().positive().default(4100),
  // Public ws:// URL the browser connects to (the gateway's /ws endpoint). In dev
  // the client talks straight to the gateway port.
  WS_GATEWAY_PUBLIC_URL: z.string().default('ws://localhost:4100/ws'),
  RT_TOKEN_SECRET: z
    .string()
    .min(16, 'RT_TOKEN_SECRET must be at least 16 chars')
    // Dev/test default so the api + gateway boot without extra setup; override in prod.
    .default('dev-rt-token-secret-change-me'),
  RT_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  // Media plane. 'stub' = no media server (room works, placeholder player);
  // 'selfhosted' = an RTMP->HLS server the host pushes to (OBS) + viewers play HLS.
  MEDIA_PROVIDER: z.enum(['stub', 'selfhosted']).default('stub'),
  // RTMP ingest base (host pushes here) + HLS playback base (viewers pull here).
  RTMP_INGEST_BASE: z.preprocess(emptyToUndefined, z.string().default('rtmp://localhost:1935')),
  HLS_PLAYBACK_BASE: z.preprocess(emptyToUndefined, z.string().default('http://localhost:8888')),

  // Interviews / WebRTC (Phase 9). Media is peer-to-peer; the api only hands out
  // ICE servers. STUN is always present (default public). TURN is optional (for
  // real NAT traversal) — set all three to enable it. No SFU (peers mesh directly).
  RTC_STUN_URLS: z
    .string()
    .default('stun:stun.l.google.com:19302')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  RTC_TURN_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  RTC_TURN_USERNAME: z.preprocess(emptyToUndefined, z.string().optional()),
  RTC_TURN_CREDENTIAL: z.preprocess(emptyToUndefined, z.string().optional()),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

let cached: AppConfig | undefined;

export interface LoadConfigOptions {
  /** When true, re-reads and re-validates instead of returning the cache. */
  reload?: boolean;
  /** Override source (used in tests). Defaults to `process.env`. */
  source?: NodeJS.ProcessEnv;
}

/**
 * Load, validate, and cache configuration. Throws a formatted, human-readable
 * error listing every offending variable if validation fails.
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  if (cached && !options.reload && !options.source) {
    return cached;
  }

  // Load the monorepo-root .env into process.env (no-op if vars already set).
  // Falls back to dotenv's default (cwd) if the root can't be located.
  if (!options.source) {
    const rootEnv = findRootEnvPath();
    loadDotenv(rootEnv ? { path: rootEnv } : undefined);
  }

  const source = options.source ?? process.env;
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration. Fix the following and retry ` +
        `(see .env.example):\n${issues}`,
    );
  }

  const value = Object.freeze(parsed.data);
  if (!options.source) {
    cached = value;
  }
  return value;
}

/** Test-only helper to clear the module-level cache. */
export function resetConfigCache(): void {
  cached = undefined;
}
