/**
 * Inspect the latest payments and whether they settled to the merchant's bank.
 *
 * Usage (run from the repo root):
 *   DATABASE_URL="<staging-postgres-url>" pnpm tsx scripts/recent-payments.ts [limit]
 *
 * The staging DB host in Railway logs (postgres.railway.internal) only resolves
 * INSIDE Railway. From your laptop use the PUBLIC connection string: Railway ->
 * Postgres service -> Variables -> DATABASE_PUBLIC_URL (or the proxy host:port).
 *
 * `limit` defaults to 20.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const limit = Number(process.argv[2] ?? "20");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Pass the staging Postgres PUBLIC url, e.g.:");
  console.error(
    '  DATABASE_URL="postgresql://user:pass@host:port/db" pnpm tsx scripts/recent-payments.ts',
  );
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Statuses that mean money actually reached the merchant's bank account.
const SETTLED = "SETTLED";
// Terminal failure/refund states — no payout happened.
const DEAD = new Set(["FAILED", "REFUNDED"]);

function fmtTime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

async function main() {
  const host = connectionString!.replace(/\/\/[^@]*@/, "//***@"); // hide creds
  console.log(`\nDB: ${host}`);
  console.log(`Latest ${limit} payments (newest first)\n`);

  const payments = await prisma.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      merchant: {
        select: {
          businessName: true,
          settlementBankCode: true,
          settlementBankName: true,
          accountName: true,
          accountNumberLast4: true,
        },
      },
      payer: { select: { username: true } },
    },
  });

  if (payments.length === 0) {
    console.log("No payments found.");
    return;
  }

  const rows = payments.map((p) => ({
    created: fmtTime(p.createdAt),
    reference: p.reference,
    status: p.status,
    payer: p.payer.username,
    merchant: p.merchant.businessName,
    php: p.amountPhp.toString(),
    asset: p.asset,
    amount: p.amountAsset.toString(),
    netPhp: p.netSettledPhp?.toString() ?? "-",
    bank: `${p.merchant.settlementBankCode} ****${p.merchant.accountNumberLast4}`,
    settledAt: p.settledAt ? fmtTime(p.settledAt) : "-",
  }));
  console.table(rows);

  // Per-payment detail for anything not cleanly settled, plus refs to trace.
  console.log("\nDetail:");
  for (const p of payments) {
    const paidOut = p.status === SETTLED;
    const mark = paidOut ? "SETTLED->BANK" : DEAD.has(p.status) ? "NOT PAID" : "IN-FLIGHT";
    console.log(`\n[${mark}] ${p.reference}  (${p.status})  ${fmtTime(p.createdAt)}`);
    console.log(
      `  merchant: ${p.merchant.businessName} | ${p.merchant.accountName} | ` +
        `${p.merchant.settlementBankName} (${p.merchant.settlementBankCode}) ****${p.merchant.accountNumberLast4}`,
    );
    console.log(
      `  amount: ${p.amountPhp.toString()} PHP  (${p.amountAsset.toString()} ${p.asset} @ ${p.quotedRate.toString()})` +
        (paidOut
          ? `  -> net paid: ${p.netSettledPhp?.toString()} PHP at ${p.settledAt ? fmtTime(p.settledAt) : "?"}`
          : ""),
    );
    console.log(
      `  refs: stellarTx=${p.stellarTxHash ?? "-"}  pdaxTrade=${p.pdaxTradeRef ?? "-"}  pdaxCashout=${p.pdaxCashoutRef ?? "-"}`,
    );
    if (p.failureReason) console.log(`  failureReason: ${p.failureReason}`);
  }

  // Tally by status so you can see stuck vs settled at a glance.
  const tally = new Map<string, number>();
  for (const p of payments) tally.set(p.status, (tally.get(p.status) ?? 0) + 1);
  console.log("\nStatus tally (of shown):");
  for (const [status, n] of [...tally.entries()].sort()) console.log(`  ${status.padEnd(18)} ${n}`);

  const settled = payments.filter((p) => p.status === SETTLED);
  const inflight = payments.filter((p) => p.status !== SETTLED && !DEAD.has(p.status));
  console.log(
    `\n${settled.length} settled to bank, ${inflight.length} in-flight/stuck, ` +
      `${payments.length - settled.length - inflight.length} failed/refunded.`,
  );
  if (inflight.length > 0) {
    console.log(
      "In-flight payments not moving usually mean the worker isn't draining the settle queue.",
    );
  }
}

main()
  .catch((err) => {
    console.error("\nQuery failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
