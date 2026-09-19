import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useToast } from "./Toasts";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Button ───────────────────────────────────────────────────────────── */

type Variant = "primary" | "default" | "ghost" | "danger" | "danger-quiet";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg border border-transparent hover:bg-accent-hover shadow-sm",
  default:
    "bg-surface text-text border border-line-strong hover:bg-surface-2 hover:border-faint/60 shadow-sm",
  ghost: "bg-transparent text-muted border border-transparent hover:bg-sunken hover:text-text",
  danger: "bg-danger text-danger-fg border border-transparent hover:bg-danger-hover shadow-sm",
  "danger-quiet":
    "bg-transparent text-danger border border-transparent hover:bg-danger-soft",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  md: "h-8 px-3 gap-2 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
}

export function Button({
  variant = "default",
  size = "md",
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={rest.type ?? "button"}
      disabled={disabled || busy}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap",
        "transition-[background-color,border-color,color,opacity] duration-150",
        "disabled:opacity-45 disabled:pointer-events-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {busy && <Loader2 className="anim-spin size-3.5 shrink-0" strokeWidth={2.25} />}
      {children}
    </button>
  );
}

/* ── Icon button ──────────────────────────────────────────────────────── */

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: "default" | "danger";
  size?: "sm" | "md";
}

export function IconButton({
  label,
  tone = "default",
  size = "md",
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip text={label}>
      <button
        type="button"
        aria-label={label}
        className={cx(
          "inline-flex items-center justify-center rounded-md border border-transparent",
          "transition-[background-color,color] duration-150",
          "disabled:opacity-40 disabled:pointer-events-none",
          size === "sm" ? "size-6" : "size-7",
          tone === "danger"
            ? "text-muted hover:bg-danger-soft hover:text-danger"
            : "text-muted hover:bg-sunken hover:text-text",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/* ── Tooltip ──────────────────────────────────────────────────────────── */

export function Tooltip({
  text,
  side = "bottom",
  children,
}: {
  text: string | null;
  side?: "top" | "bottom";
  children: ReactNode;
}) {
  if (!text) return <>{children}</>;
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md",
          "border border-line bg-surface px-2 py-1 text-2xs font-medium text-text shadow-pop",
          "opacity-0 transition-opacity delay-150 duration-150",
          "group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
          side === "bottom" ? "top-[calc(100%+6px)]" : "bottom-[calc(100%+6px)]",
        )}
      >
        {text}
      </span>
    </span>
  );
}

/* ── Switch ───────────────────────────────────────────────────────────── */

export function Switch({
  checked,
  onChange,
  disabled = false,
  pending = false,
  tone = "accent",
  label,
  describedBy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  pending?: boolean;
  tone?: "accent" | "positive";
  label: string;
  describedBy?: string;
}) {
  const onColor = tone === "positive" ? "bg-positive" : "bg-accent";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled || pending}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cx(
        "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full",
        "transition-colors duration-200 disabled:cursor-default",
        checked ? onColor : "bg-line-strong",
        (disabled || pending) && "opacity-50",
      )}
    >
      <span
        className={cx(
          "absolute flex size-3.5 items-center justify-center rounded-full bg-white shadow-sm",
          "transition-[left] duration-200 ease-out",
          checked ? "left-[16px]" : "left-[2px]",
        )}
      >
        {pending && (
          <Loader2
            className="anim-spin size-2.5 text-[color:var(--faint)]"
            strokeWidth={3}
          />
        )}
      </span>
    </button>
  );
}

/* ── Badge ────────────────────────────────────────────────────────────── */

export function Badge({
  children,
  tone = "neutral",
  title,
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "danger" | "accent";
  title?: string;
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-line text-muted bg-surface-2",
    positive: "border-transparent text-positive bg-[color:var(--positive-soft)]",
    warning: "border-transparent text-warning bg-[color:var(--warning-soft)]",
    danger: "border-transparent text-danger bg-[color:var(--danger-soft)]",
    accent: "border-transparent text-accent bg-accent-soft",
  };
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-[17px] shrink-0 items-center gap-1 rounded border px-1.5",
        "text-2xs font-medium tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ── Segmented control ────────────────────────────────────────────────── */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex h-7 items-center gap-0.5 rounded-lg border border-line bg-sunken p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cx(
              "inline-flex h-6 items-center gap-1.5 rounded-[6px] px-2 text-xs font-medium",
              "transition-[background-color,color,box-shadow] duration-150",
              active
                ? "bg-surface text-text shadow-sm"
                : "text-muted hover:text-text",
            )}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span className={cx("tnum text-2xs", active ? "text-faint" : "text-faint")}>
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Form field ───────────────────────────────────────────────────────── */

