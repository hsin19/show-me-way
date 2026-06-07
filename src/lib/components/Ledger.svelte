<script lang="ts">
import {
    ArrowLeftRight,
    Plus,
    Trash2,
} from "@lucide/svelte";
import { onMount } from "svelte";

interface ExpenseItem {
    id: string;
    name: string;
    amount: number;
    type: string; // WOWPASS | Cash | Deposit-WOWPASS | Deposit-Cash
    date: string;
}

interface Props {
    onToast: (msg: string) => void;
}

let { onToast }: Props = $props();

// Currency States
let exchangeRate = $state(42.5);
let krwValue = $state("10000");
let twdValue = $state("");

// Ledger States
let expenseHistory = $state<ExpenseItem[]>([]);
let expenseName = $state("");
let expenseAmount = $state("");
let expenseType = $state("WOWPASS");

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

onMount(() => {
    // Load exchange rate
    const savedRate = localStorage.getItem("exchange_rate");
    if (savedRate) {
        exchangeRate = parseFloat(savedRate);
    }

    // Load ledger (start empty; user adds their own deposits/expenses)
    try {
        const savedExpenses = localStorage.getItem("ledger_expenses");
        if (savedExpenses) {
            expenseHistory = JSON.parse(savedExpenses);
        }
    } catch {
        expenseHistory = [];
    }

    // Run initial conversion
    convert("krw");
});

function saveLedger() {
    localStorage.setItem("ledger_expenses", JSON.stringify(expenseHistory));
}

// Currency Conversion
function convert(source: "krw" | "twd" | "rate") {
    // Only persist the rate when it actually changes, not on every amount keystroke.
    if (source === "rate") {
        localStorage.setItem("exchange_rate", exchangeRate.toString());
    }

    if (source === "krw" || source === "rate") {
        const krw = parseFloat(krwValue) || 0;
        twdValue = Math.round(krw / exchangeRate).toString();
    } else {
        const twd = parseFloat(twdValue) || 0;
        krwValue = Math.round(twd * exchangeRate).toString();
    }
}

function setQuickKRW(amount: number) {
    krwValue = amount.toString();
    convert("krw");
}

