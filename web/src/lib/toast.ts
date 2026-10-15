import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
}

interface ToastState {
  toasts: Toast[];
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Show a transient message. Replaces React Native's Alert.alert for errors and notices. */
export function toast(message: string, kind: Toast["kind"] = "info") {
  const id = nextId++;
  useToastStore.setState((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
  setTimeout(() => useToastStore.getState().dismiss(id), 4000);
}

export function toastError(err: unknown) {
  toast(err instanceof Error ? err.message : String(err), "error");
}
