import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

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

// --- Phase 6: Code Arena question bank (stdin/stdout model) -------------------

interface SeedTest {
  input: string;
  expectedOutput: string;
  isSample: boolean;
}
interface SeedQuestion {
  slug: string;
  title: string;
  description: string;
  constraints?: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  topic: 'ARRAY' | 'STRING' | 'MATH' | 'HASHMAP' | 'STACK_QUEUE';
  tests: SeedTest[];
}

const QUESTIONS: SeedQuestion[] = [
  {
    slug: 'double-the-number',
    title: 'Double the Number',
    description: 'Read a single integer n from standard input and print n * 2.',
    constraints: '-10^9 <= n <= 10^9',
    difficulty: 'EASY',
    topic: 'MATH',
    tests: [
      { input: '2', expectedOutput: '4', isSample: true },
      { input: '10', expectedOutput: '20', isSample: false },
      { input: '-3', expectedOutput: '-6', isSample: false },
      { input: '0', expectedOutput: '0', isSample: false },
    ],
  },
  {
    slug: 'sum-of-two',
    title: 'Sum of Two Numbers',
    description:
      'The input contains two space-separated integers a and b on one line. Print a + b.',
    difficulty: 'EASY',
    topic: 'MATH',
    tests: [
      { input: '3 5', expectedOutput: '8', isSample: true },
      { input: '100 250', expectedOutput: '350', isSample: false },
      { input: '-4 4', expectedOutput: '0', isSample: false },
    ],
  },
  {
    slug: 'reverse-string',
    title: 'Reverse a String',
    description: 'Read a single line string s and print it reversed.',
    difficulty: 'EASY',
    topic: 'STRING',
    tests: [
      { input: 'hello', expectedOutput: 'olleh', isSample: true },
      { input: 'codenexus', expectedOutput: 'suxenedoc', isSample: false },
      { input: 'a', expectedOutput: 'a', isSample: false },
    ],
  },
  {
    slug: 'max-in-array',
    title: 'Maximum in an Array',
    description:
      'The first line contains an integer n. The second line contains n space-separated integers. Print the maximum.',
    constraints: '1 <= n <= 10^5',
    difficulty: 'EASY',
    topic: 'ARRAY',
    tests: [
      { input: '5\n3 7 2 9 4', expectedOutput: '9', isSample: true },
      { input: '3\n-1 -5 -3', expectedOutput: '-1', isSample: false },
      { input: '1\n42', expectedOutput: '42', isSample: false },
    ],
  },
  {
    slug: 'count-vowels',
    title: 'Count the Vowels',
    description: 'Read a single line string and print the number of vowels (a, e, i, o, u) in it.',
    difficulty: 'EASY',
    topic: 'HASHMAP',
    tests: [
      { input: 'education', expectedOutput: '5', isSample: true },
      { input: 'rhythm', expectedOutput: '0', isSample: false },
      { input: 'aeiou', expectedOutput: '5', isSample: false },
    ],
  },
  {
    slug: 'balanced-brackets',
    title: 'Balanced Brackets',
    description:
      'Read a single line containing only the characters ()[]{}. Print "YES" if the brackets are balanced, otherwise "NO".',
    difficulty: 'MEDIUM',
    topic: 'STACK_QUEUE',
    tests: [
      { input: '([]{})', expectedOutput: 'YES', isSample: true },
      { input: '([)]', expectedOutput: 'NO', isSample: false },
      { input: '(((', expectedOutput: 'NO', isSample: false },
      { input: '{[()]}', expectedOutput: 'YES', isSample: false },
    ],
  },
];

async function seedQuestions(): Promise<void> {
  for (const def of QUESTIONS) {
    const q = await prisma.question.upsert({
      where: { slug: def.slug },
      update: {
        title: def.title,
        description: def.description,
        constraints: def.constraints ?? null,
        difficulty: def.difficulty,
        topic: def.topic,
        published: true,
      },
      create: {
        slug: def.slug,
        title: def.title,
        description: def.description,
        constraints: def.constraints ?? null,
        difficulty: def.difficulty,
        topic: def.topic,
        published: true,
      },
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
