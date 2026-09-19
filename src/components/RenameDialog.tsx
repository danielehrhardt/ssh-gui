import { useMemo, useState } from "react";
import { ArrowRight, Server } from "lucide-react";
import { Dialog } from "./Dialog";
import { Button, Field, TextInput } from "./ui";
import { validateName } from "../lib/keyname";
import type { KeyInfo } from "../lib/types";
import { errorMessage } from "../lib/api";

export function RenameDialog({
  info,
  existingNames,
  onClose,
  onRename,
}: {
  info: KeyInfo;
  existingNames: string[];
  onClose: () => void;
  onRename: (name: string, newName: string, updateConfig: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(info.name);
  const [updateConfig, setUpdateConfig] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const error = useMemo(
    () => validateName(name, existingNames, info.name),
    [name, existingNames, info.name],
  );
  const unchanged = name.trim() === info.name;
  const hosts = info.usedByHosts;

  const submit = async () => {
    if (error || unchanged || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await onRename(info.name, name.trim(), updateConfig);
    } catch (e) {
      setFailure(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Rename key"
      description="Both the private key and its .pub file are renamed together."
      onClose={onClose}
      dismissable={!busy}
      onSubmit={submit}
      width="max-w-[460px]"
      footer={
        <>
          {failure && (
            <p className="mr-auto min-w-0 truncate text-2xs font-medium text-danger" title={failure}>
              {failure}
            </p>
          )}
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={Boolean(error) || unchanged}
            busy={busy}
          >
            Rename
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="selectable min-w-0 truncate rounded border border-line bg-surface-2 px-2 py-1 text-muted">
            {info.name}
          </span>
          <ArrowRight className="size-3.5 shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate rounded border border-accent-line bg-accent-soft px-2 py-1 font-semibold text-accent">
            {name.trim() || "…"}
          </span>
        </div>

        <Field label="New name" error={error}>
          <TextInput
            value={name}
            mono
            autoComplete="off"
            spellCheck={false}
            invalid={Boolean(error)}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        {hosts.length > 0 && (
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <p className="text-xs leading-[1.5] font-semibold text-text">
              {hosts.length === 1 ? "One Host entry" : `${hosts.length} Host entries`} in
              ~/.ssh/config point at this key
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
            <label className="mt-3 flex cursor-default items-start gap-2">
              <input
                type="checkbox"
                checked={updateConfig}
                onChange={(e) => setUpdateConfig(e.target.checked)}
                className="mt-0.5 size-3.5 shrink-0 accent-[color:var(--accent)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-text">
                  Also update IdentityFile in ~/.ssh/config
                </span>
                <span className="mt-0.5 block text-2xs leading-[1.45] text-faint">
                  Without this, those hosts will keep pointing at the old file name and stop
                  finding the key.
                </span>
              </span>
            </label>
          </div>
        )}
      </div>
    </Dialog>
  );
}
