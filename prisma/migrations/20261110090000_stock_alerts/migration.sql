-- CreateTable
CREATE TABLE "StockWatch" (
    "colorwayId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "StockWatch_pkey" PRIMARY KEY ("colorwayId")
);

-- CreateTable
CREATE TABLE "StockAlert" (
    "id" TEXT NOT NULL,
    "arrivals" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAlertReceipt" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "StockAlertReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockAlertReceipt_userId_seenAt_idx" ON "StockAlertReceipt"("userId", "seenAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockAlertReceipt_alertId_userId_key" ON "StockAlertReceipt"("alertId", "userId");

-- AddForeignKey
ALTER TABLE "StockAlertReceipt" ADD CONSTRAINT "StockAlertReceipt_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "StockAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
