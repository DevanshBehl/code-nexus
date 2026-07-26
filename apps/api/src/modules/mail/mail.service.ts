import { Prisma, prisma } from '@code-nexus/db';
import { canMail, type MailParty as PolicyParty } from '@code-nexus/auth';
import type {
  ComposeMailInput,
  InboxPage,
  InboxRow,
  MailContact,
  MailContactsResponse,
  MailDetail,
  MailPageQuery,
  MailParty,
  Role,
  SentPage,
} from '@code-nexus/types';
import type { Express } from 'express';
import { AppError } from '../../errors.js';

type Auth = Express.AuthContext;

// A user loaded with every role/org relation so we can resolve display + scope.
const mailUserInclude = {
  student: true,
  recruiter: true,
  university: true,
  company: true,
  platformAdmin: true,
} satisfies Prisma.UserInclude;

type MailUserRow = Prisma.UserGetPayload<{ include: typeof mailUserInclude }>;

const ROLE_FALLBACK: Record<string, string> = {
  STUDENT: 'Student',
  RECRUITER: 'Recruiter',
  UNIVERSITY: 'University',
  COMPANY: 'Company',
  ADMIN: 'Code Nexus',
};

function personName(first: string | null, last: string | null, fallback: string): string {
  const n = [first, last].filter(Boolean).join(' ').trim();
  return n || fallback;
}

/** Resolve a user's display name + org scope for mail DTOs and policy checks. */
function resolveUser(u: MailUserRow): {
  userId: string;
  publicId: string;
  role: Role;
  displayName: string;
  universityId: string | null;
  companyId: string | null;
} {
  const role = u.role as Role;
  let displayName = ROLE_FALLBACK[role] ?? role;
  let universityId: string | null = null;
  let companyId: string | null = null;

  switch (role) {
    case 'STUDENT':
      displayName = personName(
        u.student?.firstName ?? null,
        u.student?.lastName ?? null,
        'Student',
      );
      universityId = u.student?.universityId ?? null;
      break;
    case 'RECRUITER':
      displayName = personName(
        u.recruiter?.firstName ?? null,
        u.recruiter?.lastName ?? null,
        'Recruiter',
      );
      companyId = u.recruiter?.companyId ?? null;
      break;
    case 'UNIVERSITY':
      displayName = u.university?.name ?? 'University';
      universityId = u.university?.id ?? null;
      break;
    case 'COMPANY':
      displayName = u.company?.name ?? 'Company';
      companyId = u.company?.id ?? null;
      break;
    case 'ADMIN':
      displayName = personName(
        u.platformAdmin?.firstName ?? null,
        u.platformAdmin?.lastName ?? null,
        'Code Nexus',
      );
      break;
  }
  return { userId: u.id, publicId: u.publicId, role, displayName, universityId, companyId };
}

function toParty(r: ReturnType<typeof resolveUser>): MailParty {
  return { publicId: r.publicId, displayName: r.displayName, role: r.role };
}

function policyParty(r: {
  role: Role;
  universityId: string | null;
  companyId: string | null;
}): PolicyParty {
  return { role: r.role, universityId: r.universityId, companyId: r.companyId };
}

// ---- Send -------------------------------------------------------------------

export async function sendMail(
  auth: Auth,
  input: ComposeMailInput,
): Promise<{ publicId: string; sentAt: string }> {
  const uniqueIds = [...new Set(input.recipientPublicIds)];

  const users = await prisma.user.findMany({
    where: { publicId: { in: uniqueIds }, deletedAt: null, status: { not: 'SUSPENDED' } },
    include: mailUserInclude,
  });
  const byPublicId = new Map(users.map((u) => [u.publicId, u]));

  // Unknown / suspended / deleted recipient → 404 (name the first).
  const missing = uniqueIds.find((id) => !byPublicId.has(id));
  if (missing) throw new AppError(404, 'NOT_FOUND', `Recipient not found: ${missing}`);

  // Cannot mail yourself.
  if (users.some((u) => u.id === auth.userId)) {
    throw new AppError(400, 'VALIDATION', 'You cannot send mail to yourself');
  }

  const sender: PolicyParty = {
    role: auth.role,
    universityId: auth.universityId,
    companyId: auth.companyId,
  };
  for (const u of users) {
    const recipient = resolveUser(u);
    if (!canMail(sender, policyParty(recipient))) {
      throw new AppError(403, 'FORBIDDEN', `You may not send mail to ${u.publicId}`);
    }
  }

  const mail = await prisma.$transaction((tx) =>
    insertMail(tx, {
      senderId: auth.userId,
      recipientIds: users.map((u) => u.id),
      subject: input.subject,
      body: input.body,
      system: false,
    }),
  );
  return { publicId: mail.publicId, sentAt: mail.sentAt.toISOString() };
}

