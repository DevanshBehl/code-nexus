import { prisma } from '@code-nexus/db';
import type {
  AdminDashboard,
  ApplicationStatus,
  CompanyDashboard,
  RecruiterDashboard,
  StudentDashboard,
  StudentListRow,
  UniversityDashboard,
} from '@code-nexus/types';
import type { Express } from 'express';
import { listDrivesForActor } from '../drives/drives.service.js';
import { listContests } from '../contests/contests.service.js';
import { listWebinars } from '../webinars/webinars.service.js';
import { listInterviews } from '../interviews/interviews.service.js';

type Auth = Express.AuthContext;

function decToNum(d: unknown): number | null {
  if (d == null) return null;
  return typeof d === 'number' ? d : Number((d as { toString(): string }).toString());
}

/** Group applications by status for a scope; returns a status→count lookup. */
async function applicationCounts(
  where: import('@code-nexus/db').Prisma.ApplicationWhereInput,
): Promise<(s: ApplicationStatus) => number> {
  const grouped = await prisma.application.groupBy({
    by: ['status'],
    where: { deletedAt: null, ...where },
    _count: { _all: true },
  });
  return (s: ApplicationStatus) => grouped.find((g) => g.status === s)?._count._all ?? 0;
}

export async function studentDashboard(auth: Auth): Promise<StudentDashboard> {
  const s = await prisma.student.findUniqueOrThrow({
    where: { userId: auth.userId },
    include: { university: true },
  });
  const complete = Boolean(
    s.firstName && s.lastName && s.rollNumber && s.branch && s.graduationYear && s.cgpa && s.phone,
  );

  const upcomingDrives = (await listDrivesForActor(auth)).slice(0, 5);
  const count = await applicationCounts({ studentId: s.id });
  // Phase 7 — active contests (not ended/cancelled), soonest first.
  const contests = (await listContests(auth))
    .filter((c) => c.phase === 'upcoming' || c.phase === 'open' || c.phase === 'running')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 5);
  // Phase 8 — upcoming/live webinars (not ended), soonest first.
  const webinars = (await listWebinars(auth))
    .filter((w) => w.status === 'SCHEDULED' || w.status === 'LIVE')
    .sort((a, b) => a.scheduledStartsAt.localeCompare(b.scheduledStartsAt))
    .slice(0, 5);
  // Phase 9 — upcoming/live interviews for this student.
  const interviews = (await listInterviews(auth))
    .filter((i) => i.status === 'SCHEDULED' || i.status === 'LIVE')
    .sort((a, b) => a.scheduledStartsAt.localeCompare(b.scheduledStartsAt))
    .slice(0, 5);

  return {
    role: 'STUDENT',
    profileComplete: complete,
    profile: {
      firstName: s.firstName,
      lastName: s.lastName,
      rollNumber: s.rollNumber,
      branch: s.branch,
      graduationYear: s.graduationYear,
      cgpa: decToNum(s.cgpa),
      university: s.university.name,
    },
    upcomingDrives,
    applications: {
      total:
        count('APPLIED') +
        count('SHORTLISTED') +
        count('OFFERED') +
        count('REJECTED') +
        count('WITHDRAWN'),
      active: count('APPLIED') + count('SHORTLISTED'),
      offers: count('OFFERED'),
      rejected: count('REJECTED'),
    },
    contests,
    webinars,
    interviews,
  };
}