const FieldIdContext = createContext<string | null>(null);

export function Field({
  label,
  hint,
  error,
  children,
  optional,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  optional?: boolean;
}) {
  const id = useId();
  return (
    <FieldIdContext value={id}>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={id} className="text-xs font-semibold text-text">
            {label}
          </label>
          {optional && <span className="text-2xs text-faint">Optional</span>}
        </div>
        {children}
        {error ? (
          <p className="text-2xs font-medium text-danger">{error}</p>
        ) : hint ? (
          <p className="text-2xs text-faint">{hint}</p>
        ) : null}
      </div>
    </FieldIdContext>
  );
}

export function TextInput({
  invalid,
  className,
  mono,
  ...rest
}: ComponentProps<"input"> & { invalid?: boolean; mono?: boolean }) {
  const id = useContext(FieldIdContext);
  return (
    <input
      id={rest.id ?? id ?? undefined}
      aria-invalid={invalid || undefined}
      className={cx(
        "h-8 w-full rounded-md border bg-surface px-2.5 text-[13px] text-text",
        "placeholder:text-faint transition-[border-color,box-shadow] duration-150",
        "focus:outline-none focus-visible:outline-none",
        mono && "font-mono text-xs",
        invalid
          ? "border-danger focus:border-danger focus:ring-2 focus:ring-[color:var(--danger-soft)]"
          : "border-line-strong focus:border-accent focus:ring-2 focus:ring-[color:var(--accent-soft)]",
        className,
      )}
      {...rest}
    />
  );
}

/* ── Copy affordance ──────────────────────────────────────────────────── */

/** Copies via the API and reports a local "Copied" state for 1.4s. `copy` resolves to whether it worked. */
export function useCopy(): [copied: boolean, copy: (text: string) => Promise<boolean>] {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copy = async (text: string) => {
    try {
      await api.copyText(text);
    } catch (e) {
      // Never show "Copied" for a copy that did not happen.
      toast.error("Could not copy to the clipboard", errorMessage(e));
      return false;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
    return true;
  };
  return [copied, copy];
}

export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  variant = "default",
  size = "md",
  onCopied,
  className,
  iconOnly = false,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  variant?: Variant;
  size?: Size;
  onCopied?: () => void;
  className?: string;
  iconOnly?: boolean;
}) {
  const [copied, copy] = useCopy();
  const handle = async () => {
    if (await copy(text)) onCopied?.();
  };
  if (iconOnly) {
    return (
      <IconButton
        label={copied ? copiedLabel : label}
        onClick={(e) => {
          e.stopPropagation();
          void handle();
        }}
        size={size === "sm" ? "sm" : "md"}
        className={cx(copied && "text-positive hover:text-positive", className)}
      >
        {copied ? <Check className="size-3.5" strokeWidth={2.5} /> : <Copy className="size-3.5" />}
      </IconButton>
    );
  }
  return (
    <Button
      variant={variant}
      size={size}
      onClick={(e) => {
        e.stopPropagation();
        void handle();
      }}
      className={cx(copied && variant !== "primary" && variant !== "danger" && "text-positive", className)}
    >
      {copied ? (
        <Check className="size-3.5 shrink-0" strokeWidth={2.5} />
      ) : (
        <Copy className="size-3.5 shrink-0" />
      )}
      {copied ? copiedLabel : label}
    </Button>
  );
}

/* ── Misc ─────────────────────────────────────────────────────────────── */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      className={cx(
        "inline-flex h-[17px] min-w-[17px] items-center justify-center rounded border border-line",
        "bg-surface-2 px-1 font-sans text-2xs font-medium text-muted",
      )}
    >
      {children}
    </kbd>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx("h-px bg-line", className)} />;
}
