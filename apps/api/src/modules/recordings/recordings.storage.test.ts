import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalStorageAt, parseRange, segmentKey } from './recordings.storage.js';

/**
 * The `local` driver is the DEFAULT, so it must be provably correct without any
 * infrastructure — this suite needs only a temp directory. (The `s3` driver is
 * exercised manually against MinIO; no test may require a bucket.)
 */

async function drain(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

describe('segmentKey', () => {
  it('namespaces by interview and zero-pads so keys sort in playback order', () => {
    expect(segmentKey('iv-1', 0)).toBe('recordings/iv-1/000000.webm');
    expect(segmentKey('iv-1', 12)).toBe('recordings/iv-1/000012.webm');
    // Lexicographic order must match numeric order, or listings play scrambled.
    expect(segmentKey('iv-1', 2) < segmentKey('iv-1', 10)).toBe(true);
  });
});

describe('local storage driver', () => {
  let dir: string;
  const store = () => createLocalStorageAt(dir);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cn-rec-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a chunk', async () => {
    const s = store();
    const key = segmentKey('iv-round', 0);
    await s.put(key, Buffer.from('hello-recording'), 'video/webm');
    expect(await s.size(key)).toBe(15);
    expect((await drain(await s.getStream(key))).toString()).toBe('hello-recording');
  });

  it('serves a byte range (the whole basis of seeking)', async () => {
    const s = store();
    const key = segmentKey('iv-range', 0);
    await s.put(key, Buffer.from('0123456789'), 'video/webm');
    const part = await drain(await s.getStream(key, { start: 2, end: 5 }));
    expect(part.toString()).toBe('2345');
  });

  it('deletes, and delete is idempotent', async () => {
    const s = store();
    const key = segmentKey('iv-del', 0);
    await s.put(key, Buffer.from('x'), 'video/webm');
    await s.delete(key);
    await expect(s.delete(key)).resolves.toBeUndefined();
    await expect(s.size(key)).rejects.toThrow();
  });

  it('mints no URL — the api streams local media itself', async () => {
    expect(await store().signUrl('any', 60)).toBeNull();
  });

  it('refuses a key that escapes the storage root', async () => {
    // Keys are server-generated, but traversal here would mean arbitrary file
    // write, so the guard is enforced rather than assumed.
    await expect(store().put('../../escaped.webm', Buffer.from('x'), 'video/webm')).rejects.toThrow(
      /outside the recording root/,
    );
  });
});

describe('parseRange', () => {
  it('returns null without a header (caller then serves a plain 200)', () => {
    expect(parseRange(undefined, 100)).toBeNull();
  });

  it('parses an open-ended range', () => {
    expect(parseRange('bytes=50-', 100)).toEqual({ start: 50, end: 99 });
  });

  it('parses a closed range and clamps past the end', () => {
    expect(parseRange('bytes=10-20', 100)).toEqual({ start: 10, end: 20 });
    expect(parseRange('bytes=90-999', 100)).toEqual({ start: 90, end: 99 });
  });

  it('parses the suffix form (last N bytes)', () => {
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
  });

  it('rejects unsatisfiable and malformed ranges', () => {
    expect(parseRange('bytes=200-', 100)).toBeNull(); // start past EOF
    expect(parseRange('bytes=50-10', 100)).toBeNull(); // inverted
    expect(parseRange('items=0-10', 100)).toBeNull(); // wrong unit
    expect(parseRange('bytes=-', 100)).toBeNull();
    expect(parseRange('garbage', 100)).toBeNull();
  });
});