function swapCurrency() {
    const temp = krwValue;
    krwValue = twdValue;
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

    // Type comes directly from the dropdown (expense vs. deposit chosen explicitly)
    const newItem: ExpenseItem = {
        id: Date.now().toString(),
        name,
        amount,
        type: expenseType,
        date: new Date().toLocaleDateString(),
    };

    expenseHistory = [newItem, ...expenseHistory];
    saveLedger();

    // Clear Inputs
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
</script>

<!-- Currency Converter -->
<div class="glass-panel rounded-2xl p-5 mb-5">
    <h3 class="text-base font-bold text-text-primary mb-4">💰 韓元/台幣 雙向換算</h3>
    <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
            <label for="krw-input" class="text-xs font-semibold text-text-secondary">KRW 韓元 ₩</label>
            <div class="relative flex items-center">
                <input
                    type="number"
                    id="krw-input"
                    bind:value={krwValue}
                    oninput={() => convert("krw")}
                    placeholder="輸入韓元"
                    class="w-full bg-black/25 border border-card-border rounded-xl py-3 pl-4 pr-10 text-text-primary font-bold text-base outline-none focus:border-neon-blue transition"
                >
                <span class="absolute right-4 font-bold text-text-secondary">₩</span>
            </div>
        </div>

        <div class="flex justify-center -my-1">
            <button
                onclick={swapCurrency}
                class="w-9 h-9 rounded-full bg-white/5 border border-card-border flex items-center justify-center text-text-primary hover:bg-neon-blue hover:text-black cursor-pointer transition active:scale-90"
            >
                <ArrowLeftRight size={16} />
            </button>
        </div>

        <div class="flex flex-col gap-1.5">
            <label for="twd-input" class="text-xs font-semibold text-text-secondary">TWD 台幣 NT$</label>
            <div class="relative flex items-center">
                <input
                    type="number"
                    id="twd-input"
                    bind:value={twdValue}
                    oninput={() => convert("twd")}
                    placeholder="輸入台幣"
                    class="w-full bg-black/25 border border-card-border rounded-xl py-3 pl-4 pr-10 text-text-primary font-bold text-base outline-none focus:border-neon-blue transition"
                >
                <span class="absolute right-4 font-bold text-text-secondary">$</span>
            </div>
        </div>
    </div>

    <!-- Exchange Rate Setting -->
    <div class="flex items-center justify-end gap-2 text-[11px] text-text-muted mt-4">
        <span>匯率設定：1 TWD = </span>
        <input
            type="number"
            bind:value={exchangeRate}
            oninput={() => convert("rate")}
            step="0.1"
            class="w-14 bg-transparent border-0 border-b border-dashed border-text-muted text-center text-text-secondary font-bold outline-none"
        >
        <span>KRW</span>
    </div>

    <!-- Quick Buttons -->
    <div class="flex flex-wrap gap-1.5 mt-3">
        {#each [1000, 5000, 10000, 30000, 50000, 100000] as amount (amount)}
            <button
                onclick={() => setQuickKRW(amount)}
                class="bg-white/3 border border-card-border text-text-secondary py-1.5 px-3 rounded-lg text-xs font-semibold hover:bg-neon-blue hover:text-black transition cursor-pointer"
            >
                {amount / 1000}k ₩
            </button>
        {/each}
    </div>
</div>

<!-- Ledger Management -->
<div class="glass-panel rounded-2xl p-5 mb-5">
    <div class="flex justify-between items-center mb-4">
        <h3 class="text-base font-bold text-text-primary">💳 WOWPASS & 現金記帳</h3>
        <button onclick={resetBudget} class="text-xs text-text-muted hover:text-neon-pink font-semibold cursor-pointer">重設</button>
    </div>

    <!-- Stats Dashboard -->
    <div class="grid grid-cols-3 gap-2 mb-5">
        <div class="bg-black/20 border border-white/2 rounded-xl p-2.5 flex flex-col items-center gap-0.5">
            <span class="text-[9px] text-text-secondary font-medium">儲值總額</span>
            <span class="text-xs font-extrabold text-accent-green">₩{totalDeposited.toLocaleString()}</span>
        </div>
        <div class="bg-black/20 border border-white/2 rounded-xl p-2.5 flex flex-col items-center gap-0.5">
            <span class="text-[9px] text-text-secondary font-medium">已花費</span>
            <span class="text-xs font-extrabold text-neon-pink">₩{totalSpent.toLocaleString()}</span>
        </div>
        <div class="bg-black/20 border border-white/2 rounded-xl p-2.5 flex flex-col items-center gap-0.5">
            <span class="text-[9px] text-text-secondary font-medium">剩餘餘額</span>
            <span class="text-xs font-extrabold text-neon-blue">₩{balance.toLocaleString()}</span>
        </div>
    </div>

    <!-- Quick Add Form -->
    <div class="grid grid-cols-3 gap-2 mb-5">
        <input
            type="text"
            bind:value={expenseName}
            placeholder="項目 (如: 雪濃湯)"
            class="col-span-3 bg-black/25 border border-card-border rounded-xl p-2.5 text-xs text-text-primary font-semibold outline-none focus:border-neon-blue"
        >
        <input
            type="number"
            bind:value={expenseAmount}
            placeholder="金額 (₩)"
            class="col-span-2 bg-black/25 border border-card-border rounded-xl p-2.5 text-xs text-text-primary font-semibold outline-none focus:border-neon-blue"
        >
        <select
            bind:value={expenseType}
            class="bg-black/25 border border-card-border rounded-xl p-2.5 text-xs text-text-primary font-semibold outline-none cursor-pointer"
        >
            <optgroup label="支出">
                <option value="WOWPASS">WOWPASS 支出 💳</option>
                <option value="Cash">現金 支出 💵</option>
            </optgroup>
            <optgroup label="儲值 / 兌換">
                <option value="Deposit-WOWPASS">WOWPASS 加值 ＋</option>
                <option value="Deposit-Cash">現金 兌換 ＋</option>
            </optgroup>
        </select>
        <button
            onclick={addExpense}
            class="col-span-3 bg-gradient-to-r from-neon-blue to-neon-purple text-black font-extrabold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1 transition active:scale-[0.98] cursor-pointer shadow-[0_0_15px_rgba(0,240,255,0.2)]"
        >
            <Plus size={14} class="stroke-[3]" />
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
                        <span class="text-[9px] text-text-muted">
                            {
                                item.type.startsWith("Deposit")
                                ? (item.type.includes("WOWPASS") ? "💳 WOWPASS 加值" : "💵 現金兌換")
                                : (item.type === "WOWPASS" ? "💳 WOWPASS 支付" : "💵 現金支付")
                            }
                        </span>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="font-bold {item.type.startsWith('Deposit') ? 'text-accent-green' : 'text-text-primary'}">
                            {item.type.startsWith("Deposit") ? "+" : "-"}₩{item.amount.toLocaleString()}
                        </span>
                        <button
                            onclick={() => deleteExpense(item.id)}
                            class="text-text-muted hover:text-neon-pink cursor-pointer transition"
                            title="刪除"
                        >
                            <Trash2 size={12} />
                        </button>
                    </div>
                </li>
            {:else}
                <li class="text-center text-xs text-text-muted py-4">無消費紀錄</li>
            {/each}
        </ul>
    </div>
</div>
