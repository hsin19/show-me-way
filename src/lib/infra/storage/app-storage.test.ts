import { createLocalStorageStub } from "$lib/testing/stubs";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { appStorage } from "./app-storage";

// The physical keys are the contract here: e2e seeds them, index.html's pre-paint script
// reads one, and installed phones already hold data under them.
describe("appStorage", () => {
    let storage: Storage;

    beforeEach(() => {
        storage = createLocalStorageStub();
        vi.stubGlobal("localStorage", storage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("keeps every name under the showmeway_ namespace", () => {
        appStorage.set("user_yaml", "trip: A");

        expect(storage.getItem("showmeway_user_yaml")).toBe("trip: A");
        expect(appStorage.get("user_yaml")).toBe("trip: A");
        appStorage.remove("user_yaml");
        expect(storage.getItem("showmeway_user_yaml")).toBeNull();
    });

    // The shared GitHub Pages origin: another project's keys are none of this app's business.
    it("lists only its own names, without the namespace", () => {
        storage.setItem("showmeway_theme", "dark");
        storage.setItem("showmeway_weather_tokyo", "{}");
        storage.setItem("other_project_token", "x");

        expect(appStorage.names().sort()).toEqual(["theme", "weather_tokyo"]);
    });

    it("sizes an entry by the key it is stored under, as the quota bills it", () => {
        appStorage.set("theme", "dark");

        expect(appStorage.sizeOf("theme")).toBe(("showmeway_theme".length + "dark".length) * 2);
    });
});
