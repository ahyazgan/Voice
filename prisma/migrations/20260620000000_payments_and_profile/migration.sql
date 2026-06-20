-- CreateEnum
CREATE TYPE "DebtorProfile" AS ENUM ('UNKNOWN', 'INDIVIDUAL', 'SME', 'CORPORATE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UNKNOWN', 'BANK_TRANSFER', 'CASH', 'CARD', 'INSTALLMENT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PROMISED', 'RECEIVED', 'PARTIAL', 'BROKEN');

-- AlterTable
ALTER TABLE "Debtor" ADD COLUMN     "profile" "DebtorProfile" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable (KVKK: Retell webhook recordingUrl'i yalnızca rıza varsa yazsın)
ALTER TABLE "CallResult" ADD COLUMN     "recordingConsent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "callId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "method" "PaymentMethod" NOT NULL DEFAULT 'UNKNOWN',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PROMISED',
    "promisedDate" TIMESTAMP(3),
    "receivedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_debtorId_status_idx" ON "Payment"("debtorId", "status");

-- CreateIndex
CREATE INDEX "Payment_status_promisedDate_idx" ON "Payment"("status", "promisedDate");

-- CreateIndex
-- NOT: Mevcut veride aynı phoneE164'ten birden fazla satır varsa bu migration
-- başarısız olur. Üretime almadan önce çift kayıtları temizleyin (DISTINCT ON).
CREATE UNIQUE INDEX "Debtor_phoneE164_key" ON "Debtor"("phoneE164");

-- CreateIndex
CREATE INDEX "Call_campaignId_outcome_idx" ON "Call"("campaignId", "outcome");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;
