// Shared shape for the app-level toast: a plain message, or a message plus a
// single action (the undo variant — App.svelte gives it a longer window).
export type ToastInput = string | { message: string; actionLabel?: string; onAction?: () => void; };
