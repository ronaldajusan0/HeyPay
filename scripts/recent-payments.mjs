// Compact view of the latest payments and whether each settled to the merchant bank.
//
// Run from the repo root. Set DATABASE_URL first (see the PowerShell / bash forms below),
// then:
//   node scripts/recent-payments.mjs --list 20
//
// The staging host in Railway logs (postgres.railway.internal) only resolves INSIDE
// Railway. From your laptop use the PUBLIC url: Railway -> Postgres -> Variables ->
// DATABASE_PUBLIC_URL (host looks like xxx.proxy.rlwy.net:PORT).
import pg from "pg";

const { Client } = pg;

// --- args: `--list N` (default 20) ---
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
  console.error("  node scripts/recent-payments.mjs --list 20\n");
  console.error("bash / git-bash:");
  console.error('  DATABASE_URL="postgresql://..." node scripts/recent-payments.mjs --list 20');
  process.exit(1);
}

// Railway's public proxy speaks plain TCP; only enable SSL if the url asks for it.
const ssl = /sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : undefined;

const SETTLED = "SETTLED";
const DEAD = new Set(["FAILED", "REFUNDED"]);

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main() {
  const client = new Client({ connectionString, ssl });
  await client.connect();

  const { rows } = await client.query(
    `SELECT p.reference, p.status,
            p."amountPhp", p."pdaxFeePhp", p."netSettledPhp", p."amountXlm",
            p."createdAt", p."settledAt", p."failureReason",
            p."stellarTxHash", p."pdaxCashoutRef",
            m."businessName", m."settlementBankCode", m."accountNumberLast4"
       FROM "Payment" p
       JOIN "Merchant" m ON m.id = p."merchantId"
      ORDER BY p."createdAt" DESC
      LIMIT $1`,
    [limit],
  );

  await client.end();

  if (rows.length === 0) {
    console.log("No payments found.");
    return;
  }

  rows.forEach((r, i) => {
    const settled = r.status === SETTLED;
    const tag = settled ? "->BANK" : DEAD.has(r.status) ? "NOT-PAID" : "IN-FLIGHT";
    let line =
      `#${pad(i + 1, 3)}${pad(r.reference, 18)} ${pad(r.status, 17)} ${pad(tag, 10)}` +
      ` amount=${r.amountPhp}  fee=${r.pdaxFeePhp}` +
      `  created=${new Date(r.createdAt).toISOString()}`;
    if (settled) {
      line += `  net=${r.netSettledPhp}  bank=${r.settlementBankCode}****${r.accountNumberLast4}`;
      if (r.settledAt) line += `  settled=${new Date(r.settledAt).toISOString()}`;
    }
    if (r.failureReason) line += `  reason=${r.failureReason}`;
    console.log(line);
  });

  const settledCount = rows.filter((r) => r.status === SETTLED).length;
  const inflight = rows.filter((r) => r.status !== SETTLED && !DEAD.has(r.status)).length;
  console.log(
    `\n${settledCount} settled to bank, ${inflight} in-flight/stuck, ` +
      `${rows.length - settledCount - inflight} failed/refunded (of ${rows.length}).`,
  );
  if (inflight > 0) {
    console.log("In-flight = worker not draining the settle queue (check it's Online + shares REDIS_URL).");
  }
}

main().catch((err) => {
  console.error("\nQuery failed:", err.message);
  if (/self-signed|SSL|sslmode/i.test(err.message)) {
    console.error("Try appending ?sslmode=require to the DATABASE_URL.");
  }
  process.exit(1);
});
