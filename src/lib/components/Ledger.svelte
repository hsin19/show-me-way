<script lang="ts">
import {
    ArrowLeftRight,
    Banknote,
    Calculator,
    CreditCard,
    Plus,
    Trash2,
    Wallet,
} from "@lucide/svelte";
import {
    onMount,
    untrack,
} from "svelte";
import { loadExchangeRates } from "../exchange";

interface ExpenseItem {
    id: string;
    name: string;
    amount: number;
    type: string; // WOWPASS | Cash | Deposit-WOWPASS | Deposit-Cash
    date: string;
}

interface Props {
    currency?: string;
    wallets?: string[];
    onAddWallet?: (name: string) => void;
    onToast: (msg: string) => void;
}

let { currency, wallets = [], onAddWallet, onToast }: Props = $props();

// Resolve active currency code, defaulting directly to TWD if not specified
const activeCurrency = $derived.by(() => {
    if (currency) return currency.toUpperCase();
    return "TWD";
});

// Resolve default wallets based on active currency
const defaultWallets = $derived.by(() => {
    switch (activeCurrency) {
        case "JPY":
            return ["Suica"];
        case "KRW":
            return ["WOWPASS", "T-money"];
        case "TWD":
            return ["信用卡"];
        default:
            return [];
    }
});

// Final wallets list is the combination of prop wallets or defaults
const activeWallets = $derived(wallets.length > 0 ? wallets : defaultWallets);

// Localized config based on active currency
const localConfig = $derived.by(() => {
    const code = activeCurrency;
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
});

// Currency States
let exchangeRate = $state(1.0);
let foreignValue = $state("1000");
let twdValue = $state("");

// Ledger States
let expenseHistory = $state<ExpenseItem[]>([]);
let expenseName = $state("");
let expenseAmount = $state("");
let expenseType = $state("Cash");
let newWalletName = $state("");

// Derived values
let totalDeposited = $derived(
    expenseHistory
        .filter(item => item.type.startsWith("Deposit"))
        .reduce((sum, item) => sum + item.amount, 0),
);
let totalSpent = $derived(
    expenseHistory
        .filter(item => !item.type.startsWith("Deposit"))
        .reduce((sum, item) => sum + item.amount, 0),
);
let balance = $derived(totalDeposited - totalSpent);

// Dynamically compute quickAmounts based on TWD values and exchange rate
const quickAmounts = $derived.by(() => {
    if (activeCurrency === "TWD" || exchangeRate <= 0) {
        return [100, 200, 500, 1000, 2000, 5000];
    }
    const rawAmounts = [50, 100, 250, 500, 1000, 2000].map(twd => twd * exchangeRate);
    const rounded = rawAmounts.map(val => {
        if (val < 1) return parseFloat(val.toFixed(1));
        if (val < 5) return Math.round(val);
        if (val < 50) return Math.round(val / 5) * 5;
        if (val < 100) return Math.round(val / 10) * 10;
        if (val < 1000) return Math.round(val / 50) * 50;
        if (val < 10000) return Math.round(val / 500) * 500;
        return Math.round(val / 5000) * 5000;
    });
    return [...new Set(rounded)];
});

function formatQuickAmount(amount: number): string {
    const symbol = localConfig.currencySymbol;
    if (activeCurrency === "TWD") return `$${amount}`;
    return `${symbol}${amount.toLocaleString()}`;
}

onMount(() => {
    // Load ledger (start empty; user adds their own deposits/expenses)
    try {
        const savedExpenses = localStorage.getItem("ledger_expenses");
        if (savedExpenses) {
            expenseHistory = JSON.parse(savedExpenses);
        }
    } catch {
        expenseHistory = [];
    }
});

// Sync default expenseType when activeWallets changes
$effect(() => {
    if (activeWallets.length > 0) {
        if (!activeWallets.includes(expenseType) && !expenseType.startsWith("Deposit-") && expenseType !== "Cash") {
            expenseType = activeWallets[0];
        }
    } else {
        expenseType = "Cash";
    }
});

