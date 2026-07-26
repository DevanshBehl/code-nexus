-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContestHostKind" AS ENUM ('UNIVERSITY', 'COMPANY');

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "contestId" TEXT;

-- CreateTable
CREATE TABLE "contests" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hostKind" "ContestHostKind" NOT NULL,
    "hostUniversityId" TEXT,
    "hostCompanyId" TEXT,
    "targetUniversityId" TEXT NOT NULL,
    "allowedLanguages" "ProgrammingLanguage"[],
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "ContestStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_questions" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "points" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "contest_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_participants" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "contest_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contests_publicId_key" ON "contests"("publicId");

-- CreateIndex
CREATE INDEX "contests_targetUniversityId_startsAt_idx" ON "contests"("targetUniversityId", "startsAt");

-- CreateIndex
CREATE INDEX "contests_hostUniversityId_idx" ON "contests"("hostUniversityId");

-- CreateIndex
CREATE INDEX "contests_hostCompanyId_idx" ON "contests"("hostCompanyId");

-- CreateIndex
CREATE INDEX "contests_status_idx" ON "contests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "contest_questions_publicId_key" ON "contest_questions"("publicId");

-- CreateIndex
CREATE INDEX "contest_questions_contestId_ordinal_idx" ON "contest_questions"("contestId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "contest_questions_contestId_questionId_key" ON "contest_questions"("contestId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "contest_participants_publicId_key" ON "contest_participants"("publicId");

-- CreateIndex
CREATE INDEX "contest_participants_contestId_idx" ON "contest_participants"("contestId");

-- CreateIndex
CREATE UNIQUE INDEX "contest_participants_contestId_studentId_key" ON "contest_participants"("contestId", "studentId");

-- CreateIndex
CREATE INDEX "submissions_contestId_questionId_idx" ON "submissions"("contestId", "questionId");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_hostUniversityId_fkey" FOREIGN KEY ("hostUniversityId") REFERENCES "universities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_hostCompanyId_fkey" FOREIGN KEY ("hostCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_targetUniversityId_fkey" FOREIGN KEY ("targetUniversityId") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_questions" ADD CONSTRAINT "contest_questions_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_questions" ADD CONSTRAINT "contest_questions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_participants" ADD CONSTRAINT "contest_participants_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_participants" ADD CONSTRAINT "contest_participants_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
