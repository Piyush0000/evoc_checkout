/*
  Warnings:

  - A unique constraint covering the columns `[gatewayTransactionId]` on the table `CheckoutSession` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSession_gatewayTransactionId_key" ON "CheckoutSession"("gatewayTransactionId");

-- CreateIndex
CREATE INDEX "CheckoutSession_gatewayTransactionId_idx" ON "CheckoutSession"("gatewayTransactionId");