// Keep exchange rate and initial values updated when activeCurrency changes.
// `untrack` keeps `activeCurrency` as this effect's ONLY dependency: the body
// reads `exchangeRate` and (via `convert`) the bound input values, which would
// otherwise re-run it on every keystroke — re-reading localStorage and rounding
// the user's typed value away. (A writable-$derived rewrite reintroduces that
// overwrite bug; don't switch to it.)
let lastCurrency = "";
$effect(() => {
    const currency = activeCurrency;
    untrack(() => {
        const rateKey = `exchange_rate_${currency}`;
        const savedRate = localStorage.getItem(rateKey);
        if (savedRate) {
            exchangeRate = parseFloat(savedRate);
        } else {
            exchangeRate = currency === "TWD" ? 1.0 : 0.0;
        }

        if (currency !== lastCurrency) {
            foreignValue = currency === "TWD" ? "1000" : (exchangeRate > 0 ? Math.round(100 * exchangeRate).toString() : "100");
            lastCurrency = currency;
        }
        convert("foreign");

        // Fetch live rate from network/cache (TWD as base currency). The
        // callback sticks to the captured `currency` so a rate that resolves
        // after another currency switch can't be written under the wrong key.
        if (currency !== "TWD") {
            loadExchangeRates("TWD", data => {
                const ratesRecord = data["twd"] as Record<string, number> | undefined;
                const rate = ratesRecord?.[currency.toLowerCase()];
                if (!rate || typeof rate !== "number") return;
                const fetchedRate = parseFloat(rate.toFixed(4));
                localStorage.setItem(rateKey, fetchedRate.toString());
                // A late callback after another currency switch must not
                // clobber the live inputs — persisting its own key is enough.
                if (currency !== activeCurrency) return;
                const prevRate = exchangeRate;
                exchangeRate = fetchedRate;
                // If the previous rate was unset, reinitialize the default input value
                if (prevRate === 0 && foreignValue === "100") {
                    foreignValue = Math.round(100 * exchangeRate).toString();
                    convert("foreign");
                } else {
                    convert("rate");
                }
            });
        } else {
            exchangeRate = 1.0;
            convert("rate");
        }
    });
});

function saveLedger() {
    localStorage.setItem("ledger_expenses", JSON.stringify(expenseHistory));
}

// Currency Conversion
function convert(source: "foreign" | "twd" | "rate") {
    if (source === "rate") {
        localStorage.setItem(`exchange_rate_${activeCurrency}`, exchangeRate.toString());
    }

    if (source === "foreign" || source === "rate") {
        const foreign = parseFloat(foreignValue) || 0;
        twdValue = Math.round(foreign / exchangeRate).toString();
    } else {
        const twd = parseFloat(twdValue) || 0;
        foreignValue = Math.round(twd * exchangeRate).toString();
    }
}

function setQuickForeign(amount: number) {
    foreignValue = amount.toString();
    convert("foreign");
}

function swapCurrency() {
    const temp = foreignValue;
    foreignValue = twdValue;
    twdValue = temp;
    onToast("已切換數值");
}

// Ledger Actions
function addExpense() {
    const name = expenseName.trim();
    const amount = parseInt(expenseAmount) || 0;

    if (!name || amount <= 0) {
        onToast("請輸入項目與大於 0 的金額");
        return;
    }

    const newItem: ExpenseItem = {
        id: Date.now().toString(),
        name,
        amount,
        type: expenseType,
        date: new Date().toLocaleDateString(),
    };

    expenseHistory = [newItem, ...expenseHistory];
    saveLedger();

    expenseName = "";
    expenseAmount = "";
    onToast("記帳成功");
}

function deleteExpense(id: string) {
    expenseHistory = expenseHistory.filter(item => item.id !== id);
    saveLedger();
    onToast("紀錄已刪除");
}

function resetBudget() {
    if (confirm("確定要清除所有記帳紀錄與加值金額嗎？")) {
        expenseHistory = [];
        saveLedger();
        onToast("已全部重置");
    }
}

function handleAddWallet() {
    const name = newWalletName.trim();
    if (!name) return;
    if (activeWallets.includes(name) || name === "Cash") {
        onToast("錢包或卡片名稱已存在");
        return;
    }
    if (onAddWallet) {
        onAddWallet(name);
        newWalletName = "";
        onToast(`已新增錢包：${name}`);
        // Auto select the newly added wallet
        expenseType = name;
    } else {
        onToast("無法在目前行程儲存自訂錢包");
    }
}
</script>

