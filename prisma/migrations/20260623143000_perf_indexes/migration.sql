-- CreateIndex
CREATE INDEX "Debtor_phoneE164_idx" ON "Debtor"("phoneE164");

-- CreateIndex
CREATE INDEX "Call_debtorId_outcome_idx" ON "Call"("debtorId", "outcome");

-- CreateIndex
CREATE INDEX "Call_status_scheduledFor_idx" ON "Call"("status", "scheduledFor");
