// What vintage drop reveals are scheduled, and whether any that should have
// fired have not.
//
//   npx dotenv -e .env.local -- npx tsx scripts/check-reveal.ts
//
// Read-only.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.ORIGO_POSTGRES_URL_NON_POOLING,
    }),
  });

  const now = new Date();
  const oslo = (d: Date) =>
    d.toLocaleString("nb-NO", { timeZone: "Europe/Oslo", dateStyle: "short", timeStyle: "short" });

  console.log(`now  UTC ${now.toISOString()}   Oslo ${oslo(now)}`);

  const rows = await prisma.vintageDropReveal.findMany({ orderBy: { revealAt: "asc" } });
  console.log(`${rows.length} schedule row(s)\n`);

  for (const r of rows) {
    const due = !!r.revealAt && !r.revealedAt && r.revealAt <= now;
    const overdue = due ? Math.round((now.getTime() - r.revealAt!.getTime()) / 60000) : 0;
    console.log(`drop        ${r.drop}`);
    console.log(`revealAt    ${r.revealAt ? `${r.revealAt.toISOString()}   Oslo ${oslo(r.revealAt)}` : "paused (null)"}`);
    console.log(`revealedAt  ${r.revealedAt ? `${r.revealedAt.toISOString()}   Oslo ${oslo(r.revealedAt)}` : "not yet"}`);
    console.log(`state       ${r.revealedAt ? "DONE" : due ? `DUE ${overdue} min ago — SHOULD HAVE FIRED` : "waiting"}`);
    console.log(`lastResult  ${r.lastResult ?? "—"}`);
    console.log(`updatedAt   ${r.updatedAt.toISOString()}\n`);
  }

  await prisma.$disconnect();
}

main();
