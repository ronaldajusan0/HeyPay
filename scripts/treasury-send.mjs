#!/usr/bin/env node
// Treasury ops — send XLM from the treasury wallet (STELLAR_TREASURY_SECRET).
//
// Usage:
//   node scripts/treasury-send.mjs <destination> <amount> [memo]
//
// Reads STELLAR_* from .env. Used to front on-chain refunds manually, e.g. to
// heal a wallet whose DB ledger was credited before on-chain refunds existed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const { Keypair, TransactionBuilder, Operation, Asset, Memo, Horizon } =
  require("@stellar/stellar-sdk");

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const env = {};
for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/\s+#.*$/, "").trim();
}

const [destination, amount, memo] = process.argv.slice(2);
if (!destination || !amount) fail("usage: treasury-send.mjs <destination> <amount> [memo]");
if (!env.STELLAR_TREASURY_SECRET) fail("STELLAR_TREASURY_SECRET missing in .env");

const kp = Keypair.fromSecret(env.STELLAR_TREASURY_SECRET);
const server = new Horizon.Server(env.STELLAR_HORIZON_URL);

const account = await server.loadAccount(kp.publicKey());
let builder = new TransactionBuilder(account, {
  fee: String(await server.fetchBaseFee()),
  networkPassphrase: env.STELLAR_NETWORK_PASSPHRASE,
}).addOperation(Operation.payment({ destination, asset: Asset.native(), amount }));
if (memo) builder = builder.addMemo(Memo.text(memo));
const tx = builder.setTimeout(180).build();
tx.sign(kp);

try {
  const res = await server.submitTransaction(tx);
  console.log(`sent ${amount} XLM ${kp.publicKey().slice(0, 6)}… -> ${destination.slice(0, 6)}…`);
  console.log(`tx hash: ${res.hash}`);
} catch (e) {
  const codes = e?.response?.data?.extras?.result_codes;
  fail(codes ? JSON.stringify(codes) : e.message);
}

const dest = await server.loadAccount(destination);
const native = dest.balances.find((b) => b.asset_type === "native");
console.log(`destination XLM balance now: ${native?.balance}`);
