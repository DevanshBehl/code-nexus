import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@code-nexus/db';
import { verifyRtToken } from '@code-nexus/auth';
import { buildTestApp, fakePublisher, fakeRoomBus } from '../../test/helpers.js';

async function dbAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
const DB_READY = await dbAvailable();

const TEST_DOMAIN = '@p9test.local';
const SEED_ADMIN = { email: 'admin@codenexus.local', password: 'ChangeMe!123' };
const NEW_PW = 'Str0ngNewPass!23';
const RT_SECRET = 'dev-rt-token-secret-change-me';
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
  const byCreator = { createdBy: { email: { endsWith: TEST_DOMAIN } } };
  const userWhere = { user: { email: { endsWith: TEST_DOMAIN } } };
  await prisma.submission.deleteMany({ where: { interview: byCreator } });
  await prisma.interviewFeedback.deleteMany({ where: { interview: byCreator } });
  await prisma.interviewParticipant.deleteMany({ where: { interview: byCreator } });
  // Phase 10 dependents — an interview now also owns a timeline and (possibly)
  // a recording, so these must go before the interview itself.
  await prisma.recordingAccessLog.deleteMany({
    where: { recording: { interview: byCreator } },
  });
  await prisma.recordingSegment.deleteMany({ where: { recording: { interview: byCreator } } });
  await prisma.interviewRecording.deleteMany({ where: { interview: byCreator } });
  await prisma.interviewEvent.deleteMany({ where: { interview: byCreator } });
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

