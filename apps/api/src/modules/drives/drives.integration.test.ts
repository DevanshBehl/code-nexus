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

const TEST_DOMAIN = '@p4test.local';
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
  const userWhere = { user: { email: { endsWith: TEST_DOMAIN } } };
  // Phase 5: offer/reject decisions create system mails; clear them first so the
  // users they reference can be deleted.
  await prisma.mailRecipient.deleteMany({
    where: {
      OR: [
        { recipient: { email: { endsWith: TEST_DOMAIN } } },
        { mail: { sender: { email: { endsWith: TEST_DOMAIN } } } },
      ],
    },
  });
  await prisma.mail.deleteMany({ where: { sender: { email: { endsWith: TEST_DOMAIN } } } });
  await prisma.application.deleteMany({ where: { student: userWhere } });
  await prisma.drive.deleteMany({ where: { company: userWhere } });
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
  get(path: string) {
    return this.agent.get(path);
  }
  post(path: string, body?: unknown) {
    return this.agent
      .post(path)
      .set('x-csrf-token', this.csrf)
      .send(body ?? {});
  }
  patch(path: string, body?: unknown) {
    return this.agent
      .patch(path)
      .set('x-csrf-token', this.csrf)
      .send(body ?? {});
  }
}

const FUTURE = () => new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();

