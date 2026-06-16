<script lang="ts">
import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
import Banknote from "@lucide/svelte/icons/banknote";
import Calculator from "@lucide/svelte/icons/calculator";
import CreditCard from "@lucide/svelte/icons/credit-card";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import Wallet from "@lucide/svelte/icons/wallet";
import { untrack } from "svelte";
import {
    EXCHANGE_CACHE_TTL,
    loadExchangeRates,
} from "../exchange";
import {
    computeLedgerTotals,
    computeQuickAmounts,
    computeWalletBalances,
    type ExpenseItem,
    foreignToTwd,
    getCurrencyConfig,
    ledgerTypeLabel,
    twdToForeign,
} from "../ledger";
import type { ToastInput } from "../toast";
import { toLocalIsoDate } from "../utils";

interface Props {
    currency?: string;
    wallets?: string[];
    onAddWallet?: (name: string) => void;
    onToast: (toast: ToastInput) => void;
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
const localConfig = $derived(getCurrencyConfig(activeCurrency));

// Currency States
let exchangeRate = $state(1.0);
let foreignValue = $state("1000");
let twdValue = $state("");
let rateInfo = $state<{ date: string; offline: boolean; } | null>(null);

// Ledger States
function loadSavedExpenses(): ExpenseItem[] {
    try {
        const saved = localStorage.getItem("ledger_expenses");
        return saved ? JSON.parse(saved) as ExpenseItem[] : [];
    } catch (e) {
        console.warn("Failed to read saved expenses", e);
        return [];
    }
}

// Initialized at declaration (not onMount) so the first render never flashes
// an empty list. $state.raw: never mutate in place — always reassign a new array.
let expenseHistory = $state.raw<ExpenseItem[]>(loadSavedExpenses());

// The undo toast outlives this component (tab switch unmounts it) — its
// restore writes localStorage and pings this event so the live instance,
// whichever one it is, refreshes its view.
const LEDGER_SYNC_EVENT = "showmeway:ledger-sync";
$effect(() => {
    const reload = () => (expenseHistory = loadSavedExpenses());
    window.addEventListener(LEDGER_SYNC_EVENT, reload);
    return () => window.removeEventListener(LEDGER_SYNC_EVENT, reload);
});
let expenseName = $state("");
let expenseAmount = $state("");
let expenseType = $state("Cash");
let newWalletName = $state("");

// Derived values (pure math lives in src/lib/ledger.ts)
const totals = $derived(computeLedgerTotals(expenseHistory));
const totalDeposited = $derived(totals.totalDeposited);
const totalSpent = $derived(totals.totalSpent);
const balance = $derived(totals.balance);

const walletBalances = $derived(computeWalletBalances(expenseHistory, activeWallets));

const quickAmounts = $derived(computeQuickAmounts(activeCurrency, exchangeRate));

function formatQuickAmount(amount: number): string {
    const symbol = localConfig.currencySymbol;
    if (activeCurrency === "TWD") return `$${amount}`;
    return `${symbol}${amount.toLocaleString()}`;
}

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
            rateInfo = null;
            loadExchangeRates("TWD", (data, meta) => {
                const ratesRecord = data["twd"] as Record<string, number> | undefined;
                const rate = ratesRecord?.[currency.toLowerCase()];
                if (!rate || typeof rate !== "number") return;
                const fetchedRate = parseFloat(rate.toFixed(4));
                localStorage.setItem(rateKey, fetchedRate.toString());
                // A late callback after another currency switch must not
                // clobber the live inputs — persisting its own key is enough.
                if (currency !== activeCurrency) return;
                rateInfo = {
                    date: data.date,
                    // Must exceed the TTL: a routine stale replay (anything past
                    // 12h) would otherwise flash the badge until the refresh lands.
                    offline: meta.fromCache && Date.now() - meta.fetchedAt >= EXCHANGE_CACHE_TTL * 2,
                };
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
            rateInfo = null;
            exchangeRate = 1.0;
            convert("rate");
        }
    });
});

function saveLedger() {
    // The only user-data write that wasn't failure-guarded — on a trip a quota
    // or private-mode error would otherwise lose the day's expenses silently.
    try {
        localStorage.setItem("ledger_expenses", JSON.stringify(expenseHistory));
    } catch (e) {
        console.error("Failed to save expenses", e);
        onToast("記帳儲存失敗，請稍後再試");
    }
}

