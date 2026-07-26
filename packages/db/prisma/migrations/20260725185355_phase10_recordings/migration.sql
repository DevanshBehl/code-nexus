-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('RECORDING', 'PROCESSING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "InterviewEventKind" AS ENUM ('PARTICIPANT_JOINED', 'PARTICIPANT_LEFT', 'SURFACE_CHANGED', 'QUESTION_PINNED', 'SCREEN_SHARE_STARTED', 'SCREEN_SHARE_STOPPED', 'CODE_RUN', 'RECORDING_STARTED', 'RECORDING_STOPPED');

-- CreateTable
CREATE TABLE "interview_recordings" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "status" "RecordingStatus" NOT NULL DEFAULT 'RECORDING',
    "mimeType" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL,
    "endedAt" TIMESTAMPTZ(6),
    "durationMs" INTEGER,
    "totalBytes" INTEGER NOT NULL DEFAULT 0,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "interview_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_segments" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "startOffsetMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_events" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "kind" "InterviewEventKind" NOT NULL,
    "offsetMs" INTEGER NOT NULL,
    "actorUserId" TEXT,
    "label" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_access_logs" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "accessedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "interview_recordings_publicId_key" ON "interview_recordings"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "interview_recordings_interviewId_key" ON "interview_recordings"("interviewId");

-- CreateIndex
CREATE INDEX "interview_recordings_status_idx" ON "interview_recordings"("status");

-- CreateIndex
CREATE UNIQUE INDEX "recording_segments_publicId_key" ON "recording_segments"("publicId");

-- CreateIndex
CREATE INDEX "recording_segments_recordingId_idx" ON "recording_segments"("recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "recording_segments_recordingId_ordinal_key" ON "recording_segments"("recordingId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "interview_events_publicId_key" ON "interview_events"("publicId");

-- CreateIndex
CREATE INDEX "interview_events_interviewId_offsetMs_idx" ON "interview_events"("interviewId", "offsetMs");

-- CreateIndex
CREATE INDEX "interview_events_interviewId_kind_idx" ON "interview_events"("interviewId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "recording_access_logs_publicId_key" ON "recording_access_logs"("publicId");

-- CreateIndex
CREATE INDEX "recording_access_logs_recordingId_accessedAt_idx" ON "recording_access_logs"("recordingId", "accessedAt");

-- AddForeignKey
ALTER TABLE "interview_recordings" ADD CONSTRAINT "interview_recordings_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_recordings" ADD CONSTRAINT "interview_recordings_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_segments" ADD CONSTRAINT "recording_segments_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "interview_recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_events" ADD CONSTRAINT "interview_events_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_events" ADD CONSTRAINT "interview_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_access_logs" ADD CONSTRAINT "recording_access_logs_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "interview_recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_access_logs" ADD CONSTRAINT "recording_access_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
