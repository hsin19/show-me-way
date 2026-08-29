import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { validateYaml } from "../domain/trip";
import { TripStore } from "./trip.svelte";

const TEST_YAML = `trip:
  name: 東京之旅
  city: 東京
  currency: JPY
  start: '2025-05-01'
  end: '2025-05-02'
  departure: '2025-05-01T08:00:00+08:00'
  hotels: []
days:
  - date: '2025-05-01'
    title: 抵達
    timeline:
      - time: '10:00'
        title: 抵達機場
todo:
  - text: 買網卡
    checked: false
packing:
  - text: 護照
    checked: true
expenses: []
`;

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    };
}

describe("TripStore", () => {
    let store: TripStore;
    const originalLocalStorage = globalThis.localStorage;

    beforeEach(() => {
        globalThis.localStorage = createLocalStorageStub() as unknown as Storage;
        vi.stubGlobal("window", {
            setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout),
        });
        store = new TripStore();
        store.data = validateYaml(TEST_YAML);
    });

    afterEach(() => {
        globalThis.localStorage = originalLocalStorage;
        vi.unstubAllGlobals();
    });

    it("derives prep totals and done count correctly", () => {
        expect(store.prepTotal).toBe(2);
        expect(store.prepDone).toBe(1);
    });

    it("toggles checklist items", () => {
        const todoItem = store.data!.todo[0];
        expect(todoItem.checked).toBe(false);

        store.toggleChecklistItem("todo", todoItem._id!);
        expect(todoItem.checked).toBe(true);

        store.toggleChecklistItem("todo", todoItem._id!);
        expect(todoItem.checked).toBe(false);
    });

    it("adds and deletes checklist items", () => {
        store.addChecklistItem("todo", "新待辦事項");
        expect(store.data!.todo.length).toBe(2);
        expect(store.data!.todo[1].text).toBe("新待辦事項");

        const newId = store.data!.todo[1]._id!;
        store.deleteChecklistItem("todo", newId);
        expect(store.data!.todo.length).toBe(1);
    });

    it("manages trip wallets", () => {
        expect(store.data!.trip.wallets).toBeUndefined();
        store.addTripWallet("公費");
        expect(store.data!.trip.wallets).toEqual(["公費"]);

        // Duplicate wallet ignored
        store.addTripWallet("公費");
        expect(store.data!.trip.wallets).toEqual(["公費"]);
    });

    it("adds, deletes, and resets expenses", () => {
        store.addExpense("拉麵", 1200, "現金", "2025-05-01");
        expect(store.data!.expenses.length).toBe(1);
        expect(store.data!.expenses[0].name).toBe("拉麵");
        expect(store.data!.expenses[0].amount).toBe(1200);

        const expId = store.data!.expenses[0]._id!;
        store.deleteExpense(expId);
        expect(store.data!.expenses.length).toBe(0);

        store.addExpense("壽司", 3000, "刷卡");
        expect(store.data!.expenses.length).toBe(1);
        store.resetLedger();
        expect(store.data!.expenses.length).toBe(0);
    });

    it("updates timeline event status", () => {
        const event = store.data!.days[0].timeline[0];
        expect(event.status).toBeUndefined();

        store.setEventStatus(event._id!, "done");
        expect(event.status).toBe("done");

        store.setEventStatus(event._id!, undefined);
        expect(event.status).toBeUndefined();
    });
});
