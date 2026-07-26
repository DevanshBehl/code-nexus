-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "recruiters" ADD COLUMN     "designation" TEXT,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "branch" TEXT,
ADD COLUMN     "cgpa" DECIMAL(4,2),
ADD COLUMN     "dateOfBirth" TIMESTAMPTZ(6),
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "graduationYear" INTEGER,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "resumeUrl" TEXT,
ADD COLUMN     "rollNumber" TEXT;

-- AlterTable
ALTER TABLE "universities" ADD COLUMN     "website" TEXT;

-- CreateIndex
CREATE INDEX "students_universityId_branch_idx" ON "students"("universityId", "branch");

-- CreateIndex
CREATE UNIQUE INDEX "students_universityId_rollNumber_key" ON "students"("universityId", "rollNumber");

