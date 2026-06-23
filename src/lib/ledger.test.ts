import {
    describe,
    expect,
    it,
} from "vitest";
import {
    computeLedgerTotals,
    computeQuickAmounts,
    computeWalletBalances,
    type ExpenseItem,
    foreignToTwd,
    getCurrencyConfig,
    ledgerTypeLabel,
    parseLegacyExpenses,
    roundQuickAmount,
    twdToForeign,
} from "./ledger";

function entry(type: string, amount: number, _id = `${type}-${amount}`): ExpenseItem {
    return { _id, name: "item", amount, type, date: "2026-06-11" };
}

describe("computeLedgerTotals", () => {
    it("splits Deposit-prefixed entries from spending and computes balance", () => {
        const totals = computeLedgerTotals([
            entry("Deposit-WOWPASS", 10000),
            entry("Deposit-Cash", 5000),
            entry("WOWPASS", 3000),
            entry("Cash", 2000),
        ]);
        expect(totals.totalDeposited).toBe(15000);
        expect(totals.totalSpent).toBe(5000);
        expect(totals.balance).toBe(10000);
    });

    it("counts any Deposit-<wallet> type as a deposit, including custom wallets", () => {
        const totals = computeLedgerTotals([
            entry("Deposit-T-money", 700),
            entry("T-money", 200),
        ]);
        expect(totals.totalDeposited).toBe(700);
        expect(totals.totalSpent).toBe(200);
    });

    it("returns zeros for an empty history", () => {
        expect(computeLedgerTotals([])).toEqual({
            totalDeposited: 0,
            totalSpent: 0,
            balance: 0,
        });
    });

    it("yields a negative balance when spending exceeds deposits", () => {
        const totals = computeLedgerTotals([
            entry("Deposit-Cash", 100),
            entry("Cash", 350),
        ]);
        expect(totals.balance).toBe(-250);
    });
});

describe("computeWalletBalances", () => {
    it("nets Deposit-<wallet> against <wallet> spending per wallet", () => {
        const balances = computeWalletBalances([
            entry("Deposit-WOWPASS", 10000),
            entry("WOWPASS", 3000),
            entry("Deposit-Cash", 5000),
            entry("Cash", 6000),
        ], ["WOWPASS"]);
        expect(balances).toEqual([
            { wallet: "WOWPASS", balance: 7000 },
            { wallet: "Cash", balance: -1000 },
        ]);
    });

    it("dedupes wallets that already include Cash", () => {
        const balances = computeWalletBalances([], ["WOWPASS", "Cash"]);
        expect(balances.map(b => b.wallet)).toEqual(["WOWPASS", "Cash"]);
    });

    it("always appends Cash when wallets are empty", () => {
        expect(computeWalletBalances([], [])).toEqual([{ wallet: "Cash", balance: 0 }]);
    });

    it("ignores entries belonging to wallets outside the list", () => {
        const balances = computeWalletBalances([
            entry("T-money", 500),
            entry("Deposit-T-money", 900),
        ], ["WOWPASS"]);
        expect(balances).toEqual([
            { wallet: "WOWPASS", balance: 0 },
            { wallet: "Cash", balance: 0 },
        ]);
    });
});

describe("getCurrencyConfig", () => {
    it("returns the JPY config", () => {
        expect(getCurrencyConfig("JPY")).toEqual({
            currencyCode: "JPY",
            currencyName: "日圓",
            currencySymbol: "¥",
        });
    });

    it("returns the KRW config", () => {
        expect(getCurrencyConfig("KRW")).toEqual({
            currencyCode: "KRW",
            currencyName: "韓元",
            currencySymbol: "₩",
        });
    });

    it("returns the TWD config", () => {
        expect(getCurrencyConfig("TWD")).toEqual({
            currencyCode: "TWD",
            currencyName: "台幣",
            currencySymbol: "NT$",
        });
    });

    it("returns the USD config", () => {
        expect(getCurrencyConfig("USD")).toEqual({
            currencyCode: "USD",
            currencyName: "美元",
            currencySymbol: "$",
        });
    });

    it("falls back to the raw code with a $ symbol", () => {
        expect(getCurrencyConfig("EUR")).toEqual({
            currencyCode: "EUR",
            currencyName: "EUR",
            currencySymbol: "$",
        });
    });
});

