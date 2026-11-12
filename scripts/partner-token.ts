// Mint a partner token for /api/partner/v1/*. Prints it ONCE; only its hash is
// stored. Minting again for the same name replaces the old token.
//
//   npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json scripts/partner-token.ts loom \
//     products:create categories:read master-data:write
//   … scripts/partner-token.ts loom --revoke
//   … scripts/partner-token.ts loom --add-scopes brands:create seasons:write
//
// --add-scopes changes the scopes of the existing token IN PLACE. Minting again
// would rotate the token, and the partner's copy would stop working.
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { hashPartnerToken, PARTNER_SCOPES } from "../src/lib/partner/auth";

const SCOPES: readonly string[] = PARTNER_SCOPES;

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  if (!name) throw new Error("usage: partner-token.ts <name> <scope…> | --revoke");
  if (rest.includes("--revoke")) {
    await prisma.partnerToken.update({ where: { name }, data: { revokedAt: new Date() } });
    console.log(`${name}: revoked`);
    return;
  }
  if (rest[0] === "--add-scopes") {
    const add = rest.slice(1);
    const wrong = add.filter((s) => !SCOPES.includes(s));
    if (!add.length || wrong.length) throw new Error(`scopes must be from: ${SCOPES.join(", ")}`);
    const row = await prisma.partnerToken.findUnique({ where: { name } });
    if (!row) throw new Error(`${name}: no token to add scopes to`);
    const scopes = [...new Set([...row.scopes, ...add])];
    await prisma.partnerToken.update({ where: { name }, data: { scopes } });
    console.log(`${name}: ${row.scopes.join(", ")}\n   -> ${scopes.join(", ")}\n(token unchanged)`);
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
