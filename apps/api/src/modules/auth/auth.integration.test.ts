import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@code-nexus/db';
import { buildTestApp } from '../../test/helpers.js';

// ---- DB availability gate: skip the whole suite when no Postgres is reachable
// (keeps `pnpm test` green in CI, which has no DB — see prompt_phase2.md §13).
async function dbAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
const DB_READY = await dbAvailable();

const TEST_DOMAIN = '@p2test.local';
const SEED_ADMIN = { email: 'admin@codenexus.local', password: 'ChangeMe!123' };
const NEW_PW = 'Str0ngNewPass!23';

async function cleanupTestData(): Promise<void> {
  const where = { user: { email: { endsWith: TEST_DOMAIN } } };
  await prisma.student.deleteMany({ where });
  await prisma.recruiter.deleteMany({ where });
  await prisma.university.deleteMany({ where });
  await prisma.company.deleteMany({ where });
  await prisma.platformAdmin.deleteMany({ where });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
}

/** A stateful client: supertest agent (persists cookies) + CSRF token echo. */
class Client {
  private csrf = '';
  private constructor(private readonly agent: ReturnType<typeof request.agent>) {}

  static async create(app: Express): Promise<Client> {
    const agent = request.agent(app);
    const c = new Client(agent);
    await c.refreshCsrf();
    return c;
  }

