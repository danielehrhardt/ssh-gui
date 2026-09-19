import { useRef, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { Dialog } from "./Dialog";
import { Button, Field, IconButton, TextInput } from "./ui";

export function PassphraseDialog({
  keyName,
  onClose,
  onSubmit,
}: {
  keyName: string;
  onClose: () => void;
  /** Resolves to an error message, or null once the key is loaded. */
  onSubmit: (passphrase: string) => Promise<string | null>;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (busy || passphrase.length === 0) return;
    setBusy(true);
    setError(null);
    const failure = await onSubmit(passphrase);
    if (failure) {
      setError(failure);
      setPassphrase("");
      setBusy(false);
      // The field was disabled while we waited; put the cursor back in it.
      requestAnimationFrame(() => input.current?.focus());
    }
  };

  return (
    <Dialog
      title="Unlock key"
      description={
        <>
          <span className="font-mono text-[11px] text-text">{keyName}</span> is protected by a
          passphrase. ssh-agent needs it once to load the key.
        </>
      }
      onClose={onClose}
      onSubmit={submit}
      width="max-w-[400px]"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={passphrase.length === 0} busy={busy}>
            <Lock className="size-3.5" />
            Unlock and add
          </Button>
        </>
      }
    >
      <Field label="Passphrase" error={error}>
        <div className="flex items-center gap-1.5">
          <TextInput
            ref={input}
            type={reveal ? "text" : "password"}
            value={passphrase}
            autoComplete="current-password"
            invalid={Boolean(error)}
            disabled={busy}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <IconButton
            label={reveal ? "Hide passphrase" : "Show passphrase"}
            onClick={() => setReveal((v) => !v)}
          >
            {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </IconButton>
        </div>
      </Field>
      <p className="mt-2 text-2xs leading-[1.5] text-faint">
        The passphrase is handed straight to ssh-add and never stored by this app.
      </p>
    </Dialog>
  );
}
