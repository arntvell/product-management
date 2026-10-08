-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PRODUCT_MANAGER', 'VINTAGE', 'VIEWER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "clerkUserId" TEXT,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

-- AlterTable
ALTER TABLE "FieldOwner" ADD COLUMN "editedByUserId" TEXT;

-- AlterTable
ALTER TABLE "PushBatch" ADD COLUMN "createdByUserId" TEXT;

-- Seed: the first admin, so the app is reachable the moment Clerk is switched on.
INSERT INTO "User" ("id", "email", "name", "role", "active", "updatedAt")
VALUES ('seed-admin-arnt', 'arnt.eriksen@livid.no', 'Arnt David Eriksen', 'ADMIN', true, CURRENT_TIMESTAMP);
