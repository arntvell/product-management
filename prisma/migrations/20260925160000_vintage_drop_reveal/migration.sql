-- CreateTable
CREATE TABLE "VintageDropReveal" (
    "drop" TEXT NOT NULL,
    "revealAt" TIMESTAMP(3),
    "revealedAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VintageDropReveal_pkey" PRIMARY KEY ("drop")
);

-- CreateIndex
CREATE INDEX "VintageDropReveal_revealAt_idx" ON "VintageDropReveal"("revealAt");