describe.skipIf(!DB_READY)('Phase 9 interviews (integration, no gateway/WebRTC)', () => {
  const bus = fakeRoomBus();
  const publisher = fakePublisher();
  let app: Express;
  beforeAll(async () => {
    ({ app } = buildTestApp({ roomBus: bus, publisher }));
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

  async function makeCompanyAndStudent(tag: string) {
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

    // Resolve the Student.publicId (the candidate reference — distinct from the
    // User.publicId returned by /auth/me).
    const row = await prisma.student.findFirstOrThrow({
      where: { user: { email: `stu-${tag}${TEST_DOMAIN}`.toLowerCase() } },
      select: { publicId: true },
    });
    return { company, uni, student, studentPublicId: row.publicId };
  }

  it('lifecycle: schedule → go-live → tokens → run → end → feedback (private)', async () => {
    const { company, student, studentPublicId } = await makeCompanyAndStudent('F');

    const created = await company.post('/interviews', {
      title: 'SDE-1 screen',
      candidateStudentPublicId: studentPublicId,
      scheduledStartsAt: future(30),
      durationMinutes: 45,
      questionSlug: BANK_SLUG,
    });
    expect(created.status).toBe(201);
    const iid = created.body.publicId as string;
    expect(created.body.status).toBe('SCHEDULED');
    expect(created.body.question.slug).toBe(BANK_SLUG);

    // Candidate can see it but not before-live tokens.
    const seen = await student.get(`/interviews/${iid}`);
    expect(seen.status).toBe(200);
    expect(seen.body.isCandidate).toBe(true);
    expect(seen.body.feedback).toBeUndefined(); // candidate NEVER sees feedback
    expect((await student.get(`/interviews/${iid}/rt-token`)).status).toBe(409); // not live

    // Editing while scheduled works; run before live is refused.
    expect((await company.patch(`/interviews/${iid}`, { title: 'SDE-1 (final)' })).status).toBe(
      200,
    );
    expect(
      (await student.post(`/interviews/${iid}/run`, { language: 'PYTHON', sourceCode: 'x' }))
        .status,
    ).toBe(409);

    // Go live.
    const live = await company.post(`/interviews/${iid}/go-live`);
    expect(live.status).toBe(200);
    expect(live.body.status).toBe('LIVE');
    expect((await company.patch(`/interviews/${iid}`, { title: 'nope' })).status).toBe(409);

    // Both sides get a valid RT token (kind interview) with the right role.
    const hostTok = await company.get(`/interviews/${iid}/rt-token`);
    expect(hostTok.status).toBe(200);
    const hp = verifyRtToken(hostTok.body.token, RT_SECRET);
    expect(hp?.kind).toBe('interview');
    expect(hp?.role).toBe('INTERVIEWER');

    const stuTok = await student.get(`/interviews/${iid}/rt-token`);
    const sp = verifyRtToken(stuTok.body.token, RT_SECRET);
    expect(sp?.role).toBe('CANDIDATE');
    expect(sp?.studentId).toBeTruthy();

    // ICE config: STUN present; no TURN configured in test → no creds leak.
    const rtc = await student.get(`/interviews/${iid}/rtc-config`);
    expect(rtc.status).toBe(200);
    expect(rtc.body.iceServers.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(rtc.body)).not.toContain('credential');

    // Candidate runs code → 202 + a Submission tagged interviewId.
    const before = publisher.jobs.length;
    const run = await student.post(`/interviews/${iid}/run`, {
      language: 'PYTHON',
      sourceCode: 'a,b=map(int,input().split());print(a+b)',
    });
    expect(run.status).toBe(202);
    expect(publisher.jobs.length).toBe(before + 1);
    const sub = await prisma.submission.findUniqueOrThrow({
      where: { publicId: run.body.submissionPublicId },
    });
    expect(sub.interviewId).toBeTruthy();
    // An interviewer cannot run (no student attempt to attribute).
    expect(
      (await company.post(`/interviews/${iid}/run`, { language: 'PYTHON', sourceCode: 'x' }))
        .status,
    ).toBe(403);

    // End with a final code snapshot → ENDED + interview:ended fanned out.
    const ended = await company.post(`/interviews/${iid}/end`, { codeSnapshot: 'print(42)' });
    expect(ended.status).toBe(200);
    expect(ended.body.status).toBe('ENDED');
    expect(ended.body.codeSnapshot).toBe('print(42)');
    expect((bus.events.at(-1)?.event as { t: string }).t).toBe('interview:ended');

    // Feedback: interviewer submits (one per author); the candidate never sees it.
    expect(
      (
        await company.post(`/interviews/${iid}/feedback`, {
          rating: 4,
          notes: 'Solid problem solving.',
          recommendation: 'YES',
        })
      ).status,
    ).toBe(201);
    // Duplicate feedback by the same author is rejected.
    expect(
      (
        await company.post(`/interviews/${iid}/feedback`, {
          rating: 5,
          notes: 'again',
          recommendation: 'STRONG_YES',
        })
      ).status,
    ).toBe(409);
    // Host sees feedback; candidate is forbidden + never gets it in the DTO.
    const hostFb = await company.get(`/interviews/${iid}/feedback`);
    expect(hostFb.body.feedback).toHaveLength(1);
    expect((await student.get(`/interviews/${iid}/feedback`)).status).toBe(403);
    expect((await student.get(`/interviews/${iid}`)).body.feedback).toBeUndefined();
  });

  it('enforces participant scoping + host ownership', async () => {
    const a = await makeCompanyAndStudent('E');
    const b = await makeCompanyAndStudent('X');
    const created = await a.company.post('/interviews', {
      candidateStudentPublicId: a.studentPublicId,
      scheduledStartsAt: future(30),
      durationMinutes: 30,
    });
    const iid = created.body.publicId as string;
    await a.company.post(`/interviews/${iid}/go-live`);

    // Another company cannot see or manage it.
    expect((await b.company.get(`/interviews/${iid}`)).status).toBe(404);
    expect((await b.company.post(`/interviews/${iid}/end`)).status).toBe(404);
    // Another university's student (non-candidate) cannot see it or get a token.
    expect((await b.student.get(`/interviews/${iid}`)).status).toBe(404);
    expect((await b.student.get(`/interviews/${iid}/rt-token`)).status).toBe(404);
  });

  it('recruiter/company scoping: a student cannot schedule', async () => {
    const { student } = await makeCompanyAndStudent('S');
    expect(
      (
        await student.post('/interviews', {
          candidateStudentPublicId: '00000000-0000-0000-0000-000000000000',
          scheduledStartsAt: future(30),
          durationMinutes: 30,
        })
      ).status,
    ).toBe(403);
  });
});
