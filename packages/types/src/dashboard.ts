import { z } from 'zod';
import type { Role } from './roles.js';
import type { DriveListRow } from './drive.js';
import type { ContestListItem } from './contest.js';
import type { WebinarListItem } from './webinar.js';
import type { InterviewListItem } from './interview.js';

/**
 * Calendar event contract. Phase 3 returns an empty list; Phases 4 (drives) and
 * 7 (contests) populate it with zero UI change (prompt_phase3.md §8).
 */
export const CALENDAR_EVENT_TYPES = ['DRIVE', 'CONTEST', 'INTERVIEW', 'WEBINAR'] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export interface CalendarEvent {
  id: string;
  title: string;
  type: CalendarEventType;
  startsAt: string; // ISO
  endsAt?: string; // ISO
  url?: string;
}

export interface CalendarEventsResponse {
  events: CalendarEvent[];
}

export const calendarRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ---- Dashboard payloads (role-scoped summaries) -----------------------------

/** A compact account row for lists (no secrets). */
export interface AccountSummary {
  publicId: string;
  email: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
}

export interface StudentDashboard {
  role: 'STUDENT';
  profileComplete: boolean;
  profile: {
    firstName: string | null;
    lastName: string | null;
    rollNumber: string | null;
    branch: string | null;
    graduationYear: number | null;
    cgpa: number | null;
    university: string;
  };
  // Phase 4 — eligible OPEN drives + this student's application summary.
  upcomingDrives: DriveListRow[];
  applications: { total: number; active: number; offers: number; rejected: number };
  // Phase 7 — upcoming/live contests for this student.
  contests: ContestListItem[];
  // Phase 8 — upcoming/live webinars for this student.
  webinars: WebinarListItem[];
  // Phase 9 — upcoming/live interviews for this student.
  interviews: InterviewListItem[];
}

export interface StudentListRow extends AccountSummary {
  rollNumber: string | null;
  branch: string | null;
  graduationYear: number | null;
  cgpa: number | null;
}

export interface UniversityDashboard {
  role: 'UNIVERSITY';
  university: { name: string; code: string };
  counts: { students: number; byBranch: { branch: string; count: number }[] };
  students: StudentListRow[]; // branch-wise sorted, own university only
  // Phase 4 — drives targeting this university + placement outcomes of own students.
  drives: DriveListRow[];
  placement: { applied: number; shortlisted: number; offered: number; rejected: number };
  // Phase 7 — contests hosted by this university.
  contests: ContestListItem[];
  // Phase 8 — webinars hosted by this university.
  webinars: WebinarListItem[];
  // Phase 9 — interviews hosted by this university.
  interviews: InterviewListItem[];
}

export interface RecruiterListRow extends AccountSummary {
  designation: string | null;
}

export interface CompanyDashboard {
  role: 'COMPANY';
  company: { name: string };
  counts: { recruiters: number; drives: number; openDrives: number; applicants: number };
  recruiters: RecruiterListRow[];
  // Phase 4 — this company's own drives (with applicant counts).
  drives: DriveListRow[];
  // Phase 7 — contests hosted by this company.
  contests: ContestListItem[];
  // Phase 8 — webinars hosted by this company.
  webinars: WebinarListItem[];
  // Phase 9 — interviews hosted by this company.
  interviews: InterviewListItem[];
}

export interface RecruiterDashboard {
  role: 'RECRUITER';
  profile: {
    firstName: string | null;
    lastName: string | null;
    designation: string | null;
    company: string;
  };
}

export interface AdminDashboard {
  role: 'ADMIN';
  counts: {
    universities: number;
    companies: number;
    students: number;
    recruiters: number;
    suspended: number;
    // Phase 4
    drives: number;
    openDrives: number;
    applications: number;
  };
}

export type DashboardPayload =
  StudentDashboard | UniversityDashboard | CompanyDashboard | RecruiterDashboard | AdminDashboard;

/** Maps a role to its dashboard route (used by the web ProtectedRoute). */
export const ROLE_HOME: Record<Role, string> = {
  STUDENT: '/app/student',
  UNIVERSITY: '/app/university',
  COMPANY: '/app/company',
  RECRUITER: '/app/recruiter',
  ADMIN: '/app/admin',
};
