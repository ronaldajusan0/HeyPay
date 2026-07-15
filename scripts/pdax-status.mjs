#!/usr/bin/env node
// PDAX Institution UAT — payout/trade status checker.
//
// Usage:
//   node scripts/pdax-status.mjs <identifier> [more...]   check payout(s) by identifier
//   node scripts/pdax-status.mjs --list [N]                list N most-recent cash-outs (default 10)
//   node scripts/pdax-status.mjs --order <orderId>         check a trade (sell) order
//   node scripts/pdax-status.mjs --watch <identifier>      poll a payout every 3s until terminal
//
// Reads PDAX_INSTI_* from .env. No deps.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const env = {};
  let text = "";
  try {
    text = readFileSync(join(ROOT, ".env"), "utf8");
  } catch {
    fail(".env not found at repo root");
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/\s+#.*$/, "").trim();
  }
  return env;
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const env = loadEnv();
const BASE = env.PDAX_INSTI_BASE_URL;
const USER = env.PDAX_INSTI_USERNAME;
const PASS = env.PDAX_INSTI_PASSWORD;
if (!BASE || !USER || !PASS) fail("PDAX_INSTI_BASE_URL / USERNAME / PASSWORD missing in .env");

async function login() {
  const res = await fetch(`${BASE}/pdax-institution/v1/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) fail(`login -> ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { access_token: j.access_token, id_token: j.id_token };
}

function headers(tok) {
  return { access_token: tok.access_token, id_token: tok.id_token };
}

async function fetchTx(tok, { identifier, pageSize = 1 } = {}) {
  const qs = new URLSearchParams({ mode: "CashOut", page: "1", pageSize: String(pageSize) });
  if (identifier) qs.set("identifier", identifier);
  const res = await fetch(`${BASE}/pdax-institution/v1/fiat/transactions?${qs}`, {
    headers: headers(tok),
  });
  if (!res.ok) fail(`transactions -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).data ?? [];
}

async function fetchOrder(tok, orderId) {
  const res = await fetch(`${BASE}/pdax-institution/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: headers(tok),
  });
  if (!res.ok) fail(`order -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).data;
}

const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

function colorStatus(status, declinedAt) {
  const s = String(status || "").toUpperCase();
  if (declinedAt || ["FAILED", "REJECTED", "DECLINED"].includes(s)) return C.red(s || "DECLINED");
  if (s === "COMPLETED" || s === "SUCCESSFUL") return C.green(s);
  return C.yellow(s || "(unknown)");
}

function printTx(label, tx) {
  if (!tx) {
    console.log(`${label.padEnd(24)} ${C.dim("(not visible yet)")}`);
    return;
  }
  const parts = [colorStatus(tx.status, tx.declined_at), `amount=${tx.amount}`, `fee=${tx.fee}`];
  if (tx.declined_at) parts.push(C.red(`declined@${tx.declined_at}`));
  if (tx.rejection_reason) parts.push(C.red(`reason=${tx.rejection_reason}`));
  if (tx.created_at) parts.push(C.dim(`created=${tx.created_at}`));
  console.log(`${label.padEnd(24)} ${parts.join("  ")}`);
}

const isTerminal = (tx) =>
  !!tx &&
  (tx.declined_at ||
    ["COMPLETED", "SUCCESSFUL", "FAILED", "REJECTED", "DECLINED"].includes(
      String(tx.status).toUpperCase(),
    ));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), "utf8")
        .split("\n")
        .slice(2, 12)
        .join("\n"),
    );
    return;
  }
  const tok = await login();

  if (argv[0] === "--list") {
    const n = Number(argv[1] ?? "10") || 10;
    const rows = await fetchTx(tok, { pageSize: n });
    if (!rows.length) return console.log(C.dim("no cash-out transactions found"));
    rows.forEach((tx, i) => printTx(`#${i + 1} ${tx.identifier ?? ""}`.trim(), tx));
    return;
  }

  if (argv[0] === "--order") {
    const id = argv[1];
    if (!id) fail("--order needs an orderId");
    const o = await fetchOrder(tok, id);
    console.log(`order ${id}: ${colorStatus(o.status)}  total_amount=${o.total_amount}`);
    return;
  }

  if (argv[0] === "--watch") {
    const id = argv[1];
    if (!id) fail("--watch needs an identifier");
    for (let i = 0; i < 40; i++) {
      const [tx] = await fetchTx(tok, { identifier: id });
      printTx(`t+${i * 3}s ${id}`, tx);
      if (isTerminal(tx)) return;
      await sleep(3000);
    }
    console.log(C.dim("still not terminal after 120s; giving up"));
    return;
  }

  // default: one-shot status for each identifier arg
  for (const id of argv) {
    const [tx] = await fetchTx(tok, { identifier: id });
    printTx(id, tx);
  }
}

main().catch((e) => fail(e.message));
