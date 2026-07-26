import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@code-nexus/db';
import { buildTestApp, fakePublisher } from '../../test/helpers.js';

async function dbAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
const DB_READY = await dbAvailable();

const TEST_DOMAIN = '@p7test.local';
const SEED_ADMIN = { email: 'admin@codenexus.local', password: 'ChangeMe!123' };
const NEW_PW = 'Str0ngNewPass!23';
const BANK_SLUG = 'sum-of-two'; // seeded published bank question

const STUDENT_PROFILE = {
  firstName: 'Asha',
  lastName: 'Rao',
  branch: 'CSE',
  graduationYear: 2026,
  cgpa: 8.6,
  phone: '+91 98765 43210',
};

async function cleanup(): Promise<void> {
  const userWhere = { user: { email: { endsWith: TEST_DOMAIN } } };
  const byUser = { createdBy: { email: { endsWith: TEST_DOMAIN } } };
  await prisma.submission.deleteMany({
    where: { OR: [{ student: userWhere }, { contest: byUser }] },
  });
  await prisma.contestQuestion.deleteMany({ where: { contest: byUser } });
  await prisma.contestParticipant.deleteMany({ where: { contest: byUser } });
  await prisma.contest.deleteMany({ where: byUser });
  await prisma.testCase.deleteMany({ where: { question: byUser } });
  await prisma.question.deleteMany({ where: byUser });
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
}

const future = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

