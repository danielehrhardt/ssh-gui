import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { cx, IconButton } from "./ui";

type Kind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: Kind;
  message: string;
  detail?: string;
}

export interface ToastApi {
  success(message: string, detail?: string): void;
  error(message: string, detail?: string): void;
  info(message: string, detail?: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}

const LIFETIME: Record<Kind, number> = { success: 3200, info: 4200, error: 8000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: Kind, message: string, detail?: string) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-3), { id, kind, message, detail }]);
      setTimeout(() => dismiss(id), LIFETIME[kind]);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, d) => push("success", m, d),
      error: (m, d) => push("error", m, d),
      info: (m, d) => push("info", m, d),
    }),
    [push],
  );

  return (
    <ToastContext value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        // pb clears the status bar so a toast never sits on top of it.
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pt-4 pb-[42px]"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext>
  );
}

const ICONS: Record<Kind, typeof Check> = {
  success: Check,
  error: AlertTriangle,
  info: Info,
};

const ACCENTS: Record<Kind, string> = {
  success: "text-positive",
  error: "text-danger",
  info: "text-accent",
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = ICONS[toast.kind];
  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className={cx(
        "anim-toast pointer-events-auto flex w-full max-w-[440px] items-start gap-2.5 rounded-lg",
        "border border-line bg-surface px-3 py-2.5 shadow-pop",
      )}
    >
      <Icon
        className={cx("mt-px size-3.5 shrink-0", ACCENTS[toast.kind])}
        strokeWidth={2.5}
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-[1.45] font-medium text-text">{toast.message}</p>
        {toast.detail && (
          <p className="mt-0.5 text-2xs leading-[1.45] break-words text-muted">
            {toast.detail}
          </p>
        )}
      </div>
      <IconButton label="Dismiss" size="sm" onClick={onDismiss} className="-mt-0.5 -mr-1">
        <X className="size-3" />
      </IconButton>
    </div>
  );
}
