// Compact view of custodial wallet balances and recent wallet transactions
// (deposits / debits / refunds). Use it to confirm an incoming XLM deposit got
// credited by the deposit-poll worker.
//
// Run from the repo root. Set DATABASE_URL first, then:
//   node scripts/recent-deposits.mjs --list 20
//
// Use Railway -> Postgres -> Variables -> DATABASE_PUBLIC_URL (xxx.proxy.rlwy.net:PORT).
// The postgres.railway.internal host from the logs only resolves inside Railway.
import pg from "pg";

const { Client } = pg;

const args = process.argv.slice(2);
let limit = 20;
const li = args.indexOf("--list");
if (li !== -1 && args[li + 1]) limit = Number(args[li + 1]);
if (!Number.isFinite(limit) || limit <= 0) limit = 20;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.\n");
  console.error("PowerShell:");
  console.error('  $env:DATABASE_URL="postgresql://postgres:PASS@xxx.proxy.rlwy.net:PORT/railway"');
  console.error("  node scripts/recent-deposits.mjs --list 20");
  process.exit(1);
}

const ssl = /sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : undefined;

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function shortKey(k) {
  return k ? `${k.slice(0, 6)}..${k.slice(-6)}` : "-";
}
function num(d) {
  // trim trailing zeros on the 7-dp decimals for readability
  return String(d).replace(/\.?0+$/, "");
}

async function main() {
  const client = new Client({ connectionString, ssl });
  await client.connect();

  const wallets = await client.query(
    `SELECT u.username, w."stellarPublicKey", w."cachedXlmBalance",
            w."reservedXlm", w."lastSyncedAt"
       FROM "CustodialWallet" w
       JOIN "User" u ON u.id = w."userId"
      ORDER BY w."cachedXlmBalance" DESC`,
  );

  const txs = await client.query(
    `SELECT t.type, t."amountXlm", t."balanceAfter", t.memo, t."stellarTxHash",
            t."createdAt", u.username
       FROM "WalletTransaction" t
       JOIN "CustodialWallet" w ON w.id = t."walletId"
       JOIN "User" u ON u.id = w."userId"
      ORDER BY t."createdAt" DESC
      LIMIT $1`,
    [limit],
  );

  await client.end();

  console.log("\nWallets:");
  if (wallets.rows.length === 0) console.log("  (none)");
  for (const w of wallets.rows) {
    const avail = Number(w.cachedXlmBalance) - Number(w.reservedXlm);
    console.log(
      `  ${pad(w.username, 16)} ${shortKey(w.stellarPublicKey)}` +
        `  balance=${num(w.cachedXlmBalance)}  reserved=${num(w.reservedXlm)}  available=${num(avail)}` +
        `  synced=${w.lastSyncedAt ? new Date(w.lastSyncedAt).toISOString() : "never"}`,
    );
  }

  console.log(`\nLatest ${limit} wallet transactions:`);
  if (txs.rows.length === 0) console.log("  (none)");
  txs.rows.forEach((t, i) => {
    const tag = t.type === "PREFUND_DEPOSIT" ? "DEPOSIT" : t.type;
    console.log(
      `#${pad(i + 1, 3)}${pad(t.username, 14)} ${pad(tag, 17)}` +
        ` amount=${num(t.amountXlm)}  balanceAfter=${num(t.balanceAfter)}` +
        `  tx=${shortKey(t.stellarTxHash)}  created=${new Date(t.createdAt).toISOString()}` +
        (t.memo ? `  memo="${t.memo}"` : ""),
    );
  });

  const deposits = txs.rows.filter((t) => t.type === "PREFUND_DEPOSIT");
  console.log(
    `\n${deposits.length} deposit(s) in the last ${txs.rows.length} txs. ` +
      (deposits.length === 0
        ? "No PREFUND_DEPOSIT yet -> deposit-poll worker hasn't credited it (check worker Online + STELLAR_HORIZON_URL=testnet)."
        : "Deposits are being credited."),
  );
}

main().catch((err) => {
  console.error("\nQuery failed:", err.message);
  if (/self-signed|SSL|sslmode/i.test(err.message)) {
    console.error("Try appending ?sslmode=require to the DATABASE_URL.");
  }
  process.exit(1);
});
