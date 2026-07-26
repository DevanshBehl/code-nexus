import { z } from 'zod';
import type { Role } from './roles.js';

/**
 * Phase 5 — Internal Mailing Service contracts. The SAME zod schemas validate on
 * the client (compose form / list query) and the server (route). Mail is
 * addressed by `User.publicId`; directional send rules live in @code-nexus/auth
 * (`canMail`). Text only in Phase 5 — no attachments.
 */

// ---- Request schemas --------------------------------------------------------

/** Body for `POST /mail` — compose & send. Recipients addressed by publicId. */
export const composeMailSchema = z.object({
  recipientPublicIds: z.array(z.string().uuid()).min(1).max(50),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
});
export type ComposeMailInput = z.infer<typeof composeMailSchema>;

/** Pagination for inbox/sent (query strings → coerced). */
export const mailPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type MailPageQuery = z.infer<typeof mailPageQuerySchema>;

/** Contacts lookup (`GET /mail/contacts?q=`). */
export const mailContactsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
});
export type MailContactsQuery = z.infer<typeof mailContactsQuerySchema>;

// ---- Response DTOs (no secrets; publicIds only) ------------------------------

/** The other party on a mail (sender or recipient), display-safe. */
export interface MailParty {
  publicId: string;
  displayName: string;
  role: Role;
}

/** A row in the inbox (a mail you received). */
export interface InboxRow {
  publicId: string; // the mail's publicId
  subject: string;
  sentAt: string; // ISO
  read: boolean;
  system: boolean;
  sender: MailParty;
}

/** A row in the sent box (a mail you sent). */
export interface SentRow {
  publicId: string;
  subject: string;
  sentAt: string; // ISO
  system: boolean;
  recipients: MailParty[];
}

/** Full mail detail (sender or a recipient only). */
export interface MailDetail {
  publicId: string;
  subject: string;
  body: string;
  sentAt: string; // ISO
  system: boolean;
  sender: MailParty;
  recipients: MailParty[];
  /** For a recipient viewer: whether their copy is read. Omitted for the sender. */
  read?: boolean;
}

/** A selectable recipient for the compose form (role-scoped, `canMail`-allowed). */
export interface MailContact {
  publicId: string;
  displayName: string;
  role: Role;
}

export interface MailContactsResponse {
  contacts: MailContact[];
  /** True when the caller may mail anyone and must search (company/admin). */
  searchRequired: boolean;
}

/** A page of list results. */
export interface MailPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type InboxPage = MailPage<InboxRow>;
export type SentPage = MailPage<SentRow>;

export interface UnreadCountResponse {
  count: number;
}

export interface SendMailResponse {
  publicId: string;
  sentAt: string;
}
