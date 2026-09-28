import {
    describe,
    expect,
    it,
} from "vitest";
import { googleClientId } from "./config";

describe("googleClientId", () => {
    it("reads client ID from environment or fallback", () => {
        const envId = (import.meta.env?.VITE_GOOGLE_CLIENT_ID)?.trim();
        const expectedId = envId || "849908319136-che7nc9nag6ua5gd3fipk9evme4ngjde.apps.googleusercontent.com";
        expect(googleClientId()).toBe(expectedId);
    });
});
