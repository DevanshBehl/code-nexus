-- CreateEnum
CREATE TYPE "WebinarStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebinarHostKind" AS ENUM ('UNIVERSITY', 'COMPANY');

-- CreateEnum
CREATE TYPE "PollStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "webinars" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hostKind" "WebinarHostKind" NOT NULL,
    "hostUniversityId" TEXT,
    "hostCompanyId" TEXT,
    "targetUniversityId" TEXT NOT NULL,
    "scheduledStartsAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "WebinarStatus" NOT NULL DEFAULT 'DRAFT',
    "streamKey" TEXT NOT NULL,
    "playbackUrl" TEXT,
    "startedAt" TIMESTAMPTZ(6),
    "endedAt" TIMESTAMPTZ(6),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "webinars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webinar_messages" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "webinarId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "webinar_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webinar_polls" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "webinarId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" "PollStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "webinar_polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webinar_poll_options" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webinar_poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webinar_poll_votes" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webinar_poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webinar_attendance" (
    "id" TEXT NOT NULL,
    "webinarId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "firstJoinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendedSeconds" INTEGER NOT NULL DEFAULT 0,
    "present" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webinar_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webinars_publicId_key" ON "webinars"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "webinars_streamKey_key" ON "webinars"("streamKey");

-- CreateIndex
CREATE INDEX "webinars_targetUniversityId_scheduledStartsAt_idx" ON "webinars"("targetUniversityId", "scheduledStartsAt");

-- CreateIndex
CREATE INDEX "webinars_hostUniversityId_idx" ON "webinars"("hostUniversityId");

-- CreateIndex
CREATE INDEX "webinars_hostCompanyId_idx" ON "webinars"("hostCompanyId");

-- CreateIndex
CREATE INDEX "webinars_status_idx" ON "webinars"("status");

-- CreateIndex
CREATE UNIQUE INDEX "webinar_messages_publicId_key" ON "webinar_messages"("publicId");

-- CreateIndex
CREATE INDEX "webinar_messages_webinarId_sentAt_idx" ON "webinar_messages"("webinarId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "webinar_polls_publicId_key" ON "webinar_polls"("publicId");

-- CreateIndex
CREATE INDEX "webinar_polls_webinarId_idx" ON "webinar_polls"("webinarId");

-- CreateIndex
CREATE UNIQUE INDEX "webinar_poll_options_publicId_key" ON "webinar_poll_options"("publicId");

-- CreateIndex
CREATE INDEX "webinar_poll_options_pollId_ordinal_idx" ON "webinar_poll_options"("pollId", "ordinal");

-- CreateIndex
CREATE INDEX "webinar_poll_votes_pollId_optionId_idx" ON "webinar_poll_votes"("pollId", "optionId");

-- CreateIndex
CREATE UNIQUE INDEX "webinar_poll_votes_pollId_voterId_key" ON "webinar_poll_votes"("pollId", "voterId");

-- CreateIndex
CREATE INDEX "webinar_attendance_webinarId_idx" ON "webinar_attendance"("webinarId");

-- CreateIndex
CREATE UNIQUE INDEX "webinar_attendance_webinarId_studentId_key" ON "webinar_attendance"("webinarId", "studentId");

-- AddForeignKey
ALTER TABLE "webinars" ADD CONSTRAINT "webinars_hostUniversityId_fkey" FOREIGN KEY ("hostUniversityId") REFERENCES "universities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinars" ADD CONSTRAINT "webinars_hostCompanyId_fkey" FOREIGN KEY ("hostCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinars" ADD CONSTRAINT "webinars_targetUniversityId_fkey" FOREIGN KEY ("targetUniversityId") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinars" ADD CONSTRAINT "webinars_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_messages" ADD CONSTRAINT "webinar_messages_webinarId_fkey" FOREIGN KEY ("webinarId") REFERENCES "webinars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_messages" ADD CONSTRAINT "webinar_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_polls" ADD CONSTRAINT "webinar_polls_webinarId_fkey" FOREIGN KEY ("webinarId") REFERENCES "webinars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_poll_options" ADD CONSTRAINT "webinar_poll_options_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "webinar_polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_poll_votes" ADD CONSTRAINT "webinar_poll_votes_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "webinar_polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_poll_votes" ADD CONSTRAINT "webinar_poll_votes_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "webinar_poll_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_poll_votes" ADD CONSTRAINT "webinar_poll_votes_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_attendance" ADD CONSTRAINT "webinar_attendance_webinarId_fkey" FOREIGN KEY ("webinarId") REFERENCES "webinars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_attendance" ADD CONSTRAINT "webinar_attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
