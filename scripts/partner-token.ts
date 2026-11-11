// Mint a partner token for /api/partner/v1/*. Prints it ONCE; only its hash is
// stored. Minting again for the same name replaces the old token.
//
//   npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json scripts/partner-token.ts loom \
//     products:create categories:read master-data:write
//   … scripts/partner-token.ts loom --revoke
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { hashPartnerToken } from "../src/lib/partner/auth";

const SCOPES = ["products:create", "categories:read", "master-data:write"];

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  if (!name) throw new Error("usage: partner-token.ts <name> <scope…> | --revoke");
  if (rest.includes("--revoke")) {
    await prisma.partnerToken.update({ where: { name }, data: { revokedAt: new Date() } });
    console.log(`${name}: revoked`);
    return;
  }
  const bad = rest.filter((s) => !SCOPES.includes(s));
  if (!rest.length || bad.length) throw new Error(`scopes must be from: ${SCOPES.join(", ")}`);
  const token = `orp_${randomBytes(32).toString("base64url")}`;
  const data = { tokenHash: hashPartnerToken(token), scopes: rest, revokedAt: null, lastUsedAt: null };
  await prisma.partnerToken.upsert({ where: { name }, create: { name, ...data }, update: data });
  console.log(`${name}: ${rest.join(", ")}\n\n${token}\n\nShown once. Give it to the partner as ORIGIO_PARTNER_TOKEN.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
);
