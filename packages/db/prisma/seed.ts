import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { QUESTIONS, starterCodeFor } from './questions.js';

/**
 * Idempotent seed (prompt_phase1.md §6.4): safe to run repeatedly.
 * Seeds exactly one PlatformAdmin, one demo University, one demo Company.
 * Passwords are bcrypt-hashed (realistic, never plaintext) even though auth
 * logic itself lands in Phase 2.
 *
 * All credentials here are LOCAL-DEV demo values only.
 */
const prisma = new PrismaClient();

// Demo credentials (local dev only).
const DEMO_PASSWORD = 'ChangeMe!123';

async function hash(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

async function upsertPlatformAdmin(): Promise<void> {
  const email = 'admin@codenexus.local';
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await hash(DEMO_PASSWORD),
      role: Role.ADMIN,
      status: 'ACTIVE',
      mustResetPassword: false,
    },
  });
  await prisma.platformAdmin.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, firstName: 'Code', lastName: 'Nexus' },
  });
}

async function upsertUniversity(): Promise<void> {
  const email = 'university@codenexus.local';
  const code = 'DEMO-UNI';
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await hash(DEMO_PASSWORD),
      role: Role.UNIVERSITY,
      status: 'ACTIVE',
      mustResetPassword: false,
    },
  });
  await prisma.university.upsert({
    where: { code },
    update: {},
    create: { name: 'Demo University', code, userId: user.id },
  });
}

async function upsertCompany(): Promise<void> {
  const email = 'company@codenexus.local';
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await hash(DEMO_PASSWORD),
      role: Role.COMPANY,
      status: 'ACTIVE',
      mustResetPassword: false,
    },
  });
  await prisma.company.upsert({
    where: { userId: user.id },
    update: {},
    create: { name: 'Demo Company', userId: user.id },
  });
}

/**
 * A demo recruiter for the Demo Company — the person who actually conducts an
 * interview. Without one, the company dashboard's Recruiters panel is empty and
 * the "additional interviewers" picker on the schedule form has nothing to offer.
 */
async function upsertRecruiter(): Promise<void> {
  const email = 'recruiter@codenexus.local';
  const company = await prisma.company.findFirst({ where: { name: 'Demo Company' } });
  if (!company) return;
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await hash(DEMO_PASSWORD),
      role: Role.RECRUITER,
      status: 'ACTIVE',
      mustResetPassword: false,
    },
  });
  await prisma.recruiter.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      companyId: company.id,
      firstName: 'Riya',
      lastName: 'Recruiter',
      designation: 'Engineering Manager',
    },
  });
}

/**
 * A demo student at the Demo University — the interview candidate.
 * Profile fields are filled in so the account skips the complete-profile gate.
 */
async function upsertStudent(): Promise<void> {
  const email = 'student@codenexus.local';
  const university = await prisma.university.findFirst({ where: { code: 'DEMO-UNI' } });
  if (!university) return;
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await hash(DEMO_PASSWORD),
      role: Role.STUDENT,
      status: 'ACTIVE',
      mustResetPassword: false,
    },
  });
  await prisma.student.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      universityId: university.id,
      firstName: 'Sam',
      lastName: 'Student',
      rollNumber: 'DEMO-2026-001',
      branch: 'Computer Science',
      graduationYear: 2026,
      cgpa: 8.5,
      phone: '+911234567890',
    },
  });
}

/**
 * A published drive plus a SHORTLISTED application for the demo student.
 *
 * This exists purely so the interview flow is reachable: `ScheduleInterview`
 * lists candidates by walking the host's drives → shortlisted applicants, so
 * without a shortlisted application there is literally no one to interview.
 */
async function upsertDemoDriveAndApplication(): Promise<void> {
  const company = await prisma.company.findFirst({ where: { name: 'Demo Company' } });
  const university = await prisma.university.findFirst({ where: { code: 'DEMO-UNI' } });
  const student = await prisma.student.findFirst({ where: { rollNumber: 'DEMO-2026-001' } });
  if (!company || !university || !student) return;

  const existing = await prisma.drive.findFirst({
    where: { title: 'SDE-1 Campus Hiring 2026', companyId: company.id },
  });
  const drive =
    existing ??
    (await prisma.drive.create({
      data: {
        title: 'SDE-1 Campus Hiring 2026',
        description: 'Backend and full-stack roles for the 2026 graduating batch.',
        roleTitle: 'SDE-1',
        location: 'Bengaluru',
        ctcAnnual: 1800000,
        allowedBranches: ['Computer Science'],
        allowedGraduationYears: [2026],
        // Comfortably in the future so the drive stays open in demos.
        applyDeadline: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        status: 'PUBLISHED',
        companyId: company.id,
        universityId: university.id,
      },
    }));

  await prisma.application.upsert({
    where: { driveId_studentId: { driveId: drive.id, studentId: student.id } },
    update: {},
    // SHORTLISTED is the status the schedule form filters on.
    create: { driveId: drive.id, studentId: student.id, status: 'SHORTLISTED' },
  });
}

// --- Phase 6: Code Arena question bank ---------------------------------------
//
// The bank itself (statements, testcases and the per-language starter code that
// comes with each question) lives in `questions.ts` — it is content, and it had
// outgrown being a literal in the middle of the account seeding.

async function seedQuestions(): Promise<void> {
  for (const def of QUESTIONS) {
    const shared = {
      title: def.title,
      description: def.description,
      constraints: def.constraints ?? null,
      difficulty: def.difficulty,
      topic: def.topic,
      // Re-seeded on every run: a stub that has drifted from the statement it
      // belongs to is worse than no stub, and this is the only place either is
      // authored.
      starterCode: starterCodeFor(def),
      published: true,
    };
    const q = await prisma.question.upsert({
      where: { slug: def.slug },
      update: shared,
      create: { slug: def.slug, ...shared },
    });
    const existing = await prisma.testCase.count({ where: { questionId: q.id } });
    if (existing === 0) {
      await prisma.testCase.createMany({
        data: def.tests.map((t, i) => ({
          questionId: q.id,
          input: t.input,
          expectedOutput: t.expectedOutput,
          isSample: t.isSample,
          ordinal: i + 1,
        })),
      });
    }
  }
}

async function main(): Promise<void> {
  await upsertPlatformAdmin();
  await upsertUniversity();
  await upsertCompany();
  await upsertRecruiter();
  await upsertStudent();
  await upsertDemoDriveAndApplication();
  await seedQuestions();
  console.log(
    `✓ Seed complete (PlatformAdmin, University, Company, Recruiter, Student,\n` +
      `  1 published drive + 1 SHORTLISTED application, ${QUESTIONS.length} arena questions).`,
  );
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
