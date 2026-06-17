// Pure Ledger calculations (no localStorage, no Svelte state) so Vitest can
// cover them without plugins. Ledger.svelte wraps these in $derived.

export interface ExpenseItem {
    name: string;
    amount: number;
    type: string; // WOWPASS | Cash | Deposit-WOWPASS | Deposit-Cash
    date: string;
    /**
     * Ephemeral, runtime-only key (same pattern as `ChecklistItem._id`):
     * assigned on load / creation and stripped on serialization, so it never
     * appears in the saved/exported YAML. Used as the `{#each}` key and the
     * lookup handle for delete.
     */
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
}

// `Deposit-` prefix marks top-ups; everything else is spending.
export function computeLedgerTotals(items: ExpenseItem[]): LedgerTotals {
    const totalDeposited = items
        .filter(item => item.type.startsWith("Deposit"))
        .reduce((sum, item) => sum + item.amount, 0);
    const totalSpent = items
        .filter(item => !item.type.startsWith("Deposit"))
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
            };
        case "KRW":
            return {
                currencyCode: "KRW",
                currencyName: "韓元",
                currencySymbol: "₩",
            };
        case "TWD":
            return {
                currencyCode: "TWD",
                currencyName: "台幣",
                currencySymbol: "NT$",
            };
        case "USD":
            return {
                currencyCode: "USD",
                currencyName: "美元",
                currencySymbol: "$",
            };
        default:
            return {
                currencyCode: code,
                currencyName: code,
                currencySymbol: "$",
            };
    }
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

// Quick buttons follow fixed TWD price points converted at the current rate.
export function computeQuickAmounts(activeCurrency: string, exchangeRate: number): number[] {
    if (activeCurrency === "TWD" || exchangeRate <= 0) {
        return [100, 200, 500, 1000, 2000, 5000];
    }
    const rounded = [50, 100, 250, 500, 1000, 2000]
        .map(twd => roundQuickAmount(twd * exchangeRate));
    return [...new Set(rounded)];
}

export function foreignToTwd(foreignValue: string, exchangeRate: number): string {
    const foreign = parseFloat(foreignValue) || 0;
    return Math.round(foreign / exchangeRate).toString();
}

export function twdToForeign(twdValue: string, exchangeRate: number): string {
    const twd = parseFloat(twdValue) || 0;
    return Math.round(twd * exchangeRate).toString();
}

// Single source for the zh-TW type label — the history list and the CSV
// export must never drift apart.
export function ledgerTypeLabel(type: string): string {
    if (!type) return "";
    if (type === "Cash") return "現金支付";
    if (type === "Deposit-Cash") return "現金兌換";
    if (type.startsWith("Deposit-")) return `${type.slice("Deposit-".length)} 加值`;
    return `${type} 支付`;
}
