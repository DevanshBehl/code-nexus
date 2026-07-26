-- CreateTable
CREATE TABLE "mails" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "senderId" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "mails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_recipients" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "mailId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "mail_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mails_publicId_key" ON "mails"("publicId");

-- CreateIndex
CREATE INDEX "mails_senderId_sentAt_idx" ON "mails"("senderId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "mail_recipients_publicId_key" ON "mail_recipients"("publicId");

-- CreateIndex
CREATE INDEX "mail_recipients_recipientId_readAt_idx" ON "mail_recipients"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "mail_recipients_recipientId_mailId_idx" ON "mail_recipients"("recipientId", "mailId");

-- CreateIndex
CREATE UNIQUE INDEX "mail_recipients_mailId_recipientId_key" ON "mail_recipients"("mailId", "recipientId");

-- AddForeignKey
ALTER TABLE "mails" ADD CONSTRAINT "mails_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_recipients" ADD CONSTRAINT "mail_recipients_mailId_fkey" FOREIGN KEY ("mailId") REFERENCES "mails"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_recipients" ADD CONSTRAINT "mail_recipients_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
