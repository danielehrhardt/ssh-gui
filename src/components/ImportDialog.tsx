import { useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import { Dialog } from "./Dialog";
import { Button, Field, TextInput } from "./ui";
import { suggestNameFromPath, validateName } from "../lib/keyname";

export function ImportDialog({
  sourcePath,
  existingNames,
  onClose,
  onImport,
}: {
  sourcePath: string;
  existingNames: string[];
  onClose: () => void;
  onImport: (sourcePath: string, name: string) => Promise<void>;
}) {
  const [name, setName] = useState(() => suggestNameFromPath(sourcePath));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const error = useMemo(() => validateName(name, existingNames), [name, existingNames]);

  const submit = async () => {
    if (error || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await onImport(sourcePath, name.trim());
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Import a key"
      description="The file is copied into your ssh directory; the original stays where it is."
      onClose={onClose}
      onSubmit={submit}
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
          <Button type="submit" variant="primary" disabled={Boolean(error)} busy={busy}>
            Import key
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 p-2.5">
          <FileDown className="mt-px size-3.5 shrink-0 text-faint" strokeWidth={2.25} />
          <div className="min-w-0 flex-1">
            <p className="label-xs">Source file</p>
            <p className="selectable mt-0.5 font-mono text-[10.5px] leading-[1.5] break-all text-muted">
              {sourcePath}
            </p>
          </div>
        </div>
        <Field
          label="Name in your ssh directory"
          error={error}
          hint="Defaults to the file name. Rename it now if you want something clearer."
        >
          <TextInput
            value={name}
            mono
            autoComplete="off"
            spellCheck={false}
            invalid={Boolean(error)}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
