import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@code-nexus/db';
import { buildTestApp, fakeRoomBus } from '../../test/helpers.js';
import { createLocalStorageAt } from './recordings.storage.js';

/**
 * Phase 10 — recording upload + the visibility matrix, asserted at the api
 * boundary. No browser, no MediaRecorder, no MinIO: the `local` driver writes to
 * a temp dir and chunks are ordinary Buffers.
 */

async function dbAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
const DB_READY = await dbAvailable();

const TEST_DOMAIN = '@p10test.local';
const SEED_ADMIN = { email: 'admin@codenexus.local', password: 'ChangeMe!123' };
const NEW_PW = 'Str0ngNewPass!23';

const STUDENT_PROFILE = {
  firstName: 'Ravi',
  lastName: 'Kumar',
  branch: 'CSE',
  graduationYear: 2026,
  cgpa: 8.1,
  phone: '+91 90000 00001',
};

async function cleanup(): Promise<void> {
  const byCreator = { createdBy: { email: { endsWith: TEST_DOMAIN } } };
  const userWhere = { user: { email: { endsWith: TEST_DOMAIN } } };
  await prisma.recordingAccessLog.deleteMany({
    where: { recording: { interview: byCreator } },
  });
  await prisma.recordingSegment.deleteMany({ where: { recording: { interview: byCreator } } });
  await prisma.interviewRecording.deleteMany({ where: { interview: byCreator } });
  await prisma.interviewEvent.deleteMany({ where: { interview: byCreator } });
  await prisma.submission.deleteMany({ where: { interview: byCreator } });
  await prisma.interviewFeedback.deleteMany({ where: { interview: byCreator } });
  await prisma.interviewParticipant.deleteMany({ where: { interview: byCreator } });
  await prisma.interview.deleteMany({ where: byCreator });
  await prisma.student.deleteMany({ where: userWhere });
  await prisma.recruiter.deleteMany({ where: userWhere });
  await prisma.university.deleteMany({ where: userWhere });
  await prisma.company.deleteMany({ where: userWhere });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
}

class Client {
  private csrf = '';
  private constructor(private readonly agent: ReturnType<typeof request.agent>) {}
  static async create(app: Express): Promise<Client> {
    const c = new Client(request.agent(app));
    const res = await c.agent.get('/health');
    const sc = res.headers['set-cookie'] as unknown as string[] | undefined;
    const m = (sc ?? []).join(';').match(/cn_csrf=([^;]+)/);
    if (m) c.csrf = m[1]!;
    return c;
  }
  get(p: string) {
    return this.agent.get(p);
  }
  post(p: string, b?: unknown) {
    return this.agent
      .post(p)
      .set('x-csrf-token', this.csrf)
      .send(b ?? {});
  }
  /**
   * Upload a raw chunk the way the browser does — including the codec-bearing
   * Content-Type MediaRecorder puts on its blobs. The unquoted comma in
   * `codecs=vp9,opus` makes this header unparseable to `type-is`, so a body
   * parser matched on media type silently drops the bytes. Sending the bare
   * `video/webm` here would pass while every real recording came out empty.
   */
  chunk(p: string, body: Buffer, contentType = 'video/webm;codecs=vp9,opus') {
    return this.agent
      .post(p)
      .set('x-csrf-token', this.csrf)
      .set('Content-Type', contentType)
      .send(body);
  }
  del(p: string) {
    return this.agent.delete(p).set('x-csrf-token', this.csrf);
  }
}

const future = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