  private async refreshCsrf(): Promise<void> {
    const res = await this.agent.get('/health');
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    const csrf = (setCookie ?? []).join(';').match(/cn_csrf=([^;]+)/);
    if (csrf) this.csrf = csrf[1]!;
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

  /** POST without the CSRF header (to prove CSRF rejection). */
  postNoCsrf(path: string, body?: unknown) {
    return this.agent.post(path).send(body ?? {});
  }
}

describe.skipIf(!DB_READY)('Phase 2 auth + RBAC (integration)', () => {
  let app: Express;

  beforeAll(async () => {
    ({ app } = buildTestApp());
    await cleanupTestData();
  });
  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  async function loginAs(emailOrPublicId: string, password: string): Promise<Client> {
    const c = await Client.create(app);
    const res = await c.post('/auth/login', { emailOrPublicId, password });
    expect(res.status).toBe(200);
    return c;
  }

  // Log in the seeded admin, provision + first-login-reset a fresh account.
  async function provisionAndActivate(
    admin: Client,
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<{ publicId: string; email: string; client: Client }> {
    const created = await admin.post(endpoint, body);
    expect(created.status).toBe(201);
    expect(created.body.tempPassword).toBeTruthy();
    expect(JSON.stringify(created.body)).not.toContain('passwordHash');

    const client = await loginAs(body.email as string, created.body.tempPassword);
    // change password (forced reset path — no current password needed)
    const changed = await client.post('/auth/password', { newPassword: NEW_PW });
    expect(changed.status).toBe(200);
    return { publicId: created.body.publicId, email: created.body.email, client };
  }

  it('seeded admin can log in and read /auth/me (no secrets)', async () => {
    const admin = await loginAs(SEED_ADMIN.email, SEED_ADMIN.password);
    const me = await admin.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('ADMIN');
    expect(me.body).not.toHaveProperty('passwordHash');
    expect(me.body.permissions).toContain('university:create');
  });

  it('login is non-enumerating (same error) and rejects bad credentials', async () => {
    const c = await Client.create(app);
    const unknown = await c.post('/auth/login', {
      emailOrPublicId: `nobody${TEST_DOMAIN}`,
      password: 'whatever',
    });
    const wrong = await c.post('/auth/login', {
      emailOrPublicId: SEED_ADMIN.email,
      password: 'wrongpassword',
    });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects mutations without a valid CSRF token', async () => {
    const c = await Client.create(app);
    const res = await c.postNoCsrf('/auth/login', {
      emailOrPublicId: SEED_ADMIN.email,
      password: SEED_ADMIN.password,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF');
  });

  it('forces password change on first login, then unlocks the dashboard', async () => {
    const admin = await loginAs(SEED_ADMIN.email, SEED_ADMIN.password);
    const created = await admin.post('/admin/universities', {
      email: `uni-gate${TEST_DOMAIN}`,
      name: 'Gate University',
      code: `GATE-${Date.now()}`,
    });
    expect(created.status).toBe(201);

    const uni = await loginAs(`uni-gate${TEST_DOMAIN}`, created.body.tempPassword);
    // blocked before password change
    const blocked = await uni.get('/dashboard');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_RESET_REQUIRED');
    // change password → unlock
    const changed = await uni.post('/auth/password', { newPassword: NEW_PW });
    expect(changed.status).toBe(200);
    const dash = await uni.get('/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.role).toBe('UNIVERSITY');
  });

  it('duplicate email → 409 EMAIL_TAKEN', async () => {
    const admin = await loginAs(SEED_ADMIN.email, SEED_ADMIN.password);
    const body = { email: `dupe${TEST_DOMAIN}`, name: 'Dupe Co' };
    const first = await admin.post('/admin/companies', body);
    expect(first.status).toBe(201);
    const second = await admin.post('/admin/companies', body);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('full provisioning chain + role-gated dashboards + cross-role 403', async () => {
    const admin = await loginAs(SEED_ADMIN.email, SEED_ADMIN.password);

    // Admin → University, Company
    const uni = await provisionAndActivate(admin, '/admin/universities', {
      email: `uni1${TEST_DOMAIN}`,
      name: 'Uni One',
      code: `U1-${Date.now()}`,
    });
    const company = await provisionAndActivate(admin, '/admin/companies', {
      email: `co1${TEST_DOMAIN}`,
      name: 'Co One',
    });

    // University → Student (scoped to its own uni, from session)
    const studentCreate = await uni.client.post('/universities/students', {
      email: `stu1${TEST_DOMAIN}`,
    });
    expect(studentCreate.status).toBe(201);

    // Company → Recruiter
    const recruiterCreate = await company.client.post('/companies/recruiters', {
      email: `rec1${TEST_DOMAIN}`,
    });
    expect(recruiterCreate.status).toBe(201);

    // Student first-login → reset → still PENDING_PROFILE → dashboard 403 → onboard → 200
    const student = await loginAs(`stu1${TEST_DOMAIN}`, studentCreate.body.tempPassword);
    await student.post('/auth/password', { newPassword: NEW_PW });
    const pending = await student.get('/dashboard');
    expect(pending.status).toBe(403);
    expect(pending.body.error.code).toBe('PROFILE_INCOMPLETE');
    // Phase 3: complete-onboarding now requires a valid profile body.
    const onboarded = await student.post('/auth/complete-onboarding', {
      firstName: 'Test',
      lastName: 'Student',
      rollNumber: `R-${Date.now()}`,
      branch: 'CSE',
      graduationYear: 2027,
      cgpa: 8,
      phone: '9876543210',
    });
    expect(onboarded.status).toBe(200);
    const studentDash = await student.get('/dashboard');
    expect(studentDash.status).toBe(200);
    expect(studentDash.body.role).toBe('STUDENT');

    // Cross-role: student cannot read the admin dashboard
    const forbidden = await student.get('/dashboard/admin');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    // University cannot create a recruiter (not its permission)
    const noPerm = await uni.client.post('/companies/recruiters', { email: `x${TEST_DOMAIN}` });
    expect(noPerm.status).toBe(403);
  });

  it("ownership scoping: University A cannot suspend University B's student", async () => {
    const admin = await loginAs(SEED_ADMIN.email, SEED_ADMIN.password);
    const uniA = await provisionAndActivate(admin, '/admin/universities', {
      email: `uniA${TEST_DOMAIN}`,
      name: 'Uni A',
      code: `UA-${Date.now()}`,
    });
    const uniB = await provisionAndActivate(admin, '/admin/universities', {
      email: `uniB${TEST_DOMAIN}`,
      name: 'Uni B',
      code: `UB-${Date.now()}`,
    });

    const bStudent = await uniB.client.post('/universities/students', {
      email: `stuB${TEST_DOMAIN}`,
    });
    expect(bStudent.status).toBe(201);

    // Uni A tries to suspend Uni B's student → 403
    const cross = await uniA.client.post(`/accounts/${bStudent.body.publicId}/suspend`);
    expect(cross.status).toBe(403);
    expect(cross.body.error.code).toBe('FORBIDDEN');

    // Uni B (owner) can suspend its own student → 200
    const own = await uniB.client.post(`/accounts/${bStudent.body.publicId}/suspend`);
    expect(own.status).toBe(200);

    // Admin can reset anyone's password
    const reset = await admin.post(`/accounts/${bStudent.body.publicId}/reset-password`);
    expect(reset.status).toBe(200);
    expect(reset.body.tempPassword).toBeTruthy();
  });

  it('suspended user is blocked immediately (live session check)', async () => {
    const admin = await loginAs(SEED_ADMIN.email, SEED_ADMIN.password);
    const uni = await provisionAndActivate(admin, '/admin/universities', {
      email: `uni-susp${TEST_DOMAIN}`,
      name: 'Suspend U',
      code: `US-${Date.now()}`,
    });
    // uni has an active session + dashboard access
    expect((await uni.client.get('/dashboard')).status).toBe(200);

    // admin suspends the university account
    const susp = await admin.post(`/accounts/${uni.publicId}/suspend`);
    expect(susp.status).toBe(200);

    // its existing session is now rejected on the next request
    const after = await uni.client.get('/dashboard');
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('logout invalidates the server session', async () => {
    const admin = await loginAs(SEED_ADMIN.email, SEED_ADMIN.password);
    expect((await admin.get('/auth/me')).status).toBe(200);
    const out = await admin.post('/auth/logout');
    expect(out.status).toBe(200);
    const after = await admin.get('/auth/me');
    expect(after.status).toBe(401);
  });
});