/** Low-level insert (works inside a transaction). Shared by compose + system mail. */
export async function insertMail(
  tx: Prisma.TransactionClient,
  params: {
    senderId: string;
    recipientIds: string[];
    subject: string;
    body: string;
    system: boolean;
  },
): Promise<{ publicId: string; sentAt: Date }> {
  const mail = await tx.mail.create({
    data: {
      senderId: params.senderId,
      subject: params.subject,
      body: params.body,
      system: params.system,
      recipients: { create: params.recipientIds.map((recipientId) => ({ recipientId })) },
    },
    select: { publicId: true, sentAt: true },
  });
  return mail;
}

/** Templated OFFERED/REJECTED notification (company → student), written in-tx. */
export function applicationDecisionMailTx(
  tx: Prisma.TransactionClient,
  params: {
    senderUserId: string;
    recipientUserId: string;
    driveTitle: string;
    companyName: string;
    status: 'OFFERED' | 'REJECTED';
  },
): Promise<{ publicId: string; sentAt: Date }> {
  const { subject, body } =
    params.status === 'OFFERED'
      ? {
          subject: `Offer: ${params.driveTitle} at ${params.companyName}`,
          body:
            `Congratulations! You have been selected for "${params.driveTitle}" at ` +
            `${params.companyName}. The team will be in touch with next steps.`,
        }
      : {
          subject: `Update on your application — ${params.driveTitle}`,
          body:
            `Thank you for applying to "${params.driveTitle}" at ${params.companyName}. ` +
            `After careful consideration, we will not be moving forward at this time. ` +
            `We wish you the very best in your placements.`,
        };

  return insertMail(tx, {
    senderId: params.senderUserId,
    recipientIds: [params.recipientUserId],
    subject,
    body,
    system: true,
  });
}

// ---- Reads ------------------------------------------------------------------

