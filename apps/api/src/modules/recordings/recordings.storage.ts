import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { AppConfig } from '@code-nexus/config';
import type { Logger } from '@code-nexus/logger';

/**
 * Phase 10 — pluggable recording storage.
 *
 * Same philosophy as EXECUTION_ENGINE (Phase 6) and MEDIA_PROVIDER (Phase 8):
 * the default works with **no infrastructure at all**, and the "real" backend is
 * config-gated. `local` writes chunks to disk and streams them back through an
 * authenticated api route; `s3` targets the S3_* config — MinIO in dev (already
 * in docker-compose) or AWS in prod, byte-identical code.
 *
 * Nothing here inspects, parses, or transcodes media. It moves opaque bytes.
 */

export interface ByteRange {
  start: number;
  end: number;
}

export interface RecordingStorage {
  /** Backend name, for logs and the health/debug surface. */
  readonly kind: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getStream(key: string, range?: ByteRange): Promise<NodeJS.ReadableStream>;
  /** Total size in bytes, needed to answer Range requests correctly. */
  size(key: string): Promise<number>;
  delete(key: string): Promise<void>;
  /**
   * A short-lived playback URL, or `null` when this driver cannot mint one and
   * the api must stream the bytes itself (the `local` case).
   */
  signUrl(key: string, ttlSeconds: number): Promise<string | null>;
}

/** Build the storage key for one chunk. Stable, flat, and driver-agnostic. */
export function segmentKey(interviewPublicId: string, ordinal: number): string {
  return `recordings/${interviewPublicId}/${String(ordinal).padStart(6, '0')}.webm`;
}

// ---- local driver -----------------------------------------------------------

/**
 * Disk-backed storage. The default, so a developer can record and play back an
 * interview with nothing running but Postgres.
 */
class LocalRecordingStorage implements RecordingStorage {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(process.cwd(), rootDir);
  }

  /**
   * Resolve a key under the root, refusing anything that escapes it.
   * Keys are server-generated today, but this is the one place a traversal bug
   * would turn into arbitrary file read/write — so it is checked regardless.
   */
  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Refusing key outside the recording root: ${key}`);
    }
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.pathFor(key);
    await mkdir(dirname(file), { recursive: true });
    await pipeline(Readable.from(body), createWriteStream(file));
  }

  async getStream(key: string, range?: ByteRange): Promise<NodeJS.ReadableStream> {
    const file = this.pathFor(key);
    return range
      ? createReadStream(file, { start: range.start, end: range.end })
      : createReadStream(file);
  }

  async size(key: string): Promise<number> {
    return (await stat(this.pathFor(key))).size;
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async signUrl(): Promise<string | null> {
    // No signing story on a filesystem — the api streams these itself, which
    // keeps the authorization check on every single byte served.
    return null;
  }
}

// ---- s3 driver --------------------------------------------------------------

/**
 * S3-compatible storage. `forcePathStyle` is required for MinIO (and harmless
 * against AWS), so the same configuration works for both.
 */
class S3RecordingStorage implements RecordingStorage {
  readonly kind = 's3' as const;

  constructor(
    private readonly client: import('@aws-sdk/client-s3').S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getStream(key: string, range?: ByteRange): Promise<NodeJS.ReadableStream> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    return res.Body as NodeJS.ReadableStream;
  }

  async size(key: string): Promise<number> {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.ContentLength ?? 0;
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signUrl(key: string, ttlSeconds: number): Promise<string | null> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }
}

// ---- factory ----------------------------------------------------------------

/**
 * Build the configured driver, or `null` if it cannot be initialized.
 *
 * `null` is a first-class outcome, not a failure to crash on: the recordings
 * routes then return 503 and **the rest of the platform — including live
 * interviews — carries on**. Same contract as the RabbitMQ publisher.
 */
export async function createRecordingStorage(
  config: AppConfig,
  logger: Logger,
): Promise<RecordingStorage | null> {
  if (config.RECORDING_STORAGE === 'local') {
    try {
      const store = new LocalRecordingStorage(config.RECORDING_LOCAL_DIR);
      // Fail fast on an unwritable directory rather than at the first upload.
      await mkdir(resolve(process.cwd(), config.RECORDING_LOCAL_DIR), { recursive: true });
      logger.info(
        { driver: 'local', dir: config.RECORDING_LOCAL_DIR },
        'Recording storage ready (local disk)',
      );
      return store;
    } catch (err) {
      logger.error({ err }, 'Local recording storage unavailable — uploads will 503');
      return null;
    }
  }

  const { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_REGION } = config;
  if (!S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
    logger.error(
      'RECORDING_STORAGE=s3 but S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY are incomplete — uploads will 503',
    );
    return null;
  }
  try {
    const { S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: S3_REGION,
      ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT } : {}),
      // Required by MinIO; a no-op against AWS.
      forcePathStyle: true,
      credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
    });
    logger.info(
      { driver: 's3', bucket: S3_BUCKET, endpoint: S3_ENDPOINT },
      'Recording storage ready (s3)',
    );
    return new S3RecordingStorage(client, S3_BUCKET);
  } catch (err) {
    logger.error({ err }, 'S3 recording storage unavailable — uploads will 503');
    return null;
  }
}

/** Exported for tests — a local driver rooted at an arbitrary directory. */
export function createLocalStorageAt(rootDir: string): RecordingStorage {
  return new LocalRecordingStorage(rootDir);
}

/**
 * Parse an HTTP `Range` header into a concrete byte window.
 *
 * Seeking a video is entirely Range-driven, so a player that cannot get a 206
 * back simply will not scrub. Supports the two forms browsers actually send
 * (`bytes=N-`, `bytes=N-M`); returns null for anything unsatisfiable so the
 * caller falls back to a normal 200.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;

  // Suffix form: `bytes=-500` means the LAST 500 bytes.
  if (rawStart === '') {
    const len = Number(rawEnd);
    if (!Number.isFinite(len) || len <= 0) return null;
    return { start: Math.max(0, size - len), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return null;
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
}
