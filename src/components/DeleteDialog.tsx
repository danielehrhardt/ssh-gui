import { useState } from "react";
import { AlertTriangle, Server, Trash2 } from "lucide-react";
import { Dialog } from "./Dialog";
import { Button } from "./ui";
import type { KeyInfo } from "../lib/types";
import { errorMessage } from "../lib/api";

export function DeleteDialog({
  info,
  onClose,
  onDelete,
}: {
  info: KeyInfo;
  onClose: () => void;
  onDelete: (name: string, permanent: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"trash" | "permanent" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const hosts = info.usedByHosts;

  const run = async (permanent: boolean) => {
    if (busy) return;
    setBusy(permanent ? "permanent" : "trash");
    setFailure(null);
    try {
      await onDelete(info.name, permanent);
    } catch (e) {
      setFailure(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <Dialog
      title={`Delete ${info.name}?`}
      description="Both the private key and its .pub file are removed from your ssh directory."
      tone="danger"
      onClose={onClose}
      dismissable={busy === null}
      onSubmit={() => void run(false)}
      width="max-w-[460px]"
      footer={
        <>
          {failure && (
            <p className="mr-auto min-w-0 truncate text-2xs font-medium text-danger" title={failure}>
              {failure}
            </p>
          )}
          <Button onClick={onClose} disabled={busy !== null} data-autofocus>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            busy={busy === "trash"}
            disabled={busy === "permanent"}
          >
            <Trash2 className="size-3.5" />
            Move to Trash
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs leading-[1.55] text-muted">
          The files go to your system trash, so you can put them back if this turns out to be a
          mistake.
        </p>

        {hosts.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-lg border border-transparent bg-[color:var(--warning-soft)] p-2.5">
            <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" strokeWidth={2.25} />
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-[1.45] font-semibold text-text">
                {hosts.length === 1 ? "One host still uses" : `${hosts.length} hosts still use`}{" "}
                this key
              </p>
              <p className="mt-0.5 text-2xs leading-[1.45] text-muted">
                Connections to {hosts.length === 1 ? "it" : "them"} will fail until ~/.ssh/config is
                updated.
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {hosts.map((host) => (
                  <span
                    key={host}
                    className="inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-muted"
                  >
                    <Server className="size-2.5 shrink-0 text-faint" />
                    {host}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-2.5 py-2">
          <p className="min-w-0 text-2xs leading-[1.45] text-faint">
            Skip the trash and erase the files immediately. This cannot be undone.
          </p>
          <Button
            variant="danger-quiet"
            size="sm"
            busy={busy === "permanent"}
            disabled={busy === "trash"}
            onClick={() => void run(true)}
          >
            Delete permanently
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
