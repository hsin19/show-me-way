<script lang="ts">
import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
import Banknote from "@lucide/svelte/icons/banknote";
import Calculator from "@lucide/svelte/icons/calculator";
import CreditCard from "@lucide/svelte/icons/credit-card";
import Download from "@lucide/svelte/icons/download";
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
    formatAmount,
    getCurrencyConfig,
    isDeposit,
    ledgerTypeLabel,
    MANUAL_RATE_KEY_PREFIX,
    twdToForeign,
} from "../ledger";
import { showToast } from "../toast.svelte";
import { toLocalIsoDate } from "../utils";
import ConfirmBar from "./ConfirmBar.svelte";

interface Props {
    currency?: string;
    wallets?: string[];
    /** Owned by the parent and persisted in the itinerary YAML; this component only reads them. */
    expenses: ExpenseItem[];
    onAddWallet?: (name: string) => void;
    onAddExpense: (name: string, amount: number, type: string, date?: string) => void;
    onDeleteExpense: (id: string) => void;
    onReset: () => void;
    onExportCsv: () => void;
}

let { currency, wallets = [], expenses, onAddWallet, onAddExpense, onDeleteExpense, onReset, onExportCsv }: Props = $props();

const activeCurrency = $derived.by(() => {
    if (currency) return currency.toUpperCase();
    return "TWD";
});

const localConfig = $derived(getCurrencyConfig(activeCurrency));

const activeWallets = $derived(wallets.length > 0 ? wallets : localConfig.defaultWallets);

let exchangeRate = $state(1.0);
let foreignValue = $state("1000");
let twdValue = $state("");
let rateInfo = $state<{ date: string; offline: boolean; } | null>(null);

let expenseName = $state("");
let expenseAmount = $state("");
let expenseType = $state("Cash");
let expenseDate = $state(toLocalIsoDate(new Date()));
let newWalletName = $state("");

const totals = $derived(computeLedgerTotals(expenses));
const totalDeposited = $derived(totals.totalDeposited);
const totalSpent = $derived(totals.totalSpent);
const balance = $derived(totals.balance);

const walletBalances = $derived(computeWalletBalances(expenses, activeWallets));

const quickAmounts = $derived(computeQuickAmounts(activeCurrency, exchangeRate));

function formatQuickAmount(amount: number): string {
    // TWD quick chips keep the short `$100` form — `NT$` on six chips is noise.
    if (activeCurrency === "TWD") return `$${amount}`;
    return formatAmount(localConfig.currencySymbol, amount);
}

// A wallet that no longer exists must not stay selected — switching currency
// replaces the whole set.
$effect(() => {
    if (activeWallets.length > 0) {
        if (!activeWallets.includes(expenseType) && !isDeposit(expenseType) && expenseType !== "Cash") {
            expenseType = activeWallets[0];
        }
    } else {
        expenseType = "Cash";
    }
});

