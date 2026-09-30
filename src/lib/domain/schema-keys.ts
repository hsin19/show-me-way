// The keys an itinerary's author wrote that the schema will not keep. The app drops them
// without a word on save (the object schema strips whatever it does not list), so a typo
// like `mapLnk` is otherwise only visible in an editor that has the JSON Schema loaded.

/** The part of the generated JSON Schema this reads: nested `properties` and `items`. */
export interface SchemaNode {
    properties?: Record<string, SchemaNode>;
    items?: SchemaNode;
    [keyword: string]: unknown;
}

/** Where each unknown key sits, e.g. `days[0].timeline[2].mapLnk`. */
export function findUnexpectedKeys(value: unknown, schema: SchemaNode, path = ""): string[] {
    const { items } = schema;
    if (Array.isArray(value)) {
        return items ? value.flatMap((item, index) => findUnexpectedKeys(item, items, `${path}[${index}]`)) : [];
    }
    if (typeof value !== "object" || value === null) return [];
    const known = schema.properties ?? {};
    return Object.entries(value).flatMap(([key, child]) => {
        const childPath = path ? `${path}.${key}` : key;
        const node = known[key];
        return node ? findUnexpectedKeys(child, node, childPath) : [childPath];
    });
}