// Currency Conversion (math in src/lib/ledger.ts; persistence stays here)
function convert(source: "foreign" | "twd" | "rate") {
    if (source === "rate") {
        localStorage.setItem(`exchange_rate_${activeCurrency}`, exchangeRate.toString());
    }

    if (source === "foreign" || source === "rate") {
        twdValue = foreignToTwd(foreignValue, exchangeRate);
    } else {
        foreignValue = twdToForeign(twdValue, exchangeRate);
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
        // Local YYYY-MM-DD (project date convention) — sortable in CSV export;
        // not shown in the UI, so older toLocaleDateString records are untouched.
        date: toLocalIsoDate(new Date()),
    };

    expenseHistory = [newItem, ...expenseHistory];
    saveLedger();

    expenseName = "";
    expenseAmount = "";
    onToast("記帳成功");
}

function deleteExpense(id: string) {
    const index = expenseHistory.findIndex(item => item.id === id);
    if (index < 0) return;
    const removed = { ...expenseHistory[index] };
    expenseHistory = expenseHistory.filter(item => item.id !== id);
    saveLedger();
    onToast({
        message: "紀錄已刪除",
        actionLabel: "復原",
        onAction: () => {
            // Restore via localStorage, not captured state — this closure may
            // belong to an unmounted instance (tab switch within the undo
            // window). Reinsert at the original position, clamped.
            const next = loadSavedExpenses();
            next.splice(Math.min(index, next.length), 0, removed);
            localStorage.setItem("ledger_expenses", JSON.stringify(next));
            window.dispatchEvent(new Event(LEDGER_SYNC_EVENT));
        },
    });
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
                    class="w-11 h-11 rounded-full bg-white/5 border border-card-border flex items-center justify-center text-text-primary hover:bg-neon-blue hover:text-black cursor-pointer transition active:scale-90"
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
        {#if rateInfo}
            <div class="flex items-center justify-end gap-1.5 text-[10px] text-text-secondary mt-1.5">
                <span>匯率日期 {rateInfo.date}</span>
                {#if rateInfo.offline}
                    <span class="border border-card-border rounded px-1 py-px text-text-muted">離線快取</span>
                {/if}
            </div>
        {/if}
    {/if}

    <!-- Quick Buttons: real 44px height, no negative margins — wrapped rows sit
         only 6px apart, so stretched hot zones would overlap across rows. -->
    <div class="flex flex-wrap gap-1.5 mt-3">
        {#each quickAmounts as amount (amount)}
            <button
                onclick={() => setQuickForeign(amount)}
                class="min-h-[44px] bg-white/3 border border-card-border text-text-secondary px-3 rounded-lg text-xs font-semibold flex items-center hover:bg-neon-blue hover:text-black transition cursor-pointer"
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
        <button
            onclick={resetBudget}
            class="min-w-[44px] min-h-[44px] -my-2.5 -mr-2.5 flex items-center justify-center text-xs text-text-muted hover:text-neon-pink font-semibold cursor-pointer"
        >
            重設
        </button>
    </div>

    <!-- Stats Dashboard -->
    <div class="grid grid-cols-3 gap-2 mb-2">
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

    <!-- Per-wallet Balances -->
    <div class="flex flex-wrap gap-2 mb-5">
        {#each walletBalances as wb (wb.wallet)}
            <div class="flex-1 basis-[30%] bg-black/20 border border-white/2 rounded-xl p-2.5 flex flex-col items-center gap-0.5">
                <span class="text-[11px] text-text-secondary font-medium">{wb.wallet === "Cash" ? "現金" : wb.wallet} 餘額</span>
                <span class="text-xs font-extrabold tabular-nums {wb.balance < 0 ? 'text-neon-pink' : 'text-neon-blue'}">
                    {wb.balance < 0 ? "-" : ""}{localConfig.currencySymbol}{Math.abs(wb.balance).toLocaleString()}
                </span>
            </div>
        {/each}
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
                class="min-w-[44px] min-h-[44px] bg-white/5 border border-card-border text-text-secondary hover:bg-neon-blue hover:text-black font-bold px-3 rounded-xl text-[10px] flex items-center justify-center transition active:scale-[0.96] cursor-pointer"
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
                            {ledgerTypeLabel(item.type)}
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
