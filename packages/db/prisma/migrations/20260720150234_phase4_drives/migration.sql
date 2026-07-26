-- CreateEnum
CREATE TYPE "DriveStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('APPLIED', 'SHORTLISTED', 'OFFERED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "drives" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "roleTitle" TEXT,
    "location" TEXT,
    "ctcAnnual" INTEGER,
    "minCgpa" DECIMAL(4,2),
    "allowedBranches" TEXT[],
    "allowedGraduationYears" INTEGER[],
    "applyDeadline" TIMESTAMPTZ(6) NOT NULL,
    "status" "DriveStatus" NOT NULL DEFAULT 'DRAFT',
    "companyId" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "drives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "appliedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decisionAt" TIMESTAMPTZ(6),
    "note" TEXT,
    "driveId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drives_publicId_key" ON "drives"("publicId");

-- CreateIndex
CREATE INDEX "drives_companyId_idx" ON "drives"("companyId");

-- CreateIndex
CREATE INDEX "drives_universityId_idx" ON "drives"("universityId");

-- CreateIndex
CREATE INDEX "drives_universityId_status_idx" ON "drives"("universityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "applications_publicId_key" ON "applications"("publicId");

-- CreateIndex
CREATE INDEX "applications_driveId_status_idx" ON "applications"("driveId", "status");

-- CreateIndex
CREATE INDEX "applications_studentId_idx" ON "applications"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "applications_driveId_studentId_key" ON "applications"("driveId", "studentId");

-- AddForeignKey
ALTER TABLE "drives" ADD CONSTRAINT "drives_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drives" ADD CONSTRAINT "drives_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "drives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
