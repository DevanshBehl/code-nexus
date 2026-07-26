import { Prisma, prisma } from '@code-nexus/db';
import { evaluateEligibility, type CalendarEvent } from '@code-nexus/types';
import type { Express } from 'express';
import { decToNum, loadStudentFacts } from '../drives/drives.service.js';

type Auth = Express.AuthContext;

/** Deep-link a drive event to the role's drive view. */
function driveUrl(role: Auth['role'], publicId: string): string | undefined {
  switch (role) {
    case 'STUDENT':
      return `/app/student/drives/${publicId}`;
    case 'COMPANY':
      return `/app/company/drives/${publicId}`;
    case 'UNIVERSITY':
      return `/app/university/drives`;
    default:
      return undefined;
  }
}

/**
 * Phase 4 — real DRIVE calendar events (apply deadlines), role-scoped:
 *   STUDENT   → eligible OPEN drives for their university
 *   COMPANY   → its own drives
 *   UNIVERSITY→ drives targeting it (non-DRAFT)
 *   ADMIN     → all drives
 * Honors the optional [from, to] range against the apply deadline. DRAFT drives
 * are never shown to students/universities.
 */
export async function listCalendarEvents(
  auth: Auth,
  range: { from?: string; to?: string },
): Promise<CalendarEvent[]> {
  const deadlineFilter: Prisma.DateTimeFilter = {};
  if (range.from) deadlineFilter.gte = new Date(range.from);
  if (range.to) deadlineFilter.lte = new Date(range.to);
  const applyDeadline = Object.keys(deadlineFilter).length ? deadlineFilter : undefined;

  const base: Prisma.DriveWhereInput = {
    deletedAt: null,
    ...(applyDeadline ? { applyDeadline } : {}),
  };

  let where: Prisma.DriveWhereInput;
  switch (auth.role) {
    case 'COMPANY':
      where = { ...base, companyId: auth.companyId ?? '__none__' };
      break;
    case 'UNIVERSITY':
      where = { ...base, universityId: auth.universityId ?? '__none__', status: { not: 'DRAFT' } };
      break;
    case 'ADMIN':
      where = base;
      break;
    case 'STUDENT': {
      const { facts } = await loadStudentFacts(auth.userId);
      where = { ...base, universityId: facts.universityId, status: 'OPEN' };
      break;
    }
    default:
      return [];
  }

  const drives = await prisma.drive.findMany({
    where,
    include: { company: true },
    orderBy: { applyDeadline: 'asc' },
  });

  let visible = drives;
  if (auth.role === 'STUDENT') {
    const { facts } = await loadStudentFacts(auth.userId);
    visible = drives.filter(
      (d) =>
        evaluateEligibility(facts, {
          universityId: d.universityId,
          status: d.status,
          applyDeadline: d.applyDeadline,
          minCgpa: decToNum(d.minCgpa),
          allowedBranches: d.allowedBranches,
          allowedGraduationYears: d.allowedGraduationYears,
        }).eligible,
    );
  }

  const driveEvents: CalendarEvent[] = visible.map((d) => ({
    id: d.publicId,
    title: `${d.title} · ${d.company.name} (deadline)`,
    type: 'DRIVE' as const,
    startsAt: d.applyDeadline.toISOString(),
    url: driveUrl(auth.role, d.publicId),
  }));

  return [
    ...driveEvents,
    ...(await listContestEvents(auth, range)),
    ...(await listWebinarEvents(auth, range)),
    ...(await listInterviewEvents(auth, range)),
  ];
}

/** Phase 9 — INTERVIEW events (scheduled starts), role-scoped, honoring the range. */
async function listInterviewEvents(
  auth: Auth,
  range: { from?: string; to?: string },
): Promise<CalendarEvent[]> {
  const scheduledStartsAt: Prisma.DateTimeFilter = {};
  if (range.from) scheduledStartsAt.gte = new Date(range.from);
  if (range.to) scheduledStartsAt.lte = new Date(range.to);
  const timeFilter = Object.keys(scheduledStartsAt).length ? { scheduledStartsAt } : {};
  // Active interviews only (not cancelled).
  const base: Prisma.InterviewWhereInput = {
    deletedAt: null,
    status: { in: ['SCHEDULED', 'LIVE', 'ENDED'] },
    ...timeFilter,
  };

  let where: Prisma.InterviewWhereInput;
  switch (auth.role) {
    case 'COMPANY':
      where = { ...base, hostKind: 'COMPANY', hostCompanyId: auth.companyId ?? '__none__' };
      break;
    case 'UNIVERSITY':
      where = {
        ...base,
        hostKind: 'UNIVERSITY',
        hostUniversityId: auth.universityId ?? '__none__',
      };
      break;
    case 'ADMIN':
      where = base;
      break;
    case 'STUDENT': {
      const student = await prisma.student.findUnique({
        where: { userId: auth.userId },
        select: { id: true },
      });
      if (!student) return [];
      where = { ...base, candidateStudentId: student.id };
      break;
    }
    default:
      return [];
  }

  const interviews = await prisma.interview.findMany({
    where,
    orderBy: { scheduledStartsAt: 'asc' },
  });
  return interviews.map((i) => ({
    id: i.publicId,
    title: `${i.title ?? 'Interview'} (interview)`,
    type: 'INTERVIEW' as const,
    startsAt: i.scheduledStartsAt.toISOString(),
    url: `/app/interviews/${i.publicId}`,
  }));
}

