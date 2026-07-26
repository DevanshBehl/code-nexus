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

const TEST_DOMAIN = '@p6test.local';
const SLUG_PREFIX = 'p6test-';
const SEED_ADMIN = { email: 'admin@codenexus.local', password: 'ChangeMe!123' };
const NEW_PW = 'Str0ngNewPass!23';

const STUDENT_PROFILE = {
  firstName: 'Asha',
  lastName: 'Rao',
  branch: 'CSE',
  graduationYear: 2026,
  cgpa: 8.6,
  phone: '+91 98765 43210',
};

const SOLUTION = 'print(int(input()) * 2)';

async function cleanup(): Promise<void> {
  const userWhere = { user: { email: { endsWith: TEST_DOMAIN } } };
  await prisma.submission.deleteMany({
    where: {
      OR: [{ student: userWhere }, { question: { slug: { startsWith: SLUG_PREFIX } } }],
    },
  });
  await prisma.testCase.deleteMany({ where: { question: { slug: { startsWith: SLUG_PREFIX } } } });
  await prisma.question.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
  await prisma.student.deleteMany({ where: userWhere });
  await prisma.university.deleteMany({ where: userWhere });
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
  get(path: string) {
    return this.agent.get(path);
  }
  post(path: string, body?: unknown) {
    return this.agent
      .post(path)
      .set('x-csrf-token', this.csrf)
      .send(body ?? {});
  }
}

async function seedQuestion(slug: string): Promise<void> {
  await prisma.question.create({
    data: {
      slug,
      title: 'Double the number',
      description: 'Read an integer n and print n * 2.',
      difficulty: 'EASY',
      topic: 'MATH',
      published: true,
      testCases: {
        create: [
          { input: '2', expectedOutput: '4', isSample: true, ordinal: 1 },
          { input: '10', expectedOutput: '20', isSample: false, ordinal: 2 },
          { input: '0', expectedOutput: '0', isSample: false, ordinal: 3 },
        ],
      },
    },
  });
}

describe.skipIf(!DB_READY)('Phase 6 arena (integration, no worker/Judge0)', () => {
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

  async function login(emailOrPublicId: string, password: string): Promise<Client> {
    const c = await Client.create(app);
    const res = await c.post('/auth/login', { emailOrPublicId, password });
    expect(res.status).toBe(200);
    return c;
  }

  async function makeStudent(tag: string): Promise<Client> {
    const admin = await login(SEED_ADMIN.email, SEED_ADMIN.password);
    const uni = await admin.post('/admin/universities', {
      email: `uni-${tag}${TEST_DOMAIN}`,
      name: `Uni ${tag}`,
      code: `U${tag}-${Date.now()}`,
    });
    const uniClient = await login(`uni-${tag}${TEST_DOMAIN}`, uni.body.tempPassword);
    await uniClient.post('/auth/password', { newPassword: NEW_PW });
    const stu = await uniClient.post('/universities/students', {
      email: `stu-${tag}${TEST_DOMAIN}`,
    });
    const student = await login(`stu-${tag}${TEST_DOMAIN}`, stu.body.tempPassword);
    await student.post('/auth/password', { newPassword: NEW_PW });
    await student.post('/auth/complete-onboarding', { ...STUDENT_PROFILE, rollNumber: `${tag}-1` });
    return student;
  }

  it('lists questions, hides hidden testcases, and enqueues run/submit jobs', async () => {
    const slug = `${SLUG_PREFIX}double-${Date.now()}`;
    await seedQuestion(slug);
    const student = await makeStudent('A');

    // List shows the question, unsolved.
    const list = await student.get('/arena/questions');
    expect(list.status).toBe(200);
    const row = list.body.items.find((q: { slug: string }) => q.slug === slug);
    expect(row).toBeTruthy();
    expect(row.status).toBe('unsolved');

    // Detail returns ONLY the sample testcase (never the 2 hidden ones).
    const detail = await student.get(`/arena/questions/${slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.sampleTestCases).toHaveLength(1);
    expect(JSON.stringify(detail.body)).not.toContain('"10"'); // hidden input not leaked

    // Run → 202 + one enqueued job; submission QUEUED over the 1 sample testcase.
    const before = publisher.jobs.length;
    const run = await student.post(`/arena/questions/${slug}/run`, {
      language: 'PYTHON',
      sourceCode: SOLUTION,
    });
    expect(run.status).toBe(202);
    expect(publisher.jobs.length).toBe(before + 1);
    expect(publisher.jobs.at(-1)!.submissionPublicId).toBe(run.body.submissionPublicId);
    const runSub = await student.get(`/arena/submissions/${run.body.submissionPublicId}`);
    expect(runSub.body.status).toBe('QUEUED');
    expect(runSub.body.testsTotal).toBe(1);

    // Submit → 202; submission QUEUED over ALL 3 testcases.
    const submit = await student.post(`/arena/questions/${slug}/submit`, {
      language: 'PYTHON',
      sourceCode: SOLUTION,
    });
    expect(submit.status).toBe(202);
    const submitSub = await student.get(`/arena/submissions/${submit.body.submissionPublicId}`);
    expect(submitSub.body.kind).toBe('SUBMIT');
    expect(submitSub.body.testsTotal).toBe(3);
  });

  it('scopes submissions to their owner (404 for others)', async () => {
    const slug = `${SLUG_PREFIX}scope-${Date.now()}`;
    await seedQuestion(slug);
    const a = await makeStudent('B');
    const b = await makeStudent('C');

    const run = await a.post(`/arena/questions/${slug}/run`, {
      language: 'PYTHON',
      sourceCode: SOLUTION,
    });
    expect((await a.get(`/arena/submissions/${run.body.submissionPublicId}`)).status).toBe(200);
    expect((await b.get(`/arena/submissions/${run.body.submissionPublicId}`)).status).toBe(404);
  });

  it('rate-limits in-flight submissions (429)', async () => {
    const slug = `${SLUG_PREFIX}rate-${Date.now()}`;
    await seedQuestion(slug);
    const student = await makeStudent('D');
    // Default ARENA_MAX_INFLIGHT = 3; nothing drains them (no worker) → 4th is 429.
    for (let i = 0; i < 3; i += 1) {
      const r = await student.post(`/arena/questions/${slug}/run`, {
        language: 'PYTHON',
        sourceCode: SOLUTION,
      });
      expect(r.status).toBe(202);
    }
    const limited = await student.post(`/arena/questions/${slug}/run`, {
      language: 'PYTHON',
      sourceCode: SOLUTION,
    });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('returns 503 when the broker is unavailable (publisher null)', async () => {
    const slug = `${SLUG_PREFIX}down-${Date.now()}`;
    await seedQuestion(slug);
    // Create + activate the student on the main app (shared DB)...
    await makeStudent('Z');

    // ...then log that same student in on a second app whose publisher is null.
    const { app: downApp } = buildTestApp({ publisher: null });
    const down = await Client.create(downApp);
    const loggedIn = await down.post('/auth/login', {
      emailOrPublicId: `stu-Z${TEST_DOMAIN}`,
      password: NEW_PW,
    });
    expect(loggedIn.status).toBe(200);

    const res = await down.post(`/arena/questions/${slug}/run`, {
      language: 'PYTHON',
      sourceCode: SOLUTION,
    });
    expect(res.status).toBe(503);
  });
});