describe.skipIf(!DB_READY)('Phase 7 contests (integration, no worker)', () => {
  const publisher = fakePublisher();
  let app: Express;
  beforeAll(async () => {
    ({ app } = buildTestApp({ publisher }));
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

  /** Open the entry window: start in the past, deadline in the future. */
  async function openEntry(publicId: string) {
    await prisma.contest.update({
      where: { publicId },
      data: {
        startsAt: new Date(Date.now() - 60_000),
        entryDeadline: new Date(Date.now() + 60 * 60_000),
      },
    });
  }

  it('lifecycle: create → questions → publish → open → start → submit → finish → leaderboard', async () => {
    const { uni, student } = await makeUniAndStudent('F');

    const created = await uni.post('/contests', {
      title: 'Weekly F',
      description: 'Solve fast.',
      allowedLanguages: ['PYTHON'],
      startsAt: future(30),
      entryDeadline: future(90),
      durationMinutes: 90,
    });
    expect(created.status).toBe(201);
    const cid = created.body.publicId as string;

    // Publish before questions → rejected.
    expect((await uni.post(`/contests/${cid}/publish`)).status).toBe(409);
    expect(
      (await uni.post(`/contests/${cid}/questions`, { mode: 'bank', slug: BANK_SLUG })).status,
    ).toBe(201);
    expect(
      (
        await uni.post(`/contests/${cid}/questions`, {
          mode: 'custom',
          title: 'Echo',
          description: 'Print the input.',
          difficulty: 'EASY',
          topic: 'STRING',
          testCases: [
            { input: 'hi', expectedOutput: 'hi', isSample: true },
            { input: 'secret', expectedOutput: 'secret', isSample: false },
          ],
        })
      ).status,
    ).toBe(201);
    expect((await uni.post(`/contests/${cid}/publish`)).status).toBe(200);

    // Upcoming: student can see it but not start / not see statements.
    expect((await student.get(`/contests/${cid}`)).body.phase).toBe('upcoming');
    expect((await student.get(`/contests/${cid}`)).body.questions).toBeUndefined();
    expect((await student.post(`/contests/${cid}/start`)).status).toBe(409); // entry not open yet

    // Open the entry window.
    await openEntry(cid);
    expect((await student.get(`/contests/${cid}`)).body.phase).toBe('open');
    // Statements withheld until the student starts.
    expect((await student.get(`/contests/${cid}`)).body.questions).toBeUndefined();
    expect((await student.get(`/contests/${cid}/questions`)).status).toBe(403);
    // Can't submit before starting.
    expect(
      (
        await student.post(`/contests/${cid}/questions/${BANK_SLUG}/submit`, {
          language: 'PYTHON',
          sourceCode: 'x',
        })
      ).status,
    ).toBe(409);

    // Start the attempt → questions revealed; hidden testcase not leaked.
    const start = await student.post(`/contests/${cid}/start`);
    expect(start.status).toBe(200);
    expect(start.body.attemptEndsAt).toBeTruthy();
    const detail = await student.get(`/contests/${cid}`);
    expect(detail.body.questions).toHaveLength(2);
    expect(detail.body.startedAt).toBeTruthy();
    expect(
      (await student.get('/arena/questions?q=Echo')).body.items.some(
        (q: { title: string }) => q.title === 'Echo',
      ),
    ).toBe(false);
    expect(JSON.stringify((await student.get(`/contests/${cid}/questions`)).body)).not.toContain(
      'secret',
    );

    // Submit → 202 + one job with contestId.
    const before = publisher.jobs.length;
    const sub = await student.post(`/contests/${cid}/questions/${BANK_SLUG}/submit`, {
      language: 'PYTHON',
      sourceCode: 'a,b=map(int,input().split());print(a+b)',
    });
    expect(sub.status).toBe(202);
    expect(publisher.jobs.length).toBe(before + 1);
    const row = await prisma.submission.findUniqueOrThrow({
      where: { publicId: sub.body.submissionPublicId },
    });
    expect(row.contestId).toBeTruthy();
    await prisma.submission.update({
      where: { id: row.id },
      data: {
        status: 'DONE',
        verdict: 'ACCEPTED',
        testsPassed: 3,
        testsTotal: 3,
        finishedAt: new Date(),
      },
    });

    // Finish → locked: no more submissions, no re-start.
    expect((await student.post(`/contests/${cid}/finish`)).status).toBe(200);
    expect(
      (
        await student.post(`/contests/${cid}/questions/${BANK_SLUG}/submit`, {
          language: 'PYTHON',
          sourceCode: 'x',
        })
      ).status,
    ).toBe(409);
    expect((await student.post(`/contests/${cid}/start`)).status).toBe(409); // already submitted

    // Leaderboard ranks by testcases passed.
    const lb = await uni.get(`/contests/${cid}/leaderboard`);
    expect(lb.body.entries).toHaveLength(1);
    expect(lb.body.entries[0].score).toBe(3);
    expect(lb.body.entries[0].solved).toBe(1);

    // Practice stats untouched.
    expect((await student.get('/arena/stats')).body.solved.total).toBe(0);
    expect((await student.get('/arena/heatmap')).body.days).toHaveLength(0);
  });

  it('enforces eligibility, language, entry deadline, and the personal window', async () => {
    const a = await makeUniAndStudent('E');
    const b = await makeUniAndStudent('X');
    const created = await a.uni.post('/contests', {
      title: 'Guarded',
      description: 'rules',
      allowedLanguages: ['PYTHON'],
      startsAt: future(30),
      entryDeadline: future(90),
      durationMinutes: 60,
    });
    const cid = created.body.publicId as string;
    await a.uni.post(`/contests/${cid}/questions`, { mode: 'bank', slug: BANK_SLUG });
    await a.uni.post(`/contests/${cid}/publish`);
    await openEntry(cid);

    // Another university's student cannot see or start.
    expect((await b.student.get(`/contests/${cid}`)).status).toBe(404);
    expect((await b.student.post(`/contests/${cid}/start`)).status).toBe(404);

    // Start, then a disallowed language is rejected.
    await a.student.post(`/contests/${cid}/start`);
    expect(
      (
        await a.student.post(`/contests/${cid}/questions/${BANK_SLUG}/submit`, {
          language: 'JAVA',
          sourceCode: 'x',
        })
      ).status,
    ).toBe(400);

    // Personal window elapsed → submits rejected.
    await prisma.contestParticipant.updateMany({
      where: {
        contest: { publicId: cid },
        student: { user: { email: `stu-E${TEST_DOMAIN}`.toLowerCase() } },
      },
      data: { startedAt: new Date(Date.now() - 3 * 3600_000) },
    });
    expect(
      (
        await a.student.post(`/contests/${cid}/questions/${BANK_SLUG}/submit`, {
          language: 'PYTHON',
          sourceCode: 'x',
        })
      ).status,
    ).toBe(409);

    // Starting after the entry deadline is not permitted.
    const c2 = await makeUniAndStudent('Y');
    const late = await c2.uni.post('/contests', {
      title: 'Closed entry',
      description: 'x',
      allowedLanguages: ['PYTHON'],
      startsAt: future(30),
      entryDeadline: future(90),
      durationMinutes: 60,
    });
    await c2.uni.post(`/contests/${late.body.publicId}/questions`, {
      mode: 'bank',
      slug: BANK_SLUG,
    });
    await c2.uni.post(`/contests/${late.body.publicId}/publish`);
    await prisma.contest.update({
      where: { publicId: late.body.publicId },
      data: {
        startsAt: new Date(Date.now() - 3 * 3600_000),
        entryDeadline: new Date(Date.now() - 60_000),
      },
    });
    expect((await c2.student.post(`/contests/${late.body.publicId}/start`)).status).toBe(409);
  });

  it('recruiter cannot access contests (deny-by-default)', async () => {
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
    expect((await rec.get('/contests')).status).toBe(403);
  });
});