/** Phase 7 — CONTEST events (start times), role-scoped, honoring the range. */
async function listContestEvents(
  auth: Auth,
  range: { from?: string; to?: string },
): Promise<CalendarEvent[]> {
  const startsAt: Prisma.DateTimeFilter = {};
  if (range.from) startsAt.gte = new Date(range.from);
  if (range.to) startsAt.lte = new Date(range.to);
  const timeFilter = Object.keys(startsAt).length ? { startsAt } : {};
  const base: Prisma.ContestWhereInput = { deletedAt: null, status: 'SCHEDULED', ...timeFilter };

  let where: Prisma.ContestWhereInput;
  switch (auth.role) {
    case 'COMPANY':
      where = { ...base, hostKind: 'COMPANY', hostCompanyId: auth.companyId ?? '__none__' };
      break;
    case 'UNIVERSITY':
      where = {
        ...base,
        OR: [
          { hostUniversityId: auth.universityId ?? '__none__' },
          { targetUniversityId: auth.universityId ?? '__none__' },
        ],
      };
      break;
    case 'ADMIN':
      where = base;
      break;
    case 'STUDENT': {
      const { facts } = await loadStudentFacts(auth.userId);
      where = { ...base, targetUniversityId: facts.universityId };
      break;
    }
    default:
      return [];
  }

  const contests = await prisma.contest.findMany({ where, orderBy: { startsAt: 'asc' } });
  return contests.map((c) => ({
    id: c.publicId,
    title: `${c.title} (contest)`,
    type: 'CONTEST' as const,
    startsAt: c.startsAt.toISOString(),
    url: `/app/contests/${c.publicId}`,
  }));
}

/** Phase 8 — WEBINAR events (scheduled starts), role-scoped, honoring the range. */
async function listWebinarEvents(
  auth: Auth,
  range: { from?: string; to?: string },
): Promise<CalendarEvent[]> {
  const scheduledStartsAt: Prisma.DateTimeFilter = {};
  if (range.from) scheduledStartsAt.gte = new Date(range.from);
  if (range.to) scheduledStartsAt.lte = new Date(range.to);
  const timeFilter = Object.keys(scheduledStartsAt).length ? { scheduledStartsAt } : {};
  // Published (non-draft/cancelled) webinars only.
  const base: Prisma.WebinarWhereInput = {
    deletedAt: null,
    status: { in: ['SCHEDULED', 'LIVE', 'ENDED'] },
    ...timeFilter,
  };

  let where: Prisma.WebinarWhereInput;
  switch (auth.role) {
    case 'COMPANY':
      where = { ...base, hostKind: 'COMPANY', hostCompanyId: auth.companyId ?? '__none__' };
      break;
    case 'UNIVERSITY':
      where = {
        ...base,
        OR: [
          { hostUniversityId: auth.universityId ?? '__none__' },
          { targetUniversityId: auth.universityId ?? '__none__' },
        ],
      };
      break;
    case 'ADMIN':
      where = base;
      break;
    case 'STUDENT': {
      const { facts } = await loadStudentFacts(auth.userId);
      where = { ...base, targetUniversityId: facts.universityId };
      break;
    }
    default:
      return [];
  }

  const webinars = await prisma.webinar.findMany({ where, orderBy: { scheduledStartsAt: 'asc' } });
  return webinars.map((w) => ({
    id: w.publicId,
    title: `${w.title} (webinar)`,
    type: 'WEBINAR' as const,
    startsAt: w.scheduledStartsAt.toISOString(),
    url: `/app/webinars/${w.publicId}`,
  }));
}
