// The YAML editor is a page, not a modal, so leaving the tab unmounts it and
// takes any unsaved edit with it. This rune lives outside the component so the
// draft survives. `null` means no draft — the editor falls back to the persisted
// YAML — and it MUST be cleared whenever the active trip changes, or a draft from
// the old trip gets saved over the new one.
export const settingsDraft = $state<{ yaml: string | null; }>({ yaml: null });