export async function universityDashboard(auth: Auth): Promise<UniversityDashboard> {
  const universityId = auth.universityId;
  if (!universityId) throw new Error('No university in scope');

  const uni = await prisma.university.findUniqueOrThrow({ where: { id: universityId } });
  const students = await prisma.student.findMany({
    where: { universityId, deletedAt: null },
    include: { user: true },
    // Branch-wise sorted (branch asc, then roll number).
    orderBy: [{ branch: 'asc' }, { rollNumber: 'asc' }],
  });

  const rows: StudentListRow[] = students.map((s) => ({
    publicId: s.user.publicId,
    email: s.user.email,
    status: s.user.status,
    firstName: s.firstName,
    lastName: s.lastName,
    rollNumber: s.rollNumber,
    branch: s.branch,
    graduationYear: s.graduationYear,
    cgpa: decToNum(s.cgpa),
  }));

  const byBranchMap = new Map<string, number>();
  for (const s of students) {
    const b = s.branch ?? 'Unassigned';
    byBranchMap.set(b, (byBranchMap.get(b) ?? 0) + 1);
  }
  const byBranch = [...byBranchMap.entries()]
    .map(([branch, count]) => ({ branch, count }))
    .sort((a, b) => a.branch.localeCompare(b.branch));

  const drives = await listDrivesForActor(auth);
  const count = await applicationCounts({ student: { universityId } });
  const contests = (await listContests(auth)).slice(0, 5);
  const webinars = (await listWebinars(auth)).slice(0, 5);
  const interviews = (await listInterviews(auth)).slice(0, 5);

  return {
    role: 'UNIVERSITY',
    university: { name: uni.name, code: uni.code },
    counts: { students: students.length, byBranch },
    students: rows,
    drives,
    placement: {
      applied: count('APPLIED'),
      shortlisted: count('SHORTLISTED'),
      offered: count('OFFERED'),
      rejected: count('REJECTED'),
    },
    contests,
    webinars,
    interviews,
  };
}

export async function companyDashboard(auth: Auth): Promise<CompanyDashboard> {
  const companyId = auth.companyId;
  if (!companyId) throw new Error('No company in scope');

  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const recruiters = await prisma.recruiter.findMany({
    where: { companyId, deletedAt: null },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });

  const [driveCount, openDrives, applicants] = await Promise.all([
    prisma.drive.count({ where: { companyId, deletedAt: null } }),
    prisma.drive.count({ where: { companyId, deletedAt: null, status: 'OPEN' } }),
    prisma.application.count({ where: { deletedAt: null, drive: { companyId } } }),
  ]);
  const drives = await listDrivesForActor(auth);
  const contests = (await listContests(auth)).slice(0, 5);
  const webinars = (await listWebinars(auth)).slice(0, 5);
  const interviews = (await listInterviews(auth)).slice(0, 5);

  return {
    role: 'COMPANY',
    company: { name: company.name },
    counts: { recruiters: recruiters.length, drives: driveCount, openDrives, applicants },
    recruiters: recruiters.map((r) => ({
      publicId: r.user.publicId,
      email: r.user.email,
      status: r.user.status,
      firstName: r.firstName,
      lastName: r.lastName,
      designation: r.designation,
    })),
    drives,
    contests,
    webinars,
    interviews,
  };
}

export async function recruiterDashboard(auth: Auth): Promise<RecruiterDashboard> {
  const r = await prisma.recruiter.findUniqueOrThrow({
    where: { userId: auth.userId },
    include: { company: true },
  });
  return {
    role: 'RECRUITER',
    profile: {
      firstName: r.firstName,
      lastName: r.lastName,
      designation: r.designation,
      company: r.company.name,
    },
  };
}

export async function adminDashboard(): Promise<AdminDashboard> {
  const [
    universities,
    companies,
    students,
    recruiters,
    suspended,
    drives,
    openDrives,
    applications,
  ] = await Promise.all([
    prisma.university.count({ where: { deletedAt: null } }),
    prisma.company.count({ where: { deletedAt: null } }),
    prisma.student.count({ where: { deletedAt: null } }),
    prisma.recruiter.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { status: 'SUSPENDED', deletedAt: null } }),
    prisma.drive.count({ where: { deletedAt: null } }),
    prisma.drive.count({ where: { deletedAt: null, status: 'OPEN' } }),
    prisma.application.count({ where: { deletedAt: null } }),
  ]);
  return {
    role: 'ADMIN',
    counts: {
      universities,
      companies,
      students,
      recruiters,
      suspended,
      drives,
      openDrives,
      applications,
    },
  };
}