// `untrack` leaves `activeCurrency` as this effect's ONLY dependency. The body
// reads `exchangeRate` and, through `convert`, the bound inputs — tracked, it
// would re-run on every keystroke, re-read localStorage and round the number the
// user is still typing. A writable-`$derived` rewrite brings that bug back.
let lastCurrency = "";
$effect(() => {
    const currency = activeCurrency;
    untrack(() => {
        const rateKey = `${MANUAL_RATE_KEY_PREFIX}${currency}`;
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

        // The callback closes over the captured `currency`, so a rate resolving
        // after another switch cannot be written under the wrong key.
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
                // The "100" placeholder was only there because no rate was known
                // yet; now there is one, give it a meaningful default instead.
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

/** `source` is the field the user just touched; the other one is recomputed. */
function convert(source: "foreign" | "twd" | "rate") {
    if (source === "rate") {
        localStorage.setItem(`${MANUAL_RATE_KEY_PREFIX}${activeCurrency}`, exchangeRate.toString());
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
    showToast("已切換數值");
}

// The handlers below only validate and delegate: the records, their persistence
// and the undo toast all belong to App.svelte.
function addExpense() {
    const name = expenseName.trim();
    const amount = parseInt(expenseAmount) || 0;

    if (!name || amount <= 0) {
        showToast("請輸入項目與大於 0 的金額");
        return;
    }

    onAddExpense(name, amount, expenseType, expenseDate || undefined);
    expenseName = "";
    expenseAmount = "";
    // Back to today rather than keeping the picked day: a forgotten backfill
    // date would otherwise stamp every later record silently.
    expenseDate = toLocalIsoDate(new Date());
    showToast("記帳成功");
}

let confirmingReset = $state(false);

function handleResetBudget() {
    confirmingReset = false;
    onReset();
    showToast("已全部重置");
}

function handleAddWallet() {
    const name = newWalletName.trim();
    if (!name) return;
    if (activeWallets.includes(name) || name === "Cash") {
        showToast("錢包或卡片名稱已存在");
        return;
    }
    if (onAddWallet) {
        onAddWallet(name);
        newWalletName = "";
        showToast(`已新增錢包：${name}`);
        // You add a wallet because you are about to record against it.
        expenseType = name;
    } else {
        showToast("無法在目前行程儲存自訂錢包");
    }
}
</script>
<div class="panel rounded-2xl p-5 mb-5">
    <h3 class="text-base font-bold text-text-primary mb-4 flex items-center gap-2">
        <Calculator size={18} class="text-accent" aria-hidden="true" />
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
                    class="w-full bg-well border border-card-border rounded-xl py-3 pl-4 pr-10 text-text-primary font-bold text-base outline-none focus:border-accent transition"
                >
                <span class="absolute right-4 font-bold text-text-secondary">{localConfig.currencySymbol}</span>
            </div>
        </div>

        {#if activeCurrency !== "TWD"}
            <div class="flex justify-center -my-1">
                <button
                    onclick={swapCurrency}
                    aria-label="互換上下金額"
                    class="w-11 h-11 rounded-full bg-tint-2 border border-card-border flex items-center justify-center text-text-primary hover:bg-accent/15 hover:text-accent cursor-pointer transition active:scale-90"
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
                        class="w-full bg-well border border-card-border rounded-xl py-3 pl-4 pr-10 text-text-primary font-bold text-base outline-none focus:border-accent transition"
                    >
                    <span class="absolute right-4 font-bold text-text-secondary">$</span>
                </div>
            </div>
        {/if}
    </div>
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
                class="min-h-[44px] bg-tint-1 border border-card-border text-text-secondary px-3 rounded-lg text-xs font-semibold flex items-center hover:bg-accent/15 hover:text-accent transition cursor-pointer"
            >
                {formatQuickAmount(amount)}
            </button>
        {/each}
    </div>
</div>
<div class="panel rounded-2xl p-5 mb-5">
    <div class="flex justify-between items-center mb-4">
        <h3 class="text-base font-bold text-text-primary flex items-center gap-2">
            <Wallet size={18} class="text-accent" aria-hidden="true" />記帳與餘額管理
        </h3>
        {#if !confirmingReset}
            <button
                type="button"
                onclick={() => (confirmingReset = true)}
                class="min-w-[44px] min-h-[44px] -my-2.5 -mr-2.5 flex items-center justify-center text-xs text-text-muted hover:text-danger font-semibold cursor-pointer"
            >
                重設
            </button>
        {/if}
    </div>

    {#if confirmingReset}
        <div class="mb-4">
            <ConfirmBar
                message="確定要清除所有記帳紀錄與加值金額嗎？"
                confirmLabel="確定清除"
                onconfirm={handleResetBudget}
                oncancel={() => (confirmingReset = false)}
            />
        </div>
    {/if}
    <div class="grid grid-cols-3 gap-2 mb-2">
        <div class="bg-well border border-line-faint rounded-xl p-2.5 flex flex-col items-center gap-0.5">
            <span class="text-[11px] text-text-secondary font-medium">儲值總額</span>
            <span class="text-xs font-extrabold text-positive tabular-nums">{formatAmount(localConfig.currencySymbol, totalDeposited)}</span>
        </div>
        <div class="bg-well border border-line-faint rounded-xl p-2.5 flex flex-col items-center gap-0.5">
            <span class="text-[11px] text-text-secondary font-medium">已花費</span>
            <span class="text-xs font-extrabold text-danger tabular-nums">{formatAmount(localConfig.currencySymbol, totalSpent)}</span>
        </div>
        <div class="bg-well border border-line-faint rounded-xl p-2.5 flex flex-col items-center gap-0.5">
            <span class="text-[11px] text-text-secondary font-medium">剩餘餘額</span>
            <span class="text-xs font-extrabold text-accent tabular-nums">{formatAmount(localConfig.currencySymbol, balance)}</span>
        </div>
    </div>
    <div class="flex flex-wrap gap-2 mb-5">
        {#each walletBalances as wb (wb.wallet)}
            <div class="flex-1 basis-[30%] bg-well border border-line-faint rounded-xl p-2.5 flex flex-col items-center gap-0.5">
                <span class="text-[11px] text-text-secondary font-medium">{wb.wallet === "Cash" ? "現金" : wb.wallet} 餘額</span>
                <span class="text-xs font-extrabold tabular-nums {wb.balance < 0 ? 'text-danger' : 'text-accent'}">
                    {formatAmount(localConfig.currencySymbol, wb.balance)}
                </span>
            </div>
        {/each}
    </div>
    <div class="grid grid-cols-3 gap-2 mb-5">
        <input
            type="text"
            bind:value={expenseName}
            aria-label="消費項目名稱"
            autocomplete="off"
            placeholder="項目 (如: {activeCurrency === 'TWD' ? '午餐' : '拉麵'})"
            class="col-span-3 bg-well border border-card-border rounded-xl p-2.5 text-xs text-text-primary font-semibold outline-none focus:border-accent"
        >
        <!-- Editable so yesterday's forgotten expense can be backfilled with the
             right day instead of silently landing on today. -->
        <input
            type="date"
            bind:value={expenseDate}
            aria-label="消費日期"
            class="col-span-3 bg-well border border-card-border rounded-xl p-2.5 text-xs text-text-primary font-semibold outline-none focus:border-accent"
        >
        <input
            type="number"
            inputmode="numeric"
            bind:value={expenseAmount}
            aria-label="金額"
            placeholder="金額 ({localConfig.currencySymbol})"
            class="col-span-2 bg-well border border-card-border rounded-xl p-2.5 text-xs text-text-primary font-semibold outline-none focus:border-accent"
        >
        <select
            bind:value={expenseType}
            aria-label="支付方式"
            class="bg-well border border-card-border rounded-xl p-2.5 text-xs text-text-primary font-semibold outline-none cursor-pointer"
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
        <div class="col-span-3 flex items-center gap-1.5 mt-1">
            <input
                type="text"
                bind:value={newWalletName}
                aria-label="新增自訂卡片或錢包名稱"
                autocomplete="off"
                placeholder="新增自訂卡片/錢包 (如: ICOCA, 悠遊卡)"
                class="flex-1 bg-well-deep border border-card-border rounded-xl px-3 py-1.5 text-[11px] text-text-primary outline-none focus:border-accent transition"
            >
            <button
                type="button"
                onclick={handleAddWallet}
                class="min-w-[44px] min-h-[44px] bg-tint-2 border border-card-border text-text-secondary hover:bg-accent/15 hover:text-accent font-bold px-3 rounded-xl text-[11px] flex items-center justify-center transition active:scale-[0.96] cursor-pointer"
            >
                新增
            </button>
        </div>

        <button
            onclick={addExpense}
            class="col-span-3 bg-accent text-accent-contrast font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1 transition active:scale-[0.98] cursor-pointer mt-2"
        >
            <Plus size={14} class="stroke-[3]" aria-hidden="true" />
            記一筆
        </button>
    </div>
    <div>
        <div class="flex justify-between items-center border-b border-line pb-2 mb-2">
            <h4 class="text-xs text-text-secondary font-semibold">消費紀錄</h4>
            <button
                onclick={onExportCsv}
                class="min-h-[44px] -my-3 flex items-center gap-1 text-[11px] text-text-muted hover:text-accent font-semibold cursor-pointer"
            >
                <Download size={12} aria-hidden="true" /> 匯出 CSV
            </button>
        </div>
        <ul class="max-h-[160px] overflow-y-auto space-y-1 pr-1">
            {#each expenses as item (item._id)}
                <li class="flex justify-between items-center text-xs py-2 border-b border-line-faint last:border-0">
                    <div class="flex flex-col">
                        <span class="font-bold text-text-primary">{item.name}</span>
                        <span class="text-[10px] text-text-muted flex items-center gap-1">
                            {#if item.type === "Cash" || item.type === "Deposit-Cash"}
                                <Banknote size={11} class="shrink-0" aria-hidden="true" />
                            {:else}
                                <CreditCard size={11} class="shrink-0" aria-hidden="true" />
                            {/if}
                            <!-- Visible date is what makes a wrong backfill day noticeable
                                 at all — it otherwise only surfaces in the CSV export. -->
                            {#if item.date}{item.date.slice(5).replace("-", "/")}・{/if}{ledgerTypeLabel(item.type)}
                        </span>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="font-bold tabular-nums {isDeposit(item.type) ? 'text-positive' : 'text-text-primary'}">
                            {isDeposit(item.type) ? "+" : "-"}{formatAmount(localConfig.currencySymbol, item.amount)}
                        </span>
                        <button
                            onclick={() => onDeleteExpense(item._id ?? "")}
                            class="text-text-muted hover:text-danger cursor-pointer transition min-w-[44px] min-h-[44px] -my-2 flex items-center justify-center"
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
