// Hardcoded demo/test accounts.
//
// Single source of truth for two consumers:
//   • prisma/seed.ts    — creates these users (and the merchant profile) in the DB
//   • the login page     — shows the credentials in the "TEST ACCOUNT" card
//
// These are throwaway credentials for a test/demo environment ONLY. The card can
// be hidden by setting NEXT_PUBLIC_SHOW_TEST_ACCOUNTS="false"; never ship these
// to a real production deployment.

export type TestAccountRole = "PAYER" | "MERCHANT";

export type TestAccount = {
  role: TestAccountRole;
  /** Human label shown on the card, e.g. "Payer". */
  label: string;
  username: string;
  password: string;
};

export const TEST_ACCOUNTS: readonly TestAccount[] = [
  { role: "PAYER", label: "Payer", username: "Payer5", password: "12345678" },
  { role: "MERCHANT", label: "Merchant", username: "merchant2", password: "12345678" },
] as const;

// Settlement bank account every test merchant should use. `bankCode` matches an
// entry in src/server/merchant/banks.ts (SUPPORTED_BANKS).
export const TEST_SETTLEMENT = {
  bankCode: "SECURITYBANK",
  bankName: "Security Bank",
  accountName: "Merchant Test Account",
  accountNumber: "0000042001461",
} as const;

/** Last 4 digits of the settlement account (as stored on Merchant.accountNumberLast4). */
export const TEST_SETTLEMENT_LAST4 = TEST_SETTLEMENT.accountNumber.slice(-4);

/** Whether the login page should render the test-account card. Default: on. */
export function showTestAccounts(): boolean {
  return process.env.NEXT_PUBLIC_SHOW_TEST_ACCOUNTS !== "false";
}
