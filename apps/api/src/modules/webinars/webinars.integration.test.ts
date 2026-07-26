import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@code-nexus/db';
import { verifyRtToken } from '@code-nexus/auth';
import { buildTestApp, fakeRoomBus } from '../../test/helpers.js';

async function dbAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
const DB_READY = await dbAvailable();

const TEST_DOMAIN = '@p8test.local';
const SEED_ADMIN = { email: 'admin@codenexus.local', password: 'ChangeMe!123' };
const NEW_PW = 'Str0ngNewPass!23';
// Matches the api test-config default (buildTestApp) — MEDIA_PROVIDER defaults to 'stub'.
const RT_SECRET = 'dev-rt-token-secret-change-me';

const STUDENT_PROFILE = {
  firstName: 'Asha',
  lastName: 'Rao',
  branch: 'CSE',
  graduationYear: 2026,
  cgpa: 8.6,
  phone: '+91 98765 43210',
};

async function cleanup(): Promise<void> {
  const byUser = { createdBy: { email: { endsWith: TEST_DOMAIN } } };
  const userWhere = { user: { email: { endsWith: TEST_DOMAIN } } };
  await prisma.webinarPollVote.deleteMany({ where: { poll: { webinar: byUser } } });
  await prisma.webinarPollOption.deleteMany({ where: { poll: { webinar: byUser } } });
  await prisma.webinarPoll.deleteMany({ where: { webinar: byUser } });
  await prisma.webinarMessage.deleteMany({ where: { webinar: byUser } });
  await prisma.webinarAttendance.deleteMany({ where: { webinar: byUser } });
  await prisma.webinar.deleteMany({ where: byUser });
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
    await c.refresh();
    return c;
  }
  private async refresh(): Promise<void> {
    const res = await this.agent.get('/health');
    const sc = res.headers['set-cookie'] as unknown as string[] | undefined;
    const m = (sc ?? []).join(';').match(/cn_csrf=([^;]+)/);
    if (m) this.csrf = m[1]!;
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
  patch(p: string, b?: unknown) {
    return this.agent
      .patch(p)
      .set('x-csrf-token', this.csrf)
      .send(b ?? {});
  }
}

const future = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

