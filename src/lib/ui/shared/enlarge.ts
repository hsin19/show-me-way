// What a component emits upward to open the fullscreen card: a place to show a driver
// or a clerk. Components never render a layer of their own — see `EnlargedCardOverlay`,
// the single app-level instance. `prompt` overrides the default heading, which is how a
// card showing an address supplies the trip language's own "please take me here" line.
export interface EnlargedCard {
    title: string;
    localName: string;
    address?: string;
    prompt?: string;
}
