// "TEST ACCOUNT" card shown on the login page (demo/test environment only).
// Lists the seeded test credentials and the settlement account every test
// merchant should use. Data comes from src/lib/test-accounts.ts.
import { TEST_ACCOUNTS, TEST_SETTLEMENT } from "@/lib/test-accounts";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-stack-md">
      <span className="text-label-md uppercase text-on-surface-variant">{label}</span>
      <span className="font-mono text-mono-data text-on-surface">{value}</span>
    </div>
  );
}

export function TestAccountsCard() {
  return (
    <section
      aria-label="Test accounts"
      className="rounded-xl border border-outline-variant bg-surface-container-low p-stack-lg"
    >
      <h2 className="mb-stack-md text-label-md uppercase tracking-wide text-on-surface-variant">
        Test accounts
      </h2>

      <div className="flex flex-col gap-stack-md">
        {TEST_ACCOUNTS.map((acc) => (
          <div key={acc.username} className="flex flex-col gap-stack-sm">
            <p className="text-body-sm font-semibold text-on-surface">{acc.label}</p>
            <Field label="Username" value={acc.username} />
            <Field label="Password" value={acc.password} />
          </div>
        ))}
      </div>

      {/* Settlement notice — merchants must use this bank + account number. */}
      <div className="mt-stack-lg rounded-lg bg-primary/10 p-stack-md">
        <p className="mb-stack-sm flex items-center gap-stack-sm text-body-sm font-semibold text-primary">
          <span className="material-symbols-outlined text-base">account_balance</span>
          Merchant settlement account
        </p>
        <p className="mb-stack-sm text-body-sm text-on-surface-variant">
          When setting up settlement, use this test bank account:
        </p>
        <Field label="Bank" value={TEST_SETTLEMENT.bankName} />
        <Field label="Account no." value={TEST_SETTLEMENT.accountNumber} />
      </div>
    </section>
  );
}
