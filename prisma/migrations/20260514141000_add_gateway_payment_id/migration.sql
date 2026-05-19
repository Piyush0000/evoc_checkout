-- AlterTable: Add gatewayPaymentId column to CheckoutSession
-- Fixes Issue E: stops overloading gatewayClientSecret with mihpayid
ALTER TABLE "CheckoutSession" ADD COLUMN "gatewayPaymentId" TEXT;
