-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'SCHEDULED', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('PROMISE_TO_PAY', 'DISPUTE', 'WRONG_NUMBER', 'NO_ANSWER', 'CALLBACK_REQUESTED', 'ESCALATED_TO_HUMAN', 'REFUSED');

-- CreateTable
CREATE TABLE "Debtor" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "amountDue" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "invoiceRef" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "doNotCall" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Debtor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "scheduledFor" TIMESTAMP(3),
    "outcome" "CallOutcome",
    "parentCallId" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallResult" (
    "callId" TEXT NOT NULL,
    "outcome" "CallOutcome" NOT NULL,
    "promisedAmount" INTEGER,
    "promisedDate" TIMESTAMP(3),
    "disputeReason" TEXT,
    "recordingUrl" TEXT,
    "costTRY" INTEGER NOT NULL DEFAULT 0,
    "llmTokensIn" INTEGER NOT NULL DEFAULT 0,
    "llmTokensOut" INTEGER NOT NULL DEFAULT 0,
    "ttsChars" INTEGER NOT NULL DEFAULT 0,
    "sttSec" INTEGER NOT NULL DEFAULT 0,
    "telephonySec" INTEGER NOT NULL DEFAULT 0,
    "avgResponseMs" INTEGER,
    "p95ResponseMs" INTEGER,
    "bargeIns" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CallResult_pkey" PRIMARY KEY ("callId")
);

-- CreateTable
CREATE TABLE "TranscriptTurn" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "latencyMs" INTEGER,

    CONSTRAINT "TranscriptTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Call_debtorId_createdAt_idx" ON "Call"("debtorId", "createdAt");

-- CreateIndex
CREATE INDEX "Call_campaignId_status_idx" ON "Call"("campaignId", "status");

-- CreateIndex
CREATE INDEX "TranscriptTurn_callId_at_idx" ON "TranscriptTurn"("callId", "at");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_parentCallId_fkey" FOREIGN KEY ("parentCallId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallResult" ADD CONSTRAINT "CallResult_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptTurn" ADD CONSTRAINT "TranscriptTurn_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

