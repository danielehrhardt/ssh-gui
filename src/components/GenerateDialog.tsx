import { useMemo, useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { Dialog } from "./Dialog";
import { Badge, Button, cx, Field, IconButton, TextInput } from "./ui";
import { validateName } from "../lib/keyname";
import { algoMeta } from "../lib/format";
import type { GenerateOptions } from "../lib/types";

type Algo = "ed25519" | "rsa" | "ecdsa";

const CHOICES: {
  algorithm: Algo;
  title: string;
  blurb: string;
  bits: number[];
  defaultBits: number | null;
  recommended?: boolean;
}[] = [
  {
    algorithm: "ed25519",
    title: "Ed25519",
    blurb: "Fast, small, and the modern default.",
    bits: [],
    defaultBits: null,
    recommended: true,
  },
  {
    algorithm: "rsa",
    title: "RSA",
    blurb: "Widest compatibility, including older servers.",
    bits: [2048, 3072, 4096],
    defaultBits: 4096,
  },
  {
    algorithm: "ecdsa",
    title: "ECDSA",
    blurb: "NIST curves. Prefer Ed25519 where it is supported.",
    bits: [256, 384],
    defaultBits: 256,
  },
];

function strength(pass: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (pass.length === 0) return { score: 0, label: "" };
  let bonus = 0;
  if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) bonus += 1;
  if (/\d/.test(pass)) bonus += 1;
  if (/[^A-Za-z0-9]/.test(pass)) bonus += 1;
  if (pass.length >= 20 || (pass.length >= 12 && bonus >= 2)) return { score: 3, label: "Strong" };
  if (pass.length >= 10 || bonus >= 2) return { score: 2, label: "Reasonable" };
  return { score: 1, label: "Weak" };
}

export function GenerateDialog({
  existingNames,
  onClose,
  onGenerate,
}: {
  existingNames: string[];
  onClose: () => void;
  onGenerate: (options: GenerateOptions) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [algorithm, setAlgorithm] = useState<Algo>("ed25519");
  const [bits, setBits] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const nameError = useMemo(
    () => (name.length > 0 || touched ? validateName(name, existingNames) : null),
    [name, touched, existingNames],
  );
  const mismatch = confirm.length > 0 && confirm !== passphrase;
  const pass = strength(passphrase);
  const confirmed = passphrase.length === 0 || confirm === passphrase;
  const valid = nameError === null && name.trim().length > 0 && !mismatch && confirmed;

  const choose = (algo: Algo) => {
    setAlgorithm(algo);
    setBits(CHOICES.find((c) => c.algorithm === algo)?.defaultBits ?? null);
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await onGenerate({
        name: name.trim(),
        algorithm,
        bits,
        comment: comment.trim(),
        passphrase: passphrase.length > 0 ? passphrase : null,
      });
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const slow = algorithm === "rsa" && (bits ?? 4096) >= 4096;

  return (
    <Dialog
      title="Generate a new key"
      description="A private key and its .pub companion are written to your ssh directory."
      onClose={onClose}
      onSubmit={submit}
      width="max-w-[500px]"
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
          <Button type="submit" variant="primary" disabled={!valid} busy={busy}>
            {busy ? (slow ? "Generating — this takes a moment" : "Generating") : "Generate key"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field
          label="Name"
          error={nameError}
          hint="The file name inside your ssh directory. Letters, digits and . _ @ + -"
        >
          <TextInput
            value={name}
            mono
            autoComplete="off"
            spellCheck={false}
            placeholder="work_ed25519"
            invalid={Boolean(nameError)}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        </Field>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-semibold text-text">Algorithm</legend>
          <div className="flex flex-col gap-1">
            {CHOICES.map((choice) => {
              const active = choice.algorithm === algorithm;
              const meta = algoMeta(choice.algorithm);
              return (
                <label
                  key={choice.algorithm}
                  className={cx(
                    "flex cursor-default items-start gap-2.5 rounded-lg border p-2 transition-colors duration-150",
                    active
                      ? "border-accent-line bg-accent-soft"
                      : "border-line bg-surface hover:border-line-strong hover:bg-surface-2",
                  )}
                >
                  <input
                    type="radio"
                    name="algorithm"
                    className="sr-only"
                    checked={active}
                    onChange={() => choose(choice.algorithm)}
                  />
                  <span
                    className="mt-px flex h-[20px] w-[38px] shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold"
                    style={{
                      color: meta.color,
                      background: `color-mix(in srgb, ${meta.color} 13%, transparent)`,
                    }}
                  >
                    {meta.glyph}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-text">{choice.title}</span>
                      {choice.recommended && <Badge tone="positive">Recommended</Badge>}
                      {active && (
                        <Check className="ml-auto size-3.5 shrink-0 text-accent" strokeWidth={2.75} />
                      )}
                    </span>
                    <span className="mt-0.5 block text-2xs leading-[1.45] text-muted">
                      {choice.blurb}
                    </span>
                    {active && choice.bits.length > 0 && (
                      <span className="mt-2 flex items-center gap-1.5">
                        <span className="text-2xs text-faint">Bits</span>
                        {choice.bits.map((b) => (
                          <button
                            key={b}
                            type="button"
                            onClick={() => setBits(b)}
                            className={cx(
                              "tnum h-6 rounded-md border px-2 text-2xs font-medium transition-colors duration-150",
                              b === (bits ?? choice.defaultBits)
                                ? "border-accent-line bg-surface text-accent"
                                : "border-line bg-surface text-muted hover:text-text",
                            )}
                          >
                            {b}
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <Field
          label="Comment"
          optional
          hint="Written into the public key. A note on where the key lives helps later."
        >
          <TextInput
            value={comment}
            mono
            autoComplete="off"
            spellCheck={false}
            placeholder="you@your-machine"
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>

        <div className="flex flex-col gap-3">
          <Field
            label="Passphrase"
            optional
            hint="Protects the key if the file is ever copied. Leave it empty for unattended use."
          >
            <div className="flex items-center gap-1.5">
              <TextInput
                type={reveal ? "text" : "password"}
                value={passphrase}
                autoComplete="new-password"
                placeholder="Leave empty for no passphrase"
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
          {passphrase.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <div className="flex h-1 flex-1 gap-1" aria-hidden>
                  {[1, 2, 3].map((step) => (
                    <span
                      key={step}
                      className={cx(
                        "h-full flex-1 rounded-full transition-colors duration-200",
                        pass.score >= step
                          ? pass.score === 1
                            ? "bg-warning"
                            : pass.score === 2
                              ? "bg-accent"
                              : "bg-positive"
                          : "bg-line",
                      )}
                    />
                  ))}
                </div>
                <span
                  className={cx(
                    "w-[72px] text-2xs font-medium",
                    pass.score === 1
                      ? "text-warning"
                      : pass.score === 2
                        ? "text-accent"
                        : "text-positive",
                  )}
                >
                  {pass.label}
                </span>
              </div>
              <Field
                label="Confirm passphrase"
                error={mismatch ? "The two passphrases do not match." : null}
              >
                <TextInput
                  type={reveal ? "text" : "password"}
                  value={confirm}
                  autoComplete="new-password"
                  invalid={mismatch}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
