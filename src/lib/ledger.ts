// Ledger math kept free of localStorage and Svelte state, which is what lets
// Vitest cover it — `Ledger.svelte` wraps these in `$derived`.

/**
 * One key per currency (`exchange_rate_JPY`). Predates the `showmeway_` prefix,
 * so `storage-admin.ts` has to know it by name — declared here, where the Ledger
 * owns it, rather than restated there.
 */
export const MANUAL_RATE_KEY_PREFIX = "exchange_rate_";

export interface ExpenseItem {
    name: string;
    amount: number;
    type: string; // WOWPASS | Cash | Deposit-WOWPASS | Deposit-Cash
    date: string;
    /** Runtime-only, like `ChecklistItem._id`. */
    _id?: string;
}

export interface LedgerTotals {
    totalDeposited: number;
    totalSpent: number;
    balance: number;
}

export interface WalletBalance {
    wallet: string;
    balance: number;
}

export interface CurrencyConfig {
    currencyCode: string;
    currencyName: string;
    currencySymbol: string;
    /** What a trip in this currency almost certainly uses, so a new trip has usable wallets before the user configures any. */
    defaultWallets: string[];
}

/**
 * `Deposit-<wallet>` marks a top-up; everything else is spending. The one place
 * the prefix is matched — a wallet named "Deposital" must count as spending
 * everywhere, not split between callers matching "Deposit" and "Deposit-".
 */
export function isDeposit(type: string): boolean {
    return type.startsWith("Deposit-");
}

export function computeLedgerTotals(items: ExpenseItem[]): LedgerTotals {
    const totalDeposited = items
        .filter(item => isDeposit(item.type))
        .reduce((sum, item) => sum + item.amount, 0);
    const totalSpent = items
        .filter(item => !isDeposit(item.type))
        .reduce((sum, item) => sum + item.amount, 0);
    return { totalDeposited, totalSpent, balance: totalDeposited - totalSpent };
}

// Per-wallet breakdown reusing the `Deposit-<wallet>` / `<wallet>` type convention
export function computeWalletBalances(items: ExpenseItem[], wallets: string[]): WalletBalance[] {
    return [...new Set([...wallets, "Cash"])].map(wallet => ({
        wallet,
        balance: items.reduce((sum, item) => {
            if (item.type === `Deposit-${wallet}`) return sum + item.amount;
            if (item.type === wallet) return sum - item.amount;
            return sum;
        }, 0),
    }));
}

export function getCurrencyConfig(code: string): CurrencyConfig {
    switch (code) {
        case "JPY":
            return {
                currencyCode: "JPY",
                currencyName: "日圓",
                currencySymbol: "¥",
                defaultWallets: ["Suica"],
            };
        case "KRW":
            return {
                currencyCode: "KRW",
                currencyName: "韓元",
                currencySymbol: "₩",
                defaultWallets: ["WOWPASS", "T-money"],
            };
        case "TWD":
            return {
                currencyCode: "TWD",
                currencyName: "台幣",
                currencySymbol: "NT$",
                defaultWallets: ["信用卡"],
            };
        case "USD":
            return {
                currencyCode: "USD",
                currencyName: "美元",
                currencySymbol: "$",
                defaultWallets: [],
            };
        default:
            return {
                currencyCode: code,
                currencyName: code,
                currencySymbol: "$",
                defaultWallets: [],
            };
    }
}

// An unusable rate (0 before setup, NaN from corrupt storage) behaves like empty input.
function isUsableRate(exchangeRate: number): boolean {
    return Number.isFinite(exchangeRate) && exchangeRate > 0;
}

export function roundQuickAmount(val: number): number {
    if (val < 1) return parseFloat(val.toFixed(1));
    if (val < 5) return Math.round(val);
    if (val < 50) return Math.round(val / 5) * 5;
    if (val < 100) return Math.round(val / 10) * 10;
    if (val < 1000) return Math.round(val / 50) * 50;
    if (val < 10000) return Math.round(val / 500) * 500;
    return Math.round(val / 5000) * 5000;
}

