import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@code-nexus/db';
import { buildTestApp } from '../../test/helpers.js';

async function dbAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
const DB_READY = await dbAvailable();

const TEST_DOMAIN = '@p3test.local';
const SEED_ADMIN = { email: 'admin@codenexus.local', password: 'ChangeMe!123' };
const NEW_PW = 'Str0ngNewPass!23';

const STUDENT_PROFILE = {
  firstName: 'Asha',
  lastName: 'Rao',
  rollNumber: 'CS21B045',
  branch: 'CSE',
  graduationYear: 2026,
  cgpa: 8.6,
  phone: '+91 98765 43210',
};

async function cleanup(): Promise<void> {
  const where = { user: { email: { endsWith: TEST_DOMAIN } } };
  await prisma.student.deleteMany({ where });
  await prisma.recruiter.deleteMany({ where });
  await prisma.university.deleteMany({ where });
  await prisma.company.deleteMany({ where });
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
  put(path: string, body?: unknown) {
    return this.agent
      .put(path)
      .set('x-csrf-token', this.csrf)
      .send(body ?? {});
  }
}

describe.skipIf(!DB_READY)('Phase 3 profiles + dashboards (integration)', () => {
  let app: Express;
  beforeAll(async () => {
    ({ app } = buildTestApp());
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

  it('student first-login → password change → profile completion → ACTIVE dashboard', async () => {
    const admin = await login(SEED_ADMIN.email, SEED_ADMIN.password);
    const uni = await admin.post('/admin/universities', {
      email: `uni${TEST_DOMAIN}`,
      name: 'Test University',
      code: `TU-${Date.now()}`,
    });
    expect(uni.status).toBe(201);
    const uniClient = await login(`uni${TEST_DOMAIN}`, uni.body.tempPassword);
    await uniClient.post('/auth/password', { newPassword: NEW_PW });

    const student = await uniClient.post('/universities/students', {
      email: `stu${TEST_DOMAIN}`,
    });
    expect(student.status).toBe(201);

    const stu = await login(`stu${TEST_DOMAIN}`, student.body.tempPassword);
    await stu.post('/auth/password', { newPassword: NEW_PW });

    // PENDING_PROFILE → dashboard blocked
    const blocked = await stu.get('/dashboard');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PROFILE_INCOMPLETE');

    // incomplete profile → 400 VALIDATION
    const bad = await stu.post('/auth/complete-onboarding', { firstName: 'Asha' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION');

    // complete profile → ACTIVE
    const ok = await stu.post('/auth/complete-onboarding', STUDENT_PROFILE);
    expect(ok.status).toBe(200);

    const me = await stu.get('/auth/me');
    expect(me.body.status).toBe('ACTIVE');

    const dash = await stu.get('/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.role).toBe('STUDENT');
    expect(dash.body.profileComplete).toBe(true);
    expect(dash.body.profile.branch).toBe('CSE');

    // profile read + edit (no status change)
    const profile = await stu.get('/me/profile');
    expect(profile.body.cgpa).toBe(8.6);
    const edited = await stu.put('/me/profile', { ...STUDENT_PROFILE, cgpa: 9.1 });
    expect(edited.status).toBe(200);
    expect(edited.body.cgpa).toBe(9.1);
    expect((await stu.get('/auth/me')).body.status).toBe('ACTIVE');
  });

  it('university dashboard is branch-wise sorted and scoped to its own students', async () => {
    const admin = await login(SEED_ADMIN.email, SEED_ADMIN.password);

    // Two universities, each with a student in different branches.
    const setup = async (tag: string, branch: string, roll: string) => {
      const u = await admin.post('/admin/universities', {
        email: `uni-${tag}${TEST_DOMAIN}`,
        name: `Uni ${tag}`,
        code: `U${tag}-${Date.now()}`,
      });
      const uc = await login(`uni-${tag}${TEST_DOMAIN}`, u.body.tempPassword);
      await uc.post('/auth/password', { newPassword: NEW_PW });
      const s = await uc.post('/universities/students', { email: `s-${tag}${TEST_DOMAIN}` });
      const sc = await login(`s-${tag}${TEST_DOMAIN}`, s.body.tempPassword);
      await sc.post('/auth/password', { newPassword: NEW_PW });
      await sc.post('/auth/complete-onboarding', {
        ...STUDENT_PROFILE,
        rollNumber: roll,
        branch,
      });
      return uc;
    };

    const uniA = await setup('A', 'ECE', 'A-100');
    await setup('B', 'MECH', 'B-100');

    const dashA = await uniA.get('/dashboard');
    expect(dashA.status).toBe(200);
    expect(dashA.body.role).toBe('UNIVERSITY');
    // Uni A sees exactly its own 1 student, and never Uni B's.
    expect(dashA.body.counts.students).toBe(1);
    expect(dashA.body.students).toHaveLength(1);
    expect(dashA.body.students[0].branch).toBe('ECE');
    expect(dashA.body.counts.byBranch).toEqual([{ branch: 'ECE', count: 1 }]);
  });

  it('admin dashboard returns platform counts; calendar returns an empty typed payload', async () => {
    const admin = await login(SEED_ADMIN.email, SEED_ADMIN.password);
    const dash = await admin.get('/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.role).toBe('ADMIN');
    expect(typeof dash.body.counts.universities).toBe('number');

    const cal = await admin.get('/calendar/events');
    expect(cal.status).toBe(200);
    // Phase 4 populates real DRIVE events; the contract (a typed events array) is
    // unchanged, but it is no longer guaranteed empty.
    expect(Array.isArray(cal.body.events)).toBe(true);
  });

  it("a user cannot read another role's dashboard (deny-by-default)", async () => {
    const admin = await login(SEED_ADMIN.email, SEED_ADMIN.password);
    const co = await admin.post('/admin/companies', {
      email: `co${TEST_DOMAIN}`,
      name: 'Co',
    });
    const coClient = await login(`co${TEST_DOMAIN}`, co.body.tempPassword);
    await coClient.post('/auth/password', { newPassword: NEW_PW });
    const forbidden = await coClient.get('/dashboard/admin');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });
});
