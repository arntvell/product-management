import pg from "pg";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const c = new pg.Client({ connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL });
await c.connect();
const q = await c.query(`SELECT cw."colorwaySku", cp.channel, cp.published, cp."lastPushStatus" FROM "ChannelPublication" cp JOIN "Colorway" cw ON cw.id=cp."colorwayId" WHERE cw."colorwaySku" = ANY($1) ORDER BY 1,2`, [["EXT-ZP","EXT-ZP-1925","EXT-ZP-PB","EXT-SP-PT1925","EXT-RW-MNKOIL","EXT-RW-97106"]]);
console.table(q.rows);
await c.end();