<!-- Currency Converter -->
<div class="glass-panel rounded-2xl p-5 mb-5">
    <h3 class="text-base font-bold text-text-primary mb-4 flex items-center gap-2">
        <Calculator size={18} class="text-neon-blue" aria-hidden="true" />
        {activeCurrency === "TWD" ? "台幣計算機" : `${localConfig.currencyName}/台幣 雙向換算`}
    </h3>
    <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
            <label for="foreign-input" class="text-xs font-semibold text-text-secondary">{localConfig.currencyCode} {localConfig.currencyName} {localConfig.currencySymbol}</label>
            <div class="relative flex items-center">
                <input
                    type="number"
                    inputmode="decimal"
                    id="foreign-input"
                    bind:value={foreignValue}
                    oninput={() => convert("foreign")}
                    placeholder="輸入{localConfig.currencyName}"
                    class="w-full bg-black/25 border border-card-border rounded-xl py-3 pl-4 pr-10 text-text-primary font-bold text-base outline-none focus:border-neon-blue transition"
                >
                <span class="absolute right-4 font-bold text-text-secondary">{localConfig.currencySymbol}</span>
            </div>
        </div>

        {#if activeCurrency !== "TWD"}
            <div class="flex justify-center -my-1">
                <button
                    onclick={swapCurrency}
                    aria-label="互換上下金額"
                    class="w-9 h-9 rounded-full bg-white/5 border border-card-border flex items-center justify-center text-text-primary hover:bg-neon-blue hover:text-black cursor-pointer transition active:scale-90"
                >
                    <ArrowLeftRight size={16} aria-hidden="true" />
                </button>
            </div>

            <div class="flex flex-col gap-1.5">
                <label for="twd-input" class="text-xs font-semibold text-text-secondary">TWD 台幣 NT$</label>
                <div class="relative flex items-center">
                    <input
                        type="number"
                        inputmode="decimal"
                        id="twd-input"
                        bind:value={twdValue}
                        oninput={() => convert("twd")}
                        placeholder="輸入台幣"
                        class="w-full bg-black/25 border border-card-border rounded-xl py-3 pl-4 pr-10 text-text-primary font-bold text-base outline-none focus:border-neon-blue transition"
                    >
                    <span class="absolute right-4 font-bold text-text-secondary">$</span>
                </div>
            </div>
        {/if}
    </div>

    <!-- Exchange Rate Setting -->
    {#if activeCurrency !== "TWD"}
        <div class="flex items-center justify-end gap-2 text-[11px] text-text-muted mt-4">
            <span>匯率設定：1 TWD = </span>
            <input
                type="number"
                inputmode="decimal"
                aria-label="匯率（1 TWD 兌換 {localConfig.currencyCode}）"
                bind:value={exchangeRate}
                oninput={() => convert("rate")}
                step="0.0001"
                class="w-20 bg-transparent border-0 border-b border-dashed border-text-muted text-center text-text-secondary font-bold outline-none"
            >
            <span>{localConfig.currencyCode}</span>
        </div>
    {/if}

    <!-- Quick Buttons -->
    <div class="flex flex-wrap gap-1.5 mt-3">
        {#each quickAmounts as amount (amount)}
            <button
                onclick={() => setQuickForeign(amount)}
                class="bg-white/3 border border-card-border text-text-secondary py-1.5 px-3 rounded-lg text-xs font-semibold hover:bg-neon-blue hover:text-black transition cursor-pointer"
            >
                {formatQuickAmount(amount)}
            </button>
        {/each}
    </div>
</div>

<!-- Ledger Management -->
<div class="glass-panel rounded-2xl p-5 mb-5">
    <div class="flex justify-between items-center mb-4">
        <h3 class="text-base font-bold text-text-primary flex items-center gap-2">
            <Wallet size={18} class="text-neon-blue" aria-hidden="true" />記帳與餘額管理
        </h3>
        <button onclick={resetBudget} class="text-xs text-text-muted hover:text-neon-pink font-semibold cursor-pointer">重設</button>
    </div>

    <!-- Stats Dashboard -->
    <div class="grid grid-cols-3 gap-2 mb-5">
        <div class="bg-black/20 border border-white/2 rounded-xl p-2.5 flex flex-col items-center gap-0.5">
            <span class="text-[11px] text-text-secondary font-medium">儲值總額</span>
            <span class="text-xs font-extrabold text-accent-green tabular-nums">{localConfig.currencySymbol}{totalDeposited.toLocaleString()}</span>
        </div>
        <div class="bg-black/20 border border-white/2 rounded-xl p-2.5 flex flex-col items-center gap-0.5">
            <span class="text-[11px] text-text-secondary font-medium">已花費</span>
            <span class="text-xs font-extrabold text-neon-pink tabular-nums">{localConfig.currencySymbol}{totalSpent.toLocaleString()}</span>
        </div>
        <div class="bg-black/20 border border-white/2 rounded-xl p-2.5 flex flex-col items-center gap-0.5">
            <span class="text-[11px] text-text-secondary font-medium">剩餘餘額</span>
            <span class="text-xs font-extrabold text-neon-blue tabular-nums">{localConfig.currencySymbol}{balance.toLocaleString()}</span>
        </div>
    </div>

    <!-- Quick Add Form -->
    <div class="grid grid-cols-3 gap-2 mb-5">
        <input
            type="text"
            bind:value={expenseName}
            aria-label="消費項目名稱"
            autocomplete="off"
            placeholder="項目 (如: {activeCurrency === 'TWD' ? '午餐' : '拉麵'})"
            class="col-span-3 bg-black/25 border border-card-border rounded-xl p-2.5 text-xs text-text-primary font-semibold outline-none focus:border-neon-blue"
        >
        <input
            type="number"
            inputmode="numeric"
            bind:value={expenseAmount}
            aria-label="金額"
            placeholder="金額 ({localConfig.currencySymbol})"
            class="col-span-2 bg-black/25 border border-card-border rounded-xl p-2.5 text-xs text-text-primary font-semibold outline-none focus:border-neon-blue"
        >
        <select
            bind:value={expenseType}
            aria-label="支付方式"
            class="bg-black/25 border border-card-border rounded-xl p-2.5 text-xs text-text-primary font-semibold outline-none cursor-pointer"
        >
            <optgroup label="支出">
                {#each activeWallets as wallet (wallet)}
                    <option value={wallet}>{wallet} 支出</option>
                {/each}
                <option value="Cash">現金 支出</option>
            </optgroup>
            <optgroup label="儲值 / 兌換">
                {#each activeWallets as wallet (wallet)}
                    <option value="Deposit-{wallet}">{wallet} 加值 ＋</option>
                {/each}
                <option value="Deposit-Cash">現金 兌換 ＋</option>
            </optgroup>
        </select>

        <!-- Add Custom Wallet Sub-row -->
        <div class="col-span-3 flex items-center gap-1.5 mt-1">
            <input
                type="text"
                bind:value={newWalletName}
                aria-label="新增自訂卡片或錢包名稱"
                autocomplete="off"
                placeholder="新增自訂卡片/錢包 (如: ICOCA, 悠遊卡)"
                class="flex-1 bg-black/40 border border-card-border rounded-xl px-3 py-1.5 text-[11px] text-text-primary outline-none focus:border-neon-blue transition"
            >
            <button
                type="button"
                onclick={handleAddWallet}
                class="bg-white/5 border border-card-border text-text-secondary hover:bg-neon-blue hover:text-black font-bold py-1.5 px-3 rounded-xl text-[10px] transition active:scale-[0.96] cursor-pointer"
            >
                新增
            </button>
        </div>

        <button
            onclick={addExpense}
            class="col-span-3 bg-gradient-to-r from-neon-blue to-neon-purple text-black font-extrabold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1 transition active:scale-[0.98] cursor-pointer shadow-[0_0_15px_rgba(0,240,255,0.2)] mt-2"
        >
            <Plus size={14} class="stroke-[3]" aria-hidden="true" />
            記一筆
        </button>
    </div>

    <!-- History List -->
    <div>
        <h4 class="text-xs text-text-secondary font-semibold border-b border-white/5 pb-2 mb-2">消費紀錄</h4>
        <ul class="max-h-[160px] overflow-y-auto space-y-1 pr-1">
            {#each expenseHistory as item (item.id)}
                <li class="flex justify-between items-center text-xs py-2 border-b border-white/3 last:border-0">
                    <div class="flex flex-col">
                        <span class="font-bold text-text-primary">{item.name}</span>
                        <span class="text-[10px] text-text-muted flex items-center gap-1">
                            {#if item.type === "Cash" || item.type === "Deposit-Cash"}
                                <Banknote size={11} class="shrink-0" aria-hidden="true" />
                            {:else}
                                <CreditCard size={11} class="shrink-0" aria-hidden="true" />
                            {/if}
                            {
                                item.type.startsWith("Deposit")
                                ? (item.type === "Deposit-Cash" ? "現金兌換" : `${item.type.replace("Deposit-", "")} 加值`)
                                : (item.type === "Cash" ? "現金支付" : `${item.type} 支付`)
                            }
                        </span>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="font-bold tabular-nums {item.type.startsWith('Deposit') ? 'text-accent-green' : 'text-text-primary'}">
                            {item.type.startsWith("Deposit") ? "+" : "-"}{localConfig.currencySymbol}{item.amount.toLocaleString()}
                        </span>
                        <button
                            onclick={() => deleteExpense(item.id)}
                            class="text-text-muted hover:text-neon-pink cursor-pointer transition min-w-[44px] min-h-[44px] -my-2 flex items-center justify-center"
                            aria-label="刪除紀錄"
                            title="刪除"
                        >
                            <Trash2 size={14} aria-hidden="true" />
                        </button>
                    </div>
                </li>
            {:else}
                <li class="text-center text-xs text-text-muted py-4">無消費紀錄</li>
            {/each}
        </ul>
    </div>
</div>