describe("roundQuickAmount", () => {
    it("keeps one decimal below 1", () => {
        expect(roundQuickAmount(0.26)).toBe(0.3);
        expect(roundQuickAmount(0.04)).toBe(0);
    });

    it("rounds to integers from 1 up to 5", () => {
        expect(roundQuickAmount(1)).toBe(1);
        expect(roundQuickAmount(2.5)).toBe(3);
        expect(roundQuickAmount(4.4)).toBe(4);
    });

    it("rounds to 5s from 5 up to 50", () => {
        expect(roundQuickAmount(5)).toBe(5);
        expect(roundQuickAmount(7)).toBe(5);
        expect(roundQuickAmount(8)).toBe(10);
        expect(roundQuickAmount(47)).toBe(45);
    });

    it("rounds to 10s from 50 up to 100", () => {
        expect(roundQuickAmount(50)).toBe(50);
        expect(roundQuickAmount(54)).toBe(50);
        expect(roundQuickAmount(55)).toBe(60);
        expect(roundQuickAmount(99)).toBe(100);
    });

    it("rounds to 50s from 100 up to 1000", () => {
        expect(roundQuickAmount(100)).toBe(100);
        expect(roundQuickAmount(124)).toBe(100);
        expect(roundQuickAmount(125)).toBe(150);
        expect(roundQuickAmount(999)).toBe(1000);
    });

    it("rounds to 500s from 1000 up to 10000", () => {
        expect(roundQuickAmount(1000)).toBe(1000);
        expect(roundQuickAmount(1249)).toBe(1000);
        expect(roundQuickAmount(1250)).toBe(1500);
        expect(roundQuickAmount(9999)).toBe(10000);
    });

    it("rounds to 5000s from 10000 up", () => {
        expect(roundQuickAmount(10000)).toBe(10000);
        expect(roundQuickAmount(12499)).toBe(10000);
        expect(roundQuickAmount(12500)).toBe(15000);
        expect(roundQuickAmount(82000)).toBe(80000);
    });
});

describe("computeQuickAmounts", () => {
    it("uses the fixed TWD ladder for TWD", () => {
        expect(computeQuickAmounts("TWD", 1)).toEqual([100, 200, 500, 1000, 2000, 5000]);
    });

    it("falls back to the TWD ladder when the rate is not positive", () => {
        expect(computeQuickAmounts("KRW", 0)).toEqual([100, 200, 500, 1000, 2000, 5000]);
        expect(computeQuickAmounts("JPY", -1)).toEqual([100, 200, 500, 1000, 2000, 5000]);
    });

    it("converts the TWD price points at a KRW-like rate", () => {
        expect(computeQuickAmounts("KRW", 41)).toEqual([2000, 4000, 10000, 20000, 40000, 80000]);
    });

    it("converts the TWD price points at a JPY-like rate", () => {
        expect(computeQuickAmounts("JPY", 4.5)).toEqual([250, 450, 1000, 2500, 4500, 9000]);
    });

    it("dedupes amounts that round to the same value", () => {
        expect(computeQuickAmounts("XYZ", 0.0004)).toEqual([0, 0.1, 0.2, 0.4, 0.8]);
    });
});

describe("currency conversion math", () => {
    it("foreignToTwd divides by the rate and rounds", () => {
        expect(foreignToTwd("1000", 4.5)).toBe("222"); // 222.22…
        expect(foreignToTwd("225", 4.5)).toBe("50");
    });

    it("foreignToTwd rounds .5 up", () => {
        expect(foreignToTwd("9", 2)).toBe("5"); // 4.5
    });

    it("twdToForeign multiplies by the rate and rounds", () => {
        expect(twdToForeign("100", 4.55)).toBe("455");
        expect(twdToForeign("33", 4.5)).toBe("149"); // 148.5
    });

    it("treats unparsable input as 0", () => {
        expect(foreignToTwd("", 4.5)).toBe("0");
        expect(twdToForeign("abc", 2)).toBe("0");
    });

    it("rounds decimals at a 1:1 rate", () => {
        expect(foreignToTwd("1234.4", 1)).toBe("1234");
        expect(twdToForeign("1234.6", 1)).toBe("1235");
    });
});

describe("ledgerTypeLabel", () => {
    it("maps the Deposit-prefix convention to zh-TW labels", () => {
        expect(ledgerTypeLabel("Cash")).toBe("現金支付");
        expect(ledgerTypeLabel("Deposit-Cash")).toBe("現金兌換");
        expect(ledgerTypeLabel("Deposit-WOWPASS")).toBe("WOWPASS 加值");
        expect(ledgerTypeLabel("Suica")).toBe("Suica 支付");
        expect(ledgerTypeLabel("")).toBe("");
    });
});

describe("parseLegacyExpenses", () => {
    const TODAY = "2026-06-18";
    let n = 0;
    const makeId = () => `id-${n++}`;

    it("coerces well-formed legacy records and assigns ids", () => {
        const out = parseLegacyExpenses(
            [{ name: "拉麵", amount: 980, type: "Cash", date: "2026-06-11" }],
            TODAY,
            () => "fixed",
        );
        expect(out).toEqual([{ name: "拉麵", amount: 980, type: "Cash", date: "2026-06-11", _id: "fixed" }]);
    });

    it("returns [] for a non-array (corrupt or absent payload)", () => {
        expect(parseLegacyExpenses(null, TODAY, makeId)).toEqual([]);
        expect(parseLegacyExpenses({ not: "an array" }, TODAY, makeId)).toEqual([]);
        expect(parseLegacyExpenses("[]", TODAY, makeId)).toEqual([]);
    });

    it("skips non-object entries but keeps valid ones", () => {
        const out = parseLegacyExpenses([null, 42, { amount: 5 }], TODAY, () => "x");
        expect(out).toEqual([{ name: "", amount: 5, type: "Cash", date: TODAY, _id: "x" }]);
    });

    it("falls back per field when the stored shape is wrong", () => {
        const out = parseLegacyExpenses(
            [{ name: 123, amount: "lots", type: 9, date: 0 }],
            TODAY,
            () => "x",
        );
        expect(out).toEqual([{ name: "", amount: 0, type: "Cash", date: TODAY, _id: "x" }]);
    });
});