describe.skipIf(!DB_READY)('Phase 4 drives + applications (integration)', () => {
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

  /** Provision a university + one active student (returns clients + ids). */
  async function makeUniversityWithStudent(
    tag: string,
    profile = STUDENT_PROFILE,
  ): Promise<{ uni: Client; student: Client; universityPublicId: string }> {
    const admin = await login(SEED_ADMIN.email, SEED_ADMIN.password);
    const uniRes = await admin.post('/admin/universities', {
      email: `uni-${tag}${TEST_DOMAIN}`,
      name: `Uni ${tag}`,
      code: `U${tag}-${Date.now()}`,
    });
    expect(uniRes.status).toBe(201);
    // The provisioning result returns the login User's publicId; a Drive targets
    // the University row's own publicId (what GET /directory/universities lists).
    const uniRow = await prisma.university.findFirstOrThrow({
      where: { user: { email: `uni-${tag}${TEST_DOMAIN}`.toLowerCase() } },
    });
    const universityPublicId = uniRow.publicId;
    const uni = await login(`uni-${tag}${TEST_DOMAIN}`, uniRes.body.tempPassword);
    await uni.post('/auth/password', { newPassword: NEW_PW });

    const stuRes = await uni.post('/universities/students', { email: `stu-${tag}${TEST_DOMAIN}` });
    const student = await login(`stu-${tag}${TEST_DOMAIN}`, stuRes.body.tempPassword);
    await student.post('/auth/password', { newPassword: NEW_PW });
    await student.post('/auth/complete-onboarding', {
      ...profile,
      rollNumber: `${tag}-${Date.now()}`,
    });
    return { uni, student, universityPublicId };
  }

  async function makeCompany(tag: string): Promise<Client> {
    const admin = await login(SEED_ADMIN.email, SEED_ADMIN.password);
    const coRes = await admin.post('/admin/companies', {
      email: `co-${tag}${TEST_DOMAIN}`,
      name: `Co ${tag}`,
    });
    const co = await login(`co-${tag}${TEST_DOMAIN}`, coRes.body.tempPassword);
    await co.post('/auth/password', { newPassword: NEW_PW });
    return co;
  }

  it('full funnel: create→publish→apply→shortlist→offer, with tracking', async () => {
    const { uni, student, universityPublicId } = await makeUniversityWithStudent('F');
    const company = await makeCompany('F');

    // The company can discover the target university via the directory.
    const dir = await company.get('/directory/universities');
    expect(dir.status).toBe(200);
    expect(
      dir.body.universities.some((u: { publicId: string }) => u.publicId === universityPublicId),
    ).toBe(true);

    // Create a DRAFT drive.
    const created = await company.post('/drives', {
      universityPublicId,
      title: 'Backend Engineer Intern',
      description: 'Build APIs with us.',
      minCgpa: 7,
      allowedBranches: ['CSE'],
      allowedGraduationYears: [2026],
      applyDeadline: FUTURE(),
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('DRAFT');
    const drivePid = created.body.publicId as string;

    // Student cannot see a DRAFT drive.
    expect((await student.get('/drives')).body.drives).toHaveLength(0);

    // Publish → OPEN.
    const published = await company.post(`/drives/${drivePid}/publish`);
    expect(published.status).toBe(200);
    expect(published.body.status).toBe('OPEN');

    // Student now sees it and is eligible.
    const feed = await student.get('/drives');
    expect(feed.body.drives).toHaveLength(1);
    const detail = await student.get(`/drives/${drivePid}`);
    expect(detail.body.eligibility.eligible).toBe(true);

    // Apply.
    const applied = await student.post(`/drives/${drivePid}/apply`);
    expect(applied.status).toBe(201);
    expect(applied.body.status).toBe('APPLIED');
    const appPid = applied.body.publicId as string;

    // Apply-once → 409.
    const dup = await student.post(`/drives/${drivePid}/apply`);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');

    // Company sees the applicant with academic details.
    const applicants = await company.get(`/drives/${drivePid}/applicants`);
    expect(applicants.status).toBe(200);
    expect(applicants.body.applicants).toHaveLength(1);
    expect(applicants.body.applicants[0].branch).toBe('CSE');
    expect(applicants.body.applicants[0].cgpa).toBe(8.6);

    // Illegal transition APPLIED→OFFERED → 409.
    const bad = await company.patch(`/applications/${appPid}`, { status: 'OFFERED' });
    expect(bad.status).toBe(409);

    // Shortlist → Offer.
    expect((await company.patch(`/applications/${appPid}`, { status: 'SHORTLISTED' })).status).toBe(
      200,
    );
    const offered = await company.patch(`/applications/${appPid}`, { status: 'OFFERED' });
    expect(offered.status).toBe(200);
    expect(offered.body.status).toBe('OFFERED');

    // Student sees the offer on their applications.
    const mine = await student.get('/applications');
    expect(mine.body.applications[0].status).toBe('OFFERED');

    // University placement tracking counts the offer.
    const dash = await uni.get('/dashboard');
    expect(dash.body.placement.offered).toBe(1);
    const uniApps = await uni.get('/applications');
    expect(uniApps.body.applications[0].status).toBe('OFFERED');
  });

  it('rejects an ineligible student and does not surface the drive', async () => {
    // Student with low CGPA.
    const { student, universityPublicId } = await makeUniversityWithStudent('E', {
      ...STUDENT_PROFILE,
      cgpa: 6.0,
    });
    const company = await makeCompany('E');
    const created = await company.post('/drives', {
      universityPublicId,
      title: 'High Bar Role',
      description: 'Top students only.',
      minCgpa: 8,
      allowedBranches: [],
      allowedGraduationYears: [],
      applyDeadline: FUTURE(),
    });
    await company.post(`/drives/${created.body.publicId}/publish`);

    // Not in the eligible feed.
    expect((await student.get('/drives')).body.drives).toHaveLength(0);
    // Direct apply is refused.
    const applied = await student.post(`/drives/${created.body.publicId}/apply`);
    expect(applied.status).toBe(403);
    expect(applied.body.error.code).toBe('NOT_ELIGIBLE');
  });

  it('withdraw is allowed from active states and terminal afterwards', async () => {
    const { student, universityPublicId } = await makeUniversityWithStudent('W');
    const company = await makeCompany('W');
    const created = await company.post('/drives', {
      universityPublicId,
      title: 'Withdrawable Role',
      description: 'Apply then leave.',
      applyDeadline: FUTURE(),
    });
    await company.post(`/drives/${created.body.publicId}/publish`);
    const applied = await student.post(`/drives/${created.body.publicId}/apply`);
    const appPid = applied.body.publicId as string;

    const withdrawn = await student.post(`/applications/${appPid}/withdraw`);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.status).toBe('WITHDRAWN');

    // Company can no longer shortlist a withdrawn application.
    const shortlist = await company.patch(`/applications/${appPid}`, { status: 'SHORTLISTED' });
    expect(shortlist.status).toBe(409);
  });

  it('enforces cross-tenant ownership (404, no existence leak)', async () => {
    const a = await makeUniversityWithStudent('A');
    const b = await makeUniversityWithStudent('B');
    const companyA = await makeCompany('AA');
    const companyB = await makeCompany('BB');

    const created = await companyA.post('/drives', {
      universityPublicId: a.universityPublicId,
      title: 'Company A Drive',
      description: 'Only for Uni A.',
      applyDeadline: FUTURE(),
    });
    const drivePid = created.body.publicId as string;
    await companyA.post(`/drives/${drivePid}/publish`);

    // Company B cannot read or manage Company A's drive.
    expect((await companyB.get(`/drives/${drivePid}`)).status).toBe(404);
    expect((await companyB.get(`/drives/${drivePid}/applicants`)).status).toBe(404);
    expect((await companyB.post(`/drives/${drivePid}/close`)).status).toBe(404);

    // Uni B's student cannot see or apply to Uni A's drive.
    expect((await b.student.get('/drives')).body.drives).toHaveLength(0);
    expect((await b.student.post(`/drives/${drivePid}/apply`)).status).toBe(404);
  });

  it('recruiter cannot access drives (deny-by-default)', async () => {
    const company = await makeCompany('R');
    const recRes = await company.post('/companies/recruiters', { email: `rec-R${TEST_DOMAIN}` });
    const rec = await login(`rec-R${TEST_DOMAIN}`, recRes.body.tempPassword);
    await rec.post('/auth/password', { newPassword: NEW_PW });
    await rec.post('/auth/complete-onboarding', {
      firstName: 'Rec',
      lastName: 'Ruiter',
      designation: 'HR',
      phone: '+91 90000 00000',
    });
    const res = await rec.get('/drives');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('surfaces DRIVE calendar events, role-scoped', async () => {
    const { uni, student, universityPublicId } = await makeUniversityWithStudent('C');
    const company = await makeCompany('C');
    const created = await company.post('/drives', {
      universityPublicId,
      title: 'Calendar Drive',
      description: 'Shows on the calendar.',
      applyDeadline: FUTURE(),
    });
    // DRAFT: not on student/university calendars.
    expect((await student.get('/calendar/events')).body.events).toHaveLength(0);
    await company.post(`/drives/${created.body.publicId}/publish`);

    const studentCal = await student.get('/calendar/events');
    expect(studentCal.body.events).toHaveLength(1);
    expect(studentCal.body.events[0].type).toBe('DRIVE');
    expect((await uni.get('/calendar/events')).body.events).toHaveLength(1);
    expect((await company.get('/calendar/events')).body.events).toHaveLength(1);
  });
});
