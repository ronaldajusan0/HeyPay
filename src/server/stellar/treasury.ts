// src/server/stellar/treasury.ts
//
// Ops-owned hot wallet that fronts on-chain refunds. When a payment fails after
// the payer's crypto has been sold at the rail, the value is stranded there as
// PHP — so the crypto returned to the payer has to come from somewhere else.
// This wallet is that somewhere: it sends the refund on-chain, and ops recovers
// the equivalent from the rail's PHP balance out-of-band.
import "server-only";
import { Keypair } from "@stellar/stellar-sdk";
import { encryptSecret } from "@/server/crypto/envelope";

export type Treasury = { publicKey: string; encryptedSecret: string };

let cached: Treasury | null = null;

/**
 * The treasury wallet from `STELLAR_TREASURY_SECRET`, or null when not
 * configured. The secret is re-wrapped with envelope encryption at first use so
 * it rides through {@link import("./wallet").WalletService} exactly like a
 * custodial wallet's secret — decrypted only at signing time.
 */
export function getTreasury(): Treasury | null {
  if (cached) return cached;
  const secret = process.env.STELLAR_TREASURY_SECRET?.trim();
  if (!secret) return null;
  const keypair = Keypair.fromSecret(secret);
  cached = { publicKey: keypair.publicKey(), encryptedSecret: encryptSecret(secret) };
  return cached;
}

export function __resetTreasuryForTests(): void {
  cached = null;
}
