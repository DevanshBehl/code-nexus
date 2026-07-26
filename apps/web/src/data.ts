import {
  Briefcase,
  Code2,
  Trophy,
  Video,
  MonitorPlay,
  Film,
  GraduationCap,
  Building2,
  Landmark,
  UserSearch,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

export interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

/** The six product domains (honest, product-accurate copy). */
export const FEATURES: Feature[] = [
  {
    icon: Code2,
    title: 'Code Arena',
    description:
      'A LeetCode-style DSA practice platform with topic-wise problems, real test cases, an isolated code-execution pipeline, and a GitHub-style contribution graph.',
  },
  {
    icon: Briefcase,
    title: 'Placement Drives',
    description:
      'Companies launch drives with universities; students apply and track every stage in one funnel.',
  },
  {
    icon: Video,
    title: 'Live Interviews',
    description:
      'One-on-one rooms with a synced code editor, shared whiteboard, and screen sharing.',
  },
  {
    icon: Trophy,
    title: 'Coding Contests',
    description: 'Timed competitive rounds with live, test-case-ranked leaderboards.',
  },
  {
    icon: MonitorPlay,
    title: 'Webinars',
    description: 'One-to-many pre-placement talks with chat, polls, and attendance.',
  },
  {
    icon: Film,
    title: 'Interview Recordings',
    description: 'Chaptered, timestamped playback — scoped to exactly the right viewers.',
  },
];

export interface RoleCard {
  icon: LucideIcon;
  name: string;
  blurb: string;
}

/** The five platform roles. */
export const ROLES: RoleCard[] = [
  {
    icon: GraduationCap,
    name: 'Student',
    blurb:
      'Track placement drives, practice DSA, join contests, and attend interviews — all from one dashboard.',
  },
  {
    icon: Landmark,
    name: 'University',
    blurb: 'Provision students, oversee drives, and track placed and rejected candidates.',
  },
  {
    icon: Building2,
    name: 'Company',
    blurb: 'Launch drives, shortlist applicants with filters, schedule rounds, and decide.',
  },
  {
    icon: UserSearch,
    name: 'Recruiter',
    blurb: 'Run live interviews, push questions from a curated pool, and leave feedback.',
  },
  {
    icon: ShieldCheck,
    name: 'Code Nexus Admin',
    blurb: 'Oversee the platform, monitor health, and act as the help center.',
  },
];

export interface Step {
  label: string;
  detail: string;
}

/** The placement funnel shown in "How It Works". */
export const STEPS: Step[] = [
  { label: 'Drive', detail: 'A company launches a drive with a university.' },
  { label: 'Apply', detail: 'Eligible students apply and share their profiles.' },
  { label: 'Shortlist', detail: 'Companies filter applicants by branch, CGPA, and more.' },
  { label: 'DSA Round', detail: 'Candidates take an in-house coding test, auto-graded.' },
  { label: 'Interview', detail: 'Recruiters run live one-on-one interview rooms.' },
  { label: 'Offer', detail: 'Decisions trigger notifications to every candidate.' },
];
