// What a component emits upward to open the fullscreen card: a place to show a
// driver, or a code to show a counter clerk. Components never render a layer of
// their own — see `EnlargedCardOverlay`, the single app-level instance.
// `place.prompt` overrides the default heading, which is how HotelCards supplies
// the trip language's own "please take me here" line.
export type EnlargedCard =
    | { kind: "place"; title: string; localName: string; address?: string; prompt?: string; }
    | { kind: "confirmation"; title: string; code: string; name?: string; note?: string; };

/** The confirmation-only subset, for callers that only ever emit a confirmation card. */
export type ConfirmationCard = Extract<EnlargedCard, { kind: "confirmation"; }>;