export async function listInbox(auth: Auth, query: MailPageQuery): Promise<InboxPage> {
  const where: Prisma.MailRecipientWhereInput = { recipientId: auth.userId, deletedAt: null };
  const [total, rows] = await Promise.all([
    prisma.mailRecipient.count({ where }),
    prisma.mailRecipient.findMany({
      where,
      include: { mail: { include: { sender: { include: mailUserInclude } } } },
      orderBy: { mail: { sentAt: 'desc' } },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  const items: InboxRow[] = rows.map((mr) => ({
    publicId: mr.mail.publicId,
    subject: mr.mail.subject,
    sentAt: mr.mail.sentAt.toISOString(),
    read: mr.readAt != null,
    system: mr.mail.system,
    sender: toParty(resolveUser(mr.mail.sender)),
  }));
  return { items, page: query.page, pageSize: query.pageSize, total };
}

export async function listSent(auth: Auth, query: MailPageQuery): Promise<SentPage> {
  const where: Prisma.MailWhereInput = { senderId: auth.userId, deletedAt: null };
  const [total, mails] = await Promise.all([
    prisma.mail.count({ where }),
    prisma.mail.findMany({
      where,
      include: { recipients: { include: { recipient: { include: mailUserInclude } } } },
      orderBy: { sentAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: mails.map((m) => ({
      publicId: m.publicId,
      subject: m.subject,
      sentAt: m.sentAt.toISOString(),
      system: m.system,
      recipients: m.recipients.map((r) => toParty(resolveUser(r.recipient))),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getMailDetail(auth: Auth, publicId: string): Promise<MailDetail> {
  const mail = await prisma.mail.findFirst({
    where: { publicId, deletedAt: null },
    include: {
      sender: { include: mailUserInclude },
      recipients: { include: { recipient: { include: mailUserInclude } } },
    },
  });
  if (!mail) throw AppError.notFound('Mail not found');

  const isSender = mail.senderId === auth.userId;
  const myRecipientRow = mail.recipients.find((r) => r.recipientId === auth.userId);
  if (!isSender && !myRecipientRow) throw AppError.notFound('Mail not found');

  // Reading a received, unread mail marks the caller's copy read.
  let read: boolean | undefined;
  if (myRecipientRow) {
    read = myRecipientRow.readAt != null;
    if (!read) {
      await prisma.mailRecipient.update({
        where: { id: myRecipientRow.id },
        data: { readAt: new Date() },
      });
      read = true;
    }
  }

  return {
    publicId: mail.publicId,
    subject: mail.subject,
    body: mail.body,
    sentAt: mail.sentAt.toISOString(),
    system: mail.system,
    sender: toParty(resolveUser(mail.sender)),
    recipients: mail.recipients.map((r) => toParty(resolveUser(r.recipient))),
    ...(read !== undefined ? { read } : {}),
  };
}

export async function unreadCount(auth: Auth): Promise<number> {
  return prisma.mailRecipient.count({
    where: { recipientId: auth.userId, readAt: null, deletedAt: null },
  });
}

// ---- Contacts ---------------------------------------------------------------

const CONTACTS_LIMIT = 25;

export async function listContacts(
  auth: Auth,
  q: string | undefined,
): Promise<MailContactsResponse> {
  const toContact = (u: MailUserRow): MailContact => {
    const r = resolveUser(u);
    return { publicId: r.publicId, displayName: r.displayName, role: r.role };
  };

  // Company & Admin may mail anyone → require a search query.
  if (auth.role === 'COMPANY' || auth.role === 'ADMIN') {
    if (!q || q.trim().length < 2) return { contacts: [], searchRequired: true };
    const needle = q.trim();
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        status: { not: 'SUSPENDED' },
        id: { not: auth.userId },
        OR: [
          { email: { contains: needle, mode: 'insensitive' } },
          {
            student: {
              OR: [
                { firstName: { contains: needle, mode: 'insensitive' } },
                { lastName: { contains: needle, mode: 'insensitive' } },
              ],
            },
          },
          {
            recruiter: {
              OR: [
                { firstName: { contains: needle, mode: 'insensitive' } },
                { lastName: { contains: needle, mode: 'insensitive' } },
              ],
            },
          },
          { university: { name: { contains: needle, mode: 'insensitive' } } },
          { company: { name: { contains: needle, mode: 'insensitive' } } },
        ],
      },
      include: mailUserInclude,
      take: CONTACTS_LIMIT,
    });
    return { contacts: users.map(toContact), searchRequired: true };
  }

  // Bounded roles: return the exact allowed set.
  let where: Prisma.UserWhereInput;
  switch (auth.role) {
    case 'STUDENT':
      where = {
        deletedAt: null,
        status: { not: 'SUSPENDED' },
        OR: [{ role: 'ADMIN' }, { university: { id: auth.universityId ?? '__none__' } }],
      };
      break;
    case 'UNIVERSITY':
      where = {
        deletedAt: null,
        status: { not: 'SUSPENDED' },
        id: { not: auth.userId },
        OR: [
          { role: 'ADMIN' },
          { role: 'COMPANY' },
          { student: { universityId: auth.universityId ?? '__none__' } },
        ],
      };
      break;
    case 'RECRUITER':
      where = {
        deletedAt: null,
        status: { not: 'SUSPENDED' },
        OR: [{ role: 'ADMIN' }, { company: { id: auth.companyId ?? '__none__' } }],
      };
      break;
    default:
      return { contacts: [], searchRequired: false };
  }

  const users = await prisma.user.findMany({ where, include: mailUserInclude, take: 200 });
  return { contacts: users.map(toContact), searchRequired: false };
}