describe.skipIf(!DB_READY)('Phase 8 webinars (integration, no gateway/media)', () => {
  const bus = fakeRoomBus();
  let app: Express;
  beforeAll(async () => {
    ({ app } = buildTestApp({ roomBus: bus }));
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  async function login(id: string, pw: string): Promise<Client> {
    const c = await Client.create(app);
    expect((await c.post('/auth/login', { emailOrPublicId: id, password: pw })).status).toBe(200);
    return c;
  }

  async function makeUniAndStudent(tag: string) {
    const admin = await login(SEED_ADMIN.email, SEED_ADMIN.password);
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
    return { uni, student };
  }

  it('lifecycle: create → publish → go-live → rt-token → poll → end → attendance', async () => {
    const { uni, student } = await makeUniAndStudent('F');

    const created = await uni.post('/webinars', {
      title: 'Pre-placement talk',
      description: 'Meet the team.',
      scheduledStartsAt: future(30),
    });
    expect(created.status).toBe(201);
    const wid = created.body.publicId as string;
    // Host sees ingest creds (stub); status DRAFT; no live playback yet.
    expect(created.body.ingest?.streamKey).toBeTruthy();
    expect(created.body.status).toBe('DRAFT');

    // Student cannot see a draft.
    expect((await student.get(`/webinars/${wid}`)).status).toBe(404);
    // Cannot go live before publishing.
    expect((await uni.post(`/webinars/${wid}/go-live`)).status).toBe(409);
    // Cannot mint a token before it is live.
    expect((await uni.get(`/webinars/${wid}/rt-token`)).status).toBe(409);

    expect((await uni.post(`/webinars/${wid}/publish`)).status).toBe(200);
    // Scheduled → student can see it but not get a token (not live).
    const seen = await student.get(`/webinars/${wid}`);
    expect(seen.status).toBe(200);
    expect(seen.body.status).toBe('SCHEDULED');
    expect(seen.body.ingest).toBeUndefined(); // stream key never leaks to a viewer
    expect((await student.get(`/webinars/${wid}/rt-token`)).status).toBe(409);

    // Editing allowed while scheduled.
    expect((await uni.patch(`/webinars/${wid}`, { title: 'PPT — Acme' })).status).toBe(200);

    // Go live.
    const live = await uni.post(`/webinars/${wid}/go-live`);
    expect(live.status).toBe(200);
    expect(live.body.status).toBe('LIVE');
    // Stub provider → playbackUrl null but the room works.
    expect(live.body.playbackUrl).toBeNull();
    // Editing a live webinar is blocked.
    expect((await uni.patch(`/webinars/${wid}`, { title: 'nope' })).status).toBe(409);

    // Host + student each get a valid RT token; a viewer never sees the stream key.
    const hostTok = await uni.get(`/webinars/${wid}/rt-token`);
    expect(hostTok.status).toBe(200);
    const hp = verifyRtToken(hostTok.body.token, RT_SECRET);
    expect(hp?.role).toBe('HOST');

    const stuTok = await student.get(`/webinars/${wid}/rt-token`);
    expect(stuTok.status).toBe(200);
    const sp = verifyRtToken(stuTok.body.token, RT_SECRET);
    expect(sp?.role).toBe('VIEWER');
    expect(sp?.studentId).toBeTruthy();
    expect(JSON.stringify(stuTok.body)).not.toContain('streamKey');

    // Host opens a poll → persisted OPEN + fanned out on the bus.
    const before = bus.events.length;
    const poll = await uni.post(`/webinars/${wid}/polls`, {
      question: 'Which stack?',
      options: ['React', 'Vue', 'Angular'],
    });
    expect(poll.status).toBe(201);
    expect(poll.body.options).toHaveLength(3);
    expect(bus.events.length).toBe(before + 1);
    expect((bus.events.at(-1)?.event as { t: string }).t).toBe('poll:opened');

    // Simulate a viewer vote at the persistence layer (the gateway writes votes).
    const dbPoll = await prisma.webinarPoll.findFirstOrThrow({
      where: { publicId: poll.body.publicId },
      include: { options: true },
    });
    const voter = await prisma.user.findFirstOrThrow({
      where: { email: `stu-F${TEST_DOMAIN}`.toLowerCase() },
    });
    await prisma.webinarPollVote.create({
      data: { pollId: dbPoll.id, optionId: dbPoll.options[0]!.id, voterId: voter.id },
    });
    // A second vote by the same voter is rejected by the unique constraint.
    await expect(
      prisma.webinarPollVote.create({
        data: { pollId: dbPoll.id, optionId: dbPoll.options[1]!.id, voterId: voter.id },
      }),
    ).rejects.toThrow();

    // Poll list shows aggregate counts, never who-voted.
    const polls = await student.get(`/webinars/${wid}/polls`);
    expect(polls.status).toBe(200);
    const counted = polls.body.polls[0].options.reduce(
      (n: number, o: { count: number }) => n + o.count,
      0,
    );
    expect(counted).toBe(1);
    expect(JSON.stringify(polls.body)).not.toContain(voter.id);

    // Close the poll → fanned out.
    expect((await uni.post(`/webinars/${wid}/polls/${poll.body.publicId}/close`)).status).toBe(200);
    expect((bus.events.at(-1)?.event as { t: string }).t).toBe('poll:closed');

    // End → status ENDED + webinar:ended fanned out.
    const ended = await uni.post(`/webinars/${wid}/end`);
    expect(ended.status).toBe(200);
    expect(ended.body.status).toBe('ENDED');
    expect((bus.events.at(-1)?.event as { t: string }).t).toBe('webinar:ended');
    // No token after it has ended.
    expect((await student.get(`/webinars/${wid}/rt-token`)).status).toBe(409);

    // Host attendance view (seed one attendance row as the gateway would).
    const stu = await prisma.student.findFirstOrThrow({
      where: { user: { email: `stu-F${TEST_DOMAIN}`.toLowerCase() } },
    });
    const dbWebinar = await prisma.webinar.findFirstOrThrow({ where: { publicId: wid } });
    await prisma.webinarAttendance.create({
      data: { webinarId: dbWebinar.id, studentId: stu.id, attendedSeconds: 120, present: false },
    });
    const att = await uni.get(`/webinars/${wid}/attendance`);
    expect(att.status).toBe(200);
    expect(att.body.attendance).toHaveLength(1);
    expect(att.body.attendance[0].attendedSeconds).toBe(120);
    // A student cannot read attendance.
    expect((await student.get(`/webinars/${wid}/attendance`)).status).toBe(403);
  });

  it('enforces eligibility + host ownership', async () => {
    const a = await makeUniAndStudent('E');
    const b = await makeUniAndStudent('X');
    const created = await a.uni.post('/webinars', {
      title: 'Guarded',
      description: 'rules',
      scheduledStartsAt: future(30),
    });
    const wid = created.body.publicId as string;
    await a.uni.post(`/webinars/${wid}/publish`);
    await a.uni.post(`/webinars/${wid}/go-live`);

    // Another university's student cannot see it or get a token.
    expect((await b.student.get(`/webinars/${wid}`)).status).toBe(404);
    expect((await b.student.get(`/webinars/${wid}/rt-token`)).status).toBe(404);
    // Another host cannot manage it.
    expect((await b.uni.post(`/webinars/${wid}/end`)).status).toBe(404);

    // A company must target a university to create a webinar.
    const admin = await login(SEED_ADMIN.email, SEED_ADMIN.password);
    const co = await admin.post('/admin/companies', { email: `co-C${TEST_DOMAIN}`, name: 'Co C' });
    const coc = await login(`co-C${TEST_DOMAIN}`, co.body.tempPassword);
    await coc.post('/auth/password', { newPassword: NEW_PW });
    expect(
      (
        await coc.post('/webinars', {
          title: 'No target',
          description: 'x',
          scheduledStartsAt: future(30),
        })
      ).status,
    ).toBe(400);
  });

  it('recruiter cannot access webinars (deny-by-default)', async () => {
    const admin = await login(SEED_ADMIN.email, SEED_ADMIN.password);
    const co = await admin.post('/admin/companies', { email: `co-R${TEST_DOMAIN}`, name: 'Co R' });
    const coc = await login(`co-R${TEST_DOMAIN}`, co.body.tempPassword);
    await coc.post('/auth/password', { newPassword: NEW_PW });
    const recRes = await coc.post('/companies/recruiters', { email: `rec-R${TEST_DOMAIN}` });
    const rec = await login(`rec-R${TEST_DOMAIN}`, recRes.body.tempPassword);
    await rec.post('/auth/password', { newPassword: NEW_PW });
    await rec.post('/auth/complete-onboarding', {
      firstName: 'R',
      lastName: 'R',
      designation: 'HR',
      phone: '+91 90000 00000',
    });
    expect((await rec.get('/webinars')).status).toBe(403);
  });
});
