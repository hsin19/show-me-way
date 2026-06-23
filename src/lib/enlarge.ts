// Shared shape for the fullscreen enlarged-card overlay (a single app-level
// instance in App.svelte): a place's local-language name (and optional address)
// shown to a driver / clerk, or a reservation confirmation code shown at a
// check-in counter. Components that open the overlay emit one of these.
//   - place.prompt overrides the default driver/clerk heading (TaxiHelper passes
//     the trip language's localized "please take me here" line).
export type EnlargedCard =
    | { kind: "place"; title: string; localName: string; address?: string; prompt?: string; }
    | { kind: "confirmation"; title: string; code: string; name?: string; note?: string; };

/** The confirmation-only subset, for callers that only ever emit a confirmation card. */
export type ConfirmationCard = Extract<EnlargedCard, { kind: "confirmation"; }>;
