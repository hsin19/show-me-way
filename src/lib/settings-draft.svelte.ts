// In-memory draft for the 自訂行程 YAML editor. The editor is a page inside
// the 工具 tab (not a modal), so navigating away unmounts it — this
// module-level rune preserves unsaved edits for the session. `null` means no
// draft (the editor shows the persisted YAML); cleared on save / restore /
// reset, and by App when the active trip profile changes.
export const settingsDraft = $state<{ yaml: string | null; }>({ yaml: null });
