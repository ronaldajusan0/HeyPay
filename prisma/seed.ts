import "dotenv/config";
import { createCipheriv, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { Keypair } from "@stellar/stellar-sdk";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Role, MerchantStatus } from "../src/generated/prisma/client";
import { TEST_ACCOUNTS } from "../src/lib/test-accounts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// Minimal inline argon2id hash so the seed is self-contained (Phase 2 centralizes this).
async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

// Inline AES-256-GCM secret encryption, byte-for-byte compatible with
// src/server/crypto/envelope.ts (which is server-only and can't be imported here).
// A payer needs a custodial wallet or the payer UI renders blank.
function encryptSecret(plaintext: string): string {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw) throw new Error("ENCRYPTION_MASTER_KEY is not set");
  const version = Number(process.env.ENCRYPTION_KEY_VERSION ?? "1");
  const b64 = raw.startsWith("base64:") ? raw.slice("base64:".length) : raw;
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_MASTER_KEY must decode to exactly 32 bytes (AES-256)");
  }
  const iv = randomBytes(12); // GCM standard nonce length
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${version}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString(
    "base64",
  )}`;
}

// Mirrors walletService.generate() (src/server/stellar/wallet.ts) without the
// server-only import chain.
function generateWallet(): {
  publicKey: string;
  encryptedSecret: string;
  secretKeyVersion: number;
} {
  const kp = Keypair.random();
  return {
    publicKey: kp.publicKey(),
    encryptedSecret: encryptSecret(kp.secret()),
    secretKeyVersion: Number(process.env.ENCRYPTION_KEY_VERSION ?? "1"),
  };
}

async function seedAdmin(): Promise<void> {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be set to seed the admin.");
  }
  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.upsert({
    where: { username },
    update: { role: Role.ADMIN, isActive: true },
    create: { username, passwordHash, role: Role.ADMIN },
  });
  console.log(`[seed] admin ready: ${admin.username}`);

  // For managed/e2e deploys where the admin is pre-provisioned, mark the force-change
  // gate satisfied by recording the password-change audit the gate looks for (idempotent).
  if (process.env.SEED_ADMIN_PWCHANGE_DONE === "true") {
    const already = await prisma.auditLog.findFirst({
      where: { actorId: admin.id, action: "auth.password.change" },
      select: { id: true },
    });
    if (!already) {
      await prisma.auditLog.create({
        data: { actorId: admin.id, action: "auth.password.change", target: admin.id },
      });
    }
    console.log("[seed] admin password-change gate marked satisfied");
  }
}

// Hardcoded test/demo accounts (src/lib/test-accounts.ts). Always seeded so the
// credentials shown on the login page actually work. The merchant gets a
// pre-filled Security Bank settlement account.
async function seedTestAccounts(): Promise<void> {
  for (const acc of TEST_ACCOUNTS) {
    const passwordHash = await hashPassword(acc.password);
    const user = await prisma.user.upsert({
      where: { username: acc.username },
      update: { role: Role[acc.role], isActive: true, passwordHash },
      create: { username: acc.username, passwordHash, role: Role[acc.role] },
    });

    if (acc.role === "PAYER") {
      // Without a custodial wallet the payer dashboard/prefund pages render blank.
      const existing = await prisma.custodialWallet.findUnique({ where: { userId: user.id } });
      if (existing) {
        // keep — regenerating would orphan any funds already sent to the old address
      } else if (!process.env.ENCRYPTION_MASTER_KEY) {
        console.warn(`[seed] ENCRYPTION_MASTER_KEY not set; ${acc.username} has no wallet`);
      } else {
        const w = generateWallet();
        await prisma.custodialWallet.create({
          data: {
            userId: user.id,
            stellarPublicKey: w.publicKey,
            encryptedSecret: w.encryptedSecret,
            secretKeyVersion: w.secretKeyVersion,
          },
        });
        console.log(`[seed] wallet ready for ${acc.username}: ${w.publicKey}`);
      }
    }

    // NOTE: no Merchant profile is seeded for the test merchant on purpose — they
    // must complete onboarding after logging in (business name, settlement account,
    // QRPH). With no profile, requireMerchant() redirects them to /merchant/onboarding.
    // The onboarding form shows the Security Bank test settlement account to enter.
    console.log(`[seed] test ${acc.role.toLowerCase()} ready: ${acc.username}`);
  }
}

async function seedDemo(): Promise<void> {
  if (process.env.SEED_DEMO !== "true") {
    console.log("[seed] SEED_DEMO != 'true'; skipping demo data.");
    return;
  }

  // Demo payer. Custodial testnet wallet + friendbot funding is wired in Phase 3.
  const payerHash = await hashPassword("demo-payer-pass");
  const payer = await prisma.user.upsert({
    where: { username: "demo-payer" },
    update: {},
    create: { username: "demo-payer", passwordHash: payerHash, role: Role.PAYER },
  });
  console.log(
    `[seed] demo payer ready: ${payer.username} (custodial wallet stubbed until Phase 3)`,
  );

  // Demo merchant with a sample decoded QRPH + masked test bank account.
  // accountNumber is a placeholder; Phase 3 replaces it with an envelope-encrypted value.
  const merchantHash = await hashPassword("demo-merchant-pass");
  const merchantUser = await prisma.user.upsert({
    where: { username: "demo-merchant" },
    update: {},
    create: { username: "demo-merchant", passwordHash: merchantHash, role: Role.MERCHANT },
  });
  await prisma.merchant.upsert({
    where: { userId: merchantUser.id },
    update: {},
    create: {
      userId: merchantUser.id,
      businessName: "Demo Sari-Sari Store",
      status: MerchantStatus.ACTIVE,
      qrphRaw:
        "00020101021128120008ph.qrph0104DEMO5204000053036085802PH5914DEMO SARI-SARI6006MANILA6304ABCD",
      qrphMerchantName: "DEMO SARI-SARI",
      qrphMerchantCity: "MANILA",
      qrphMerchantId: "DEMO-MID-0001",
      qrphCountry: "PH",
      qrphCurrency: "608",
      settlementBankCode: "BPI",
      settlementBankName: "Bank of the Philippine Islands",
      accountName: "Demo Merchant Inc.",
      accountNumber: "stub:encrypt-in-phase3",
      accountNumberLast4: "6789",
    },
  });
  console.log(`[seed] demo merchant ready: ${merchantUser.username}`);
}

async function main(): Promise<void> {
  await seedTestAccounts();
  await seedAdmin();
  await seedDemo();
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
