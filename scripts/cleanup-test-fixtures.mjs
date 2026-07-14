#!/usr/bin/env node
// One-off: remove vitest fixture rows leaked into the dev database back when
// .env.test pointed DATABASE_URL at `heypay` instead of `heypay_test`.
// Fixture users are recognizable by the tests/helpers/db.ts username pattern:
// `payer-<uuid>` / `merchant-<uuid>`. Deletes them and everything they own.
//
// Usage: node scripts/cleanup-test-fixtures.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const pg = require("pg");

const envLine = readFileSync(join(ROOT, ".env"), "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("DATABASE_URL="));
if (!envLine) {
  console.error("error: DATABASE_URL missing in .env");
  process.exit(1);
}
const url = envLine.slice("DATABASE_URL=".length).replace(/\s+#.*$/, "").trim();

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const client = new pg.Client(url);
await client.connect();
try {
  await client.query("BEGIN");
  const users = await client.query(
    `select id, username from "User" where username ~ $1`,
    [`^(payer|merchant)-${UUID}$`],
  );
  const ids = users.rows.map((r) => r.id);
  console.log(`fixture users found: ${ids.length}`);
  if (ids.length === 0) {
    await client.query("ROLLBACK");
    process.exit(0);
  }
  for (const u of users.rows) console.log(`  ${u.username}`);

  const run = async (label, sql) => {
    const res = await client.query(sql, [ids]);
    console.log(`${label}: ${res.rowCount} deleted`);
  };
  // Children first (FK order).
  await run(
    "paymentEvents",
    `delete from "PaymentEvent" where "paymentId" in (
       select id from "Payment" where "payerId" = any($1)
       or "merchantId" in (select id from "Merchant" where "userId" = any($1)))`,
  );
  await run(
    "walletTransactions",
    `delete from "WalletTransaction" where "walletId" in (
       select id from "CustodialWallet" where "userId" = any($1))`,
  );
  await run(
    "payments",
    `delete from "Payment" where "payerId" = any($1)
     or "merchantId" in (select id from "Merchant" where "userId" = any($1))`,
  );
  await run(
    "walletBalances",
    `delete from "WalletBalance" where "walletId" in (
       select id from "CustodialWallet" where "userId" = any($1))`,
  );
  await run("custodialWallets", `delete from "CustodialWallet" where "userId" = any($1)`);
  await run("merchants", `delete from "Merchant" where "userId" = any($1)`);
  await run("auditLogs", `delete from "AuditLog" where "actorId" = any($1)`);
  await run("sessions", `delete from "Session" where "userId" = any($1)`);
  await run("users", `delete from "User" where id = any($1)`);
  await client.query("COMMIT");
  console.log("done — worker log spam (Horizon Bad Request / PDAX orderId 400) stops next tick");
} catch (e) {
  await client.query("ROLLBACK");
  console.error("rolled back:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
