/*
  Warnings:

  - Added the required column `entryDeadline` to the `contests` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "contest_participants" ADD COLUMN     "startedAt" TIMESTAMPTZ(6),
ADD COLUMN     "submittedAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "contests" ADD COLUMN     "entryDeadline" TIMESTAMPTZ(6) NOT NULL;
