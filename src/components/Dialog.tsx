import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx, IconButton } from "./ui";

const FOCUSABLE =
  'input:not([disabled]),textarea:not([disabled]),select:not([disabled]),button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog: focus is trapped inside, the first field is focused on open,
 * Escape closes, Enter submits when `onSubmit` is given, and focus returns to
 * whatever opened it.
 */
export function Dialog({
  title,
  description,
  onClose,
  onSubmit,
  children,
  footer,
  width = "max-w-[440px]",
  tone = "default",
  dismissable = true,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  onSubmit?: () => void;
  children: ReactNode;
  footer: ReactNode;
  width?: string;
  tone?: "default" | "danger";
  /** false while work is in flight: closing then would hide its outcome from the user. */
  dismissable?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    if (node) {
      const first = node.querySelector<HTMLElement>(
        'input:not([disabled]),textarea:not([disabled]),[data-autofocus]',
      );
      (first ?? node.querySelector<HTMLElement>(FOCUSABLE) ?? node).focus();
    }
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (dismissable) onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="anim-overlay fixed inset-0 z-40 flex items-center justify-center bg-overlay p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cx(
          "anim-dialog flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-line",
          "bg-surface shadow-dialog outline-none",
          width,
        )}
      >
        <header className="flex items-start gap-3 px-4 pt-3.5 pb-3">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className={cx(
                "text-[13px] leading-5 font-semibold",
                tone === "danger" ? "text-danger" : "text-text",
              )}
            >
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-0.5 text-xs leading-[1.5] text-muted">
                {description}
              </p>
            )}
          </div>
          <IconButton
            label="Close"
            size="sm"
            onClick={onClose}
            disabled={!dismissable}
            className="-mr-1"
          >
            <X className="size-3.5" />
          </IconButton>
        </header>

        {onSubmit ? (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            <div className="scroller min-h-0 flex-1 px-4 pb-4">{children}</div>
            <DialogFooter>{footer}</DialogFooter>
          </form>
        ) : (
          <>
            <div className="scroller min-h-0 flex-1 px-4 pb-4">{children}</div>
            <DialogFooter>{footer}</DialogFooter>
          </>
        )}
      </div>
    </div>
  );
}

function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-2 px-4 py-3">
      {children}
    </footer>
  );
}