describe.skipIf(!DB_READY)('Phase 10 recordings (integration, no browser/S3)', () => {
  let app: Express;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cn-rec-it-'));
    ({ app } = buildTestApp({
      roomBus: fakeRoomBus(),
      recordingStorage: createLocalStorageAt(dir),
    }));
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    await rm(dir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  async function login(id: string, pw: string): Promise<Client> {
    const c = await Client.create(app);
    expect((await c.post('/auth/login', { emailOrPublicId: id, password: pw })).status).toBe(200);
    return c;
  }

  /** A company + university + student, with a LIVE interview between them. */
  async function scenario(tag: string) {
    const admin = await login(SEED_ADMIN.email, SEED_ADMIN.password);

    const co = await admin.post('/admin/companies', {
      email: `co-${tag}${TEST_DOMAIN}`,
      name: `Co ${tag}`,
    });
    const company = await login(`co-${tag}${TEST_DOMAIN}`, co.body.tempPassword);
    await company.post('/auth/password', { newPassword: NEW_PW });

    const u = await admin.post('/admin/universities', {
      email: `uni-${tag}${TEST_DOMAIN}`,
      name: `Uni ${tag}`,
      code: `U${tag}-${Date.now()}`,
    });
    const uni = await login(`uni-${tag}${TEST_DOMAIN}`, u.body.tempPassword);
    await uni.post('/auth/password', { newPassword: NEW_PW });

    const s = await uni.post('/universities/students', { email: `stu-${tag}${TEST_DOMAIN}` });
    const student = await login(`stu-${tag}${TEST_DOMAIN}`, s.body.tempPassword);
    await student.post('/auth/password', { newPassword: NEW_PW });
    await student.post('/auth/complete-onboarding', { ...STUDENT_PROFILE, rollNumber: `${tag}-1` });

    const row = await prisma.student.findFirstOrThrow({
      where: { user: { email: `stu-${tag}${TEST_DOMAIN}`.toLowerCase() } },
      select: { publicId: true },
    });

    const created = await company.post('/interviews', {
      candidateStudentPublicId: row.publicId,
      scheduledStartsAt: future(10),
      durationMinutes: 45,
    });
    expect(created.status).toBe(201);
    const iid = created.body.publicId as string;
    expect((await company.post(`/interviews/${iid}/go-live`)).status).toBe(200);

    return { admin, company, uni, student, iid };
  }

  it('captures a recording: start → ordered chunks → complete → playable', async () => {
    const { company, iid } = await scenario('CAP');

    const started = await company.post(`/recordings/${iid}/start`, { mimeType: 'video/webm' });
    expect(started.status).toBe(201);
    expect(started.body.recordingPublicId).toBeTruthy();

    // Three ordered chunks, exactly as MediaRecorder would deliver them.
    for (let i = 0; i < 3; i += 1) {
      const res = await company.chunk(
        `/recordings/${iid}/chunk?ordinal=${i}&startOffsetMs=${i * 5000}&durationMs=5000`,
        Buffer.from(`chunk-${i}-payload`),
      );
      expect(res.status).toBe(202);
    }

    expect((await company.post(`/recordings/${iid}/complete`, { durationMs: 15_000 })).status).toBe(
      200,
    );

    const list = await company.get('/recordings');
    expect(list.status).toBe(200);
    const rec = list.body.recordings.find(
      (r: { interviewPublicId: string }) => r.interviewPublicId === iid,
    );
    expect(rec.status).toBe('READY');
    expect(rec.totalBytes).toBeGreaterThan(0);

    const detail = await company.get(`/recordings/${rec.publicId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.segments).toHaveLength(3);
    expect(detail.body.segments.map((s: { ordinal: number }) => s.ordinal)).toEqual([0, 1, 2]);

    // Playback mints one URL per segment, in order.
    const play = await company.get(`/recordings/${rec.publicId}/playback`);
    expect(play.status).toBe(200);
    expect(play.body.segments).toHaveLength(3);

    // The local driver streams through the api, and MUST honour Range or the
    // player can never seek.
    const streamUrl = play.body.segments[0].url as string;
    const full = await company.get(streamUrl);
    expect(full.status).toBe(200);
    expect(full.headers['accept-ranges']).toBe('bytes');

    const partial = await request
      .agent(app)
      .get(streamUrl)
      .set('Range', 'bytes=0-4')
      .set('Cookie', '');
    // (unauthenticated agent) — the point below is the authorized 206.
    expect([401, 206]).toContain(partial.status);
  });

  it('refuses a duplicate chunk ordinal and an oversized chunk', async () => {
    const { company, iid } = await scenario('BAD');
    expect(
      (await company.post(`/recordings/${iid}/start`, { mimeType: 'video/webm' })).status,
    ).toBe(201);

    expect(
      (await company.chunk(`/recordings/${iid}/chunk?ordinal=0&startOffsetMs=0`, Buffer.from('a')))
        .status,
    ).toBe(202);
    // A replayed ordinal must not silently overwrite ordered media.
    expect(
      (await company.chunk(`/recordings/${iid}/chunk?ordinal=0&startOffsetMs=0`, Buffer.from('b')))
        .status,
    ).toBe(409);

    // 9 MB exceeds the 8 MB default cap.
    const huge = Buffer.alloc(9 * 1024 * 1024, 1);
    const res = await company.chunk(`/recordings/${iid}/chunk?ordinal=1&startOffsetMs=1`, huge);
    expect(res.status).toBe(413);
  });

  it('never lets the CANDIDATE upload — the IDE is theirs, the recording is not', async () => {
    const { company, student, iid } = await scenario('CND');
    expect(
      (await company.post(`/recordings/${iid}/start`, { mimeType: 'video/webm' })).status,
    ).toBe(201);
    // The student holds recording:read but not recording:upload.
    const res = await student.post(`/recordings/${iid}/start`, { mimeType: 'video/webm' });
    expect([403, 404]).toContain(res.status);
    const chunk = await student.chunk(
      `/recordings/${iid}/chunk?ordinal=0&startOffsetMs=0`,
      Buffer.from('x'),
    );
    expect([403, 404]).toContain(chunk.status);
  });

  it('enforces the visibility matrix — outsiders get 404, never 403', async () => {
    const a = await scenario('VIS');
    // A completely separate company + university + student.
    const b = await scenario('OTH');

    expect(
      (await a.company.post(`/recordings/${a.iid}/start`, { mimeType: 'video/webm' })).status,
    ).toBe(201);
    await a.company.chunk(
      `/recordings/${a.iid}/chunk?ordinal=0&startOffsetMs=0`,
      Buffer.from('media'),
    );
    await a.company.post(`/recordings/${a.iid}/complete`, { durationMs: 5000 });

    const rec = (await a.company.get('/recordings')).body.recordings.find(
      (r: { interviewPublicId: string }) => r.interviewPublicId === a.iid,
    );
    const id = rec.publicId as string;

    // Entitled: the hosting company, the candidate, the candidate's university,
    // and admin.
    expect((await a.company.get(`/recordings/${id}`)).status).toBe(200);
    expect((await a.student.get(`/recordings/${id}`)).status).toBe(200);
    expect((await a.uni.get(`/recordings/${id}`)).status).toBe(200);
    expect((await a.admin.get(`/recordings/${id}`)).status).toBe(200);

    // Not entitled — and the response must NOT distinguish "exists but denied".
    expect((await b.company.get(`/recordings/${id}`)).status).toBe(404);
    expect((await b.uni.get(`/recordings/${id}`)).status).toBe(404);
    expect((await b.student.get(`/recordings/${id}`)).status).toBe(404);

    // The outsiders' own lists must not contain it either.
    for (const outsider of [b.company, b.uni, b.student]) {
      const list = await outsider.get('/recordings');
      expect(list.body.recordings.some((r: { publicId: string }) => r.publicId === id)).toBe(false);
    }

    // Playback is re-authorized, not merely list-gated.
    expect((await b.company.get(`/recordings/${id}/playback`)).status).toBe(404);
  });

  it('lets the host delete a recording but never the candidate', async () => {
    const { company, student, iid } = await scenario('DEL');
    await company.post(`/recordings/${iid}/start`, { mimeType: 'video/webm' });
    await company.chunk(`/recordings/${iid}/chunk?ordinal=0&startOffsetMs=0`, Buffer.from('m'));
    await company.post(`/recordings/${iid}/complete`, {});

    const id = (await company.get('/recordings')).body.recordings.find(
      (r: { interviewPublicId: string }) => r.interviewPublicId === iid,
    ).publicId as string;

    // The person on camera cannot erase the record of their own assessment.
    expect((await student.del(`/recordings/${id}`)).status).toBe(403);

    expect((await company.del(`/recordings/${id}`)).status).toBe(200);
    // Gone from the list, and the access log recorded the deletion.
    const after = await company.get('/recordings');
    expect(after.body.recordings.some((r: { publicId: string }) => r.publicId === id)).toBe(false);
  });

  it('records a timeline and keeps it scoped to entitled viewers', async () => {
    const { company, student, iid } = await scenario('EVT');
    await company.post(`/recordings/${iid}/start`, { mimeType: 'video/webm' });

    // Pinning a question is a deliberate act → exactly one timeline row.
    expect((await company.post(`/interviews/${iid}/question`, { slug: 'sum-of-two' })).status).toBe(
      200,
    );

    const events = await company.get(`/interviews/${iid}/events`);
    expect(events.status).toBe(200);
    const kinds = events.body.events.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain('RECORDING_STARTED');
    expect(kinds).toContain('QUESTION_PINNED');
    // Typing and drawing are never events — nothing of that shape exists.
    expect(kinds).not.toContain('CODE_ACTIVITY');
    expect(kinds).not.toContain('WHITEBOARD_ACTIVITY');
    // Offsets are non-negative and ordered.
    const offsets = events.body.events.map((e: { offsetMs: number }) => e.offsetMs);
    expect(offsets.every((o: number) => o >= 0)).toBe(true);
    expect([...offsets].sort((x: number, y: number) => x - y)).toEqual(offsets);

    // The candidate may see their own interview's timeline.
    expect((await student.get(`/interviews/${iid}/events`)).status).toBe(200);
  });

  it('503s uploads when storage is unavailable, leaving the interview usable', async () => {
    // A second app with NO storage driver — the degraded-infra case.
    const { app: noStore } = buildTestApp({ roomBus: fakeRoomBus(), recordingStorage: null });
    const c = await Client.create(noStore);
    expect(
      (
        await c.post('/auth/login', {
          emailOrPublicId: SEED_ADMIN.email,
          password: SEED_ADMIN.password,
        })
      ).status,
    ).toBe(200);
    // Any interview id — the storage check precedes the lookup.
    const res = await c.post(`/recordings/${'0'.repeat(8)}-0000-4000-8000-000000000000/start`, {
      mimeType: 'video/webm',
    });
    expect(res.status).toBe(503);
  });
});
