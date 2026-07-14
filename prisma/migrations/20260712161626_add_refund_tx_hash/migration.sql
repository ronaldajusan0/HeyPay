-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "refundTxHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_refundTxHash_key" ON "Payment"("refundTxHash");
