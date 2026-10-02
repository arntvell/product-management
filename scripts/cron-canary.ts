// Prove the Vercel cron actually reaches runDue, without touching a product.
//
//   npx dotenv -e .env.local -- npx tsx scripts/cron-canary.ts set
//   npx dotenv -e .env.local -- npx tsx scripts/cron-canary.ts check
//   npx dotenv -e .env.local -- npx tsx scripts/cron-canary.ts clear
//
// A schedule row whose drop label matches no SeasonEntry takes the
// `!live.length` branch: it writes lastResult, resets revealedAt to null and
// leaves itself scheduled. So it is a signal that the cron ran, repeatable
// every tick, that reveals nothing.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const DROP = "CRON CANARY — delete me";

async function main() {
  const cmd = process.argv[2] ?? "check";
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_URL_NON_POOLING }),
  });

  if (cmd === "set") {
    const row = await prisma.vintageDropReveal.upsert({
      where: { drop: DROP },
      create: { drop: DROP, revealAt: new Date(Date.now() - 60_000) },
      update: { revealAt: new Date(Date.now() - 60_000), revealedAt: null, lastResult: null },
    });
    console.log("canary armed, due since", row.revealAt?.toISOString());
  } else if (cmd === "clear") {
    await prisma.vintageDropReveal.deleteMany({ where: { drop: DROP } });
    console.log("canary removed");
  } else {
    const row = await prisma.vintageDropReveal.findUnique({ where: { drop: DROP } });
    if (!row) console.log("no canary row");
    else
      console.log(
        row.lastResult
          ? `FIRED — lastResult: ${row.lastResult}  (updatedAt ${row.updatedAt.toISOString()})`
          : `not yet — armed at ${row.revealAt?.toISOString()}, now ${new Date().toISOString()}`
      );
  }

  // Never leave the real drop disturbed.
  const real = await prisma.vintageDropReveal.findUnique({ where: { drop: "DROP 188" } });
  console.log(`DROP 188: revealAt ${real?.revealAt?.toISOString()} revealedAt ${real?.revealedAt?.toISOString() ?? "null"}`);

  await prisma.$disconnect();
}

main();