// Anchored to TWD price points rather than round foreign numbers: the user is
// thinking in what it costs back home.
export function computeQuickAmounts(activeCurrency: string, exchangeRate: number): number[] {
    if (activeCurrency === "TWD" || !isUsableRate(exchangeRate)) {
        return [100, 200, 500, 1000, 2000, 5000];
    }
    const rounded = [50, 100, 250, 500, 1000, 2000]
        .map(twd => roundQuickAmount(twd * exchangeRate));
    return [...new Set(rounded)];
}

export function foreignToTwd(foreignValue: string, exchangeRate: number): string {
    if (!isUsableRate(exchangeRate)) return "0";
    const foreign = parseFloat(foreignValue) || 0;
    return Math.round(foreign / exchangeRate).toString();
}

export function twdToForeign(twdValue: string, exchangeRate: number): string {
    if (!isUsableRate(exchangeRate)) return "0";
    const twd = parseFloat(twdValue) || 0;
    return Math.round(twd * exchangeRate).toString();
}

/**
 * Coerce whatever the legacy `ledger_expenses` key holds into usable records.
 * Nothing is trusted and nothing throws: a bad entry is skipped and a bad field
 * takes a default, because a decade-old localStorage value is not worth failing
 * a boot over.
 */
export function parseLegacyExpenses(raw: unknown, today: string, makeId: () => string): ExpenseItem[] {
    if (!Array.isArray(raw)) return [];
    const out: ExpenseItem[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const r = entry as Partial<Record<"name" | "amount" | "type" | "date", unknown>>;
        out.push({
            name: typeof r.name === "string" ? r.name : "",
            amount: typeof r.amount === "number" ? r.amount : 0,
            type: typeof r.type === "string" ? r.type : "Cash",
            date: typeof r.date === "string" ? r.date : today,
            _id: makeId(),
        });
    }
    return out;
}

/** `-` goes before the symbol (`-NT$1,200`), the way the wallet rows have always shown negatives. */
export function formatAmount(symbol: string, amount: number): string {
    return `${amount < 0 ? "-" : ""}${symbol}${Math.abs(amount).toLocaleString()}`;
}

/** The one place a type is worded, so the history list and the CSV export cannot drift. */
export function ledgerTypeLabel(type: string): string {
    if (!type) return "";
    if (type === "Cash") return "現金支付";
    if (type === "Deposit-Cash") return "現金兌換";
    if (type.startsWith("Deposit-")) return `${type.slice("Deposit-".length)} 加值`;
    return `${type} 支付`;
}

function escapeCsvField(value: string): string {
    return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Spreadsheet export of the ledger, or null when there are no records to export. */
export function buildLedgerCsv(expenses: ExpenseItem[]): string | null {
    if (!Array.isArray(expenses) || expenses.length === 0) return null;
    // The list itself is newest-first insertion order; a spreadsheet wants
    // chronology. Stable sort, so same-day records keep their relative order.
    const rows = [...expenses].sort((a, b) => {
        const dateOf = (i: unknown) => typeof (i as { date?: unknown; })?.date === "string" ? (i as { date: string; }).date : "";
        return dateOf(a).localeCompare(dateOf(b));
    });
    const lines = ["日期,項目,金額,類別"];
    for (const item of rows as Partial<Record<"date" | "name" | "amount" | "type", unknown>>[]) {
        lines.push([
            escapeCsvField(typeof item?.date === "string" ? item.date : ""),
            escapeCsvField(typeof item?.name === "string" ? item.name : ""),
            typeof item?.amount === "number" ? String(item.amount) : "",
            escapeCsvField(ledgerTypeLabel(typeof item?.type === "string" ? item.type : "")),
        ].join(","));
    }
    // Leading BOM: without it Excel decodes the zh-TW headers as mojibake.
    return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
