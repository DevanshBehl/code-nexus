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

const TEST_DOMAIN = '@p5test.local';
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

async function cleanup(): Promise<void> {
  const userWhere = { user: { email: { endsWith: TEST_DOMAIN } } };
  // Remove recipient rows for any mail touching the test domain (sender OR
  // recipient) before deleting the mails/users they reference.
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
  publicId = '';
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
  async loadPublicId(): Promise<string> {
    const me = await this.get('/auth/me');
    this.publicId = me.body.publicId;
    return this.publicId;
  }
}

const FUTURE = () => new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();

describe.skipIf(!DB_READY)('Phase 5 internal mail (integration)', () => {
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

  /** Provision uni + active student; return clients + the uni's login publicId. */
  async function makeUniAndStudent(tag: string, roll: string) {
    const admin = await login(SEED_ADMIN.email, SEED_ADMIN.password);
    const uniRes = await admin.post('/admin/universities', {
      email: `uni-${tag}${TEST_DOMAIN}`,
      name: `Uni ${tag}`,
      code: `U${tag}-${Date.now()}`,
    });
    const uni = await login(`uni-${tag}${TEST_DOMAIN}`, uniRes.body.tempPassword);
    await uni.post('/auth/password', { newPassword: NEW_PW });
    await uni.loadPublicId();

    const stuRes = await uni.post('/universities/students', { email: `stu-${tag}${TEST_DOMAIN}` });
    const student = await login(`stu-${tag}${TEST_DOMAIN}`, stuRes.body.tempPassword);
    await student.post('/auth/password', { newPassword: NEW_PW });
    await student.post('/auth/complete-onboarding', { ...STUDENT_PROFILE, rollNumber: roll });
    await student.loadPublicId();
    return { uni, student };
  }

  async function makeCompany(tag: string) {
    const admin = await login(SEED_ADMIN.email, SEED_ADMIN.password);
    const coRes = await admin.post('/admin/companies', {
      email: `co-${tag}${TEST_DOMAIN}`,
      name: `Co ${tag}`,
    });
    const co = await login(`co-${tag}${TEST_DOMAIN}`, coRes.body.tempPassword);
    await co.post('/auth/password', { newPassword: NEW_PW });
    await co.loadPublicId();
    return co;
  }

  it('student → own university delivers; sender sees it in sent box', async () => {
    const { uni, student } = await makeUniAndStudent('D', 'D-1');

    const send = await student.post('/mail', {
      recipientPublicIds: [uni.publicId],
      subject: 'Question about the drive',
      body: 'Hello, I have a question.',
    });
    expect(send.status).toBe(201);

    // University inbox has it, unread.
    const inbox = await uni.get('/mail/inbox');
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.items[0].read).toBe(false);
    expect(inbox.body.items[0].subject).toBe('Question about the drive');

    // Student sent box has it.
    const sent = await student.get('/mail/sent');
    expect(sent.body.items).toHaveLength(1);

    // Reading it marks it read + drops the unread count.
    const mailId = inbox.body.items[0].publicId;
    expect((await uni.get('/mail/unread-count')).body.count).toBe(1);
    const detail = await uni.get(`/mail/${mailId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.body).toBe('Hello, I have a question.');
    expect((await uni.get('/mail/unread-count')).body.count).toBe(0);
  });

  it('enforces directional rules', async () => {
    const a = await makeUniAndStudent('R1', 'R1-1');
    const b = await makeUniAndStudent('R2', 'R2-1');
    const company = await makeCompany('R');
    const admin = await login(SEED_ADMIN.email, SEED_ADMIN.password);
    await admin.loadPublicId();

    // Student → admin ✅
    expect(
      (
        await a.student.post('/mail', {
          recipientPublicIds: [admin.publicId],
          subject: 's',
          body: 'b',
        })
      ).status,
    ).toBe(201);
    // Student → company ❌ (403)
    expect(
      (
        await a.student.post('/mail', {
          recipientPublicIds: [company.publicId],
          subject: 's',
          body: 'b',
        })
      ).status,
    ).toBe(403);
    // Student → another student ❌
    expect(
      (
        await a.student.post('/mail', {
          recipientPublicIds: [b.student.publicId],
          subject: 's',
          body: 'b',
        })
      ).status,
    ).toBe(403);

    // University → its own student ✅ but → another uni's student ❌
    expect(
      (
        await a.uni.post('/mail', {
          recipientPublicIds: [a.student.publicId],
          subject: 's',
          body: 'b',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await a.uni.post('/mail', {
          recipientPublicIds: [b.student.publicId],
          subject: 's',
          body: 'b',
        })
      ).status,
    ).toBe(403);

    // Company → anyone ✅
    expect(
      (
        await company.post('/mail', {
          recipientPublicIds: [a.student.publicId],
          subject: 's',
          body: 'b',
        })
      ).status,
    ).toBe(201);

    // Cannot mail yourself → 400
    expect(
      (
        await a.student.post('/mail', {
          recipientPublicIds: [a.student.publicId],
          subject: 's',
          body: 'b',
        })
      ).status,
    ).toBe(400);
  });

  it('a non-participant cannot read a mail (404, no leak)', async () => {
    const a = await makeUniAndStudent('X', 'X-1');
    const company = await makeCompany('X');
    const send = await company.post('/mail', {
      recipientPublicIds: [a.student.publicId],
      subject: 'private',
      body: 'secret',
    });
    const mailId = send.body.publicId;
    // The uni is neither sender nor recipient.
    expect((await a.uni.get(`/mail/${mailId}`)).status).toBe(404);
    // The recipient can read it.
    expect((await a.student.get(`/mail/${mailId}`)).status).toBe(200);
  });

  it('offer/reject decision auto-notifies the student; shortlist does not', async () => {
    const { student } = await makeUniAndStudent('N', 'N-1');
    const company = await makeCompany('N');
    const uniRow = await prisma.university.findFirstOrThrow({
      where: { user: { email: `uni-N${TEST_DOMAIN}`.toLowerCase() } },
    });

    const created = await company.post('/drives', {
      universityPublicId: uniRow.publicId,
      title: 'Notify Role',
      description: 'Test decision mail.',
      applyDeadline: FUTURE(),
    });
    await company.post(`/drives/${created.body.publicId}/publish`);
    const applied = await student.post(`/drives/${created.body.publicId}/apply`);
    const appPid = applied.body.publicId;

    // Shortlist → no mail yet.
    await company.patch(`/applications/${appPid}`, { status: 'SHORTLISTED' });
    expect((await student.get('/mail/inbox')).body.items).toHaveLength(0);

    // Offer → a system mail from the company lands in the student's inbox.
    await company.patch(`/applications/${appPid}`, { status: 'OFFERED' });
    const inbox = await student.get('/mail/inbox');
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.items[0].system).toBe(true);
    expect(inbox.body.items[0].subject).toContain('Notify Role');
    expect(inbox.body.items[0].sender.role).toBe('COMPANY');
  });

  it('contacts are role-scoped; company must search', async () => {
    const { uni, student } = await makeUniAndStudent('C', 'C-1');
    const company = await makeCompany('C');

    // Student contacts include their university + admin(s), never a company.
    const stuContacts = await student.get('/mail/contacts');
    expect(stuContacts.body.searchRequired).toBe(false);
    const roles = stuContacts.body.contacts.map((c: { role: string }) => c.role);
    expect(roles).toContain('UNIVERSITY');
    expect(roles).not.toContain('COMPANY');

    // University contacts include its own student.
    const uniContacts = await uni.get('/mail/contacts');
    expect(
      uniContacts.body.contacts.some((c: { publicId: string }) => c.publicId === student.publicId),
    ).toBe(true);

    // Company must provide a query.
    expect((await company.get('/mail/contacts')).body.searchRequired).toBe(true);
    expect((await company.get('/mail/contacts')).body.contacts).toHaveLength(0);
    const searched = await company.get(`/mail/contacts?q=Uni C`);
    expect(searched.body.contacts.length).toBeGreaterThan(0);
  });
});
