import { useEffect, useRef, useState } from "react";
import {
  Check,
  FileKey2,
  FolderOpen,
  KeyRound,
  Lock,
  Pencil,
  Power,
  Server,
  ShieldAlert,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import type { KeyInfo } from "../lib/types";
import { absoluteTime, algoLabel, algoMeta, relativeTime } from "../lib/format";
import type { KeyStore } from "../hooks/useKeyStore";
import {
  Badge,
  Button,
  CopyButton,
  cx,
  IconButton,
  Switch,
  TextInput,
  Tooltip,
} from "./ui";

export function Inspector({
  info,
  store,
  agentAvailable,
  agentMessage,
  onToggleAgent,
  onRename,
  onDelete,
  onClose,
}: {
  info: KeyInfo | null;
  store: KeyStore;
  agentAvailable: boolean;
  agentMessage: string | null;
  onToggleAgent: (key: KeyInfo) => void;
  onRename: (key: KeyInfo) => void;
  onDelete: (key: KeyInfo) => void;
  onClose?: () => void;
}) {
  if (!info) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <KeyRound className="size-5 text-faint" strokeWidth={1.75} />
        <p className="text-xs font-medium text-muted">No key selected</p>
        <p className="text-2xs leading-[1.5] text-faint">
          Pick a key to inspect its fingerprint, public key and the hosts that use it.
        </p>
      </div>
    );
  }
  return <InspectorBody key={info.name} info={info} store={store}
    agentAvailable={agentAvailable} agentMessage={agentMessage}
    onToggleAgent={onToggleAgent} onRename={onRename} onDelete={onDelete} onClose={onClose} />;
}

function InspectorBody({
  info,
  store,
  agentAvailable,
  agentMessage,
  onToggleAgent,
  onRename,
  onDelete,
  onClose,
}: {
  info: KeyInfo;
  store: KeyStore;
  agentAvailable: boolean;
  agentMessage: string | null;
  onToggleAgent: (key: KeyInfo) => void;
  onRename: (key: KeyInfo) => void;
  onDelete: (key: KeyInfo) => void;
  onClose?: () => void;
}) {
  const meta = algoMeta(info.algorithm);
  const canUseAgent = agentAvailable && info.hasPrivate && info.enabled;

  return (
    <div className="anim-panel flex h-full min-h-0 flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-start gap-2.5 border-b border-line px-4 py-3">
        <span
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold"
          style={{
            color: meta.color,
            background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
          }}
        >
          {meta.glyph}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="selectable truncate text-sm leading-5 font-semibold text-text">
            {info.name}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-2xs font-medium text-muted">{algoLabel(info)}</span>
            <span className="text-faint">·</span>
            {info.hasPrivate ? (
              info.encrypted ? (
                <span className="inline-flex items-center gap-1 text-2xs text-muted">
                  <Lock className="size-2.5" strokeWidth={2.5} /> Passphrase
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-2xs font-medium text-warning">
                  <Unlock className="size-2.5" strokeWidth={2.5} /> No passphrase
                </span>
              )
            ) : (
              <Badge tone="neutral">Public only</Badge>
            )}
            {info.format === "pem" && <Badge tone="warning">PEM</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton label="Rename…" size="sm" onClick={() => onRename(info)}>
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton label="Delete…" size="sm" tone="danger" onClick={() => onDelete(info)}>
            <Trash2 className="size-3.5" />
          </IconButton>
          {onClose && (
            <IconButton label="Close panel" size="sm" onClick={onClose}>
              <X className="size-3.5" />
            </IconButton>
          )}
        </div>
      </header>

      <div className="scroller min-h-0 flex-1">
        {/* Toggles */}
        <div className="divide-y divide-line border-b border-line">
          <ToggleRow
            icon={<Power className="size-3.5" strokeWidth={2.25} />}
            title={info.enabled ? "Enabled" : "Disabled"}
            detail={
              info.enabled
                ? "ssh picks this key up from ~/.ssh."
                : "Parked in ~/.ssh/disabled — ssh cannot see it."
            }
            control={
              <Switch
                checked={info.enabled}
                pending={store.isPending(info.name, "enabled")}
                tone="positive"
                label={`${info.enabled ? "Disable" : "Enable"} ${info.name}`}
                onChange={(next) => store.setEnabled(info, next)}
              />
            }
          />
          <ToggleRow
            icon={<FileKey2 className="size-3.5" strokeWidth={2.25} />}
            title={info.inAgent ? "Loaded in ssh-agent" : "Not in ssh-agent"}
            detail={
              !agentAvailable
                ? (agentMessage ?? "ssh-agent is not reachable.")
                : !info.hasPrivate
                  ? "Public-only keys cannot be loaded."
                  : !info.enabled
                    ? "Enable the key to load it."
                    : info.encrypted
                      ? "Unlocks once per session."
                      : "Available to ssh without prompting."
            }
            control={
              <Tooltip text={canUseAgent ? null : "Unavailable for this key"}>
                <Switch
                  checked={info.inAgent}
                  pending={store.isPending(info.name, "agent")}
                  disabled={!canUseAgent}
                  label={`${info.inAgent ? "Remove from" : "Add to"} ssh-agent`}
                  onChange={() => onToggleAgent(info)}
                />
              </Tooltip>
            }
          />
        </div>

        {/* Public key */}
        <Section
          title="Public key"
          action={
            info.publicKey ? (
              <CopyButton
                text={info.publicKey}
                variant="primary"
                size="sm"
                label="Copy public key"
                copiedLabel="Copied"
              />
            ) : null
          }
        >
          {info.publicKey ? (
            <pre className="selectable scroller max-h-24 rounded-md border border-line bg-sunken p-2.5 font-mono text-[10.5px] leading-[1.6] break-all whitespace-pre-wrap text-muted">
              {info.publicKey}
            </pre>
          ) : (
            <Unavailable>No public key on disk.</Unavailable>
          )}
        </Section>

        {/* Fingerprint */}
        <Section
          title="Fingerprint"
          action={
            info.fingerprint ? (
              <CopyButton
                iconOnly
                size="sm"
                text={info.fingerprint}
                label="Copy fingerprint"
                copiedLabel="Fingerprint copied"
              />
            ) : null
          }
        >
          {info.fingerprint ? (
            <p className="selectable font-mono text-[11px] leading-[1.6] break-all text-text">
              {info.fingerprint}
            </p>
          ) : (
            <Unavailable>
              <ShieldAlert className="size-3" /> Could not be read from this file.
            </Unavailable>
          )}
        </Section>

        {/* Comment */}
        <Section title="Comment">
          <CommentEditor info={info} store={store} />
        </Section>

        {/* Hosts */}
        <Section title="Used by hosts">
          {info.usedByHosts.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {info.usedByHosts.map((host) => (
                <span
                  key={host}
                  className="selectable inline-flex items-center gap-1 rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-muted"
                >
                  <Server className="size-2.5 shrink-0 text-faint" />
                  {host}
                </span>
              ))}
            </div>
          ) : (
            <Unavailable>No Host entry in ~/.ssh/config references this key.</Unavailable>
          )}
        </Section>

        {/* Randomart */}
        {info.randomart && (
          <Section title="Randomart">
            <pre className="selectable overflow-x-auto rounded-md border border-line bg-sunken px-2 py-2 text-center font-mono text-[10px] leading-[1.25] text-muted">
              {info.randomart}
            </pre>
          </Section>
        )}

        {/* Files */}
        <Section
          title="Files"
          action={
            <IconButton label="Reveal in file manager" size="sm" onClick={() => store.reveal(info.name)}>
              <FolderOpen className="size-3.5" />
            </IconButton>
          }
        >
          <dl className="space-y-1">
            <PathRow label="Private" path={info.path} />
            <PathRow label="Public" path={info.publicPath} />
          </dl>
        </Section>

        {/* Modified */}
        <Section title="Modified" last>
          <p className="text-xs text-text">
            {relativeTime(info.modified)}
            <span className="tnum ml-1.5 text-2xs text-faint">{absoluteTime(info.modified)}</span>
          </p>
        </Section>
      </div>
    </div>
  );
}

function ToggleRow({
  icon,
  title,
  detail,
  control,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5">
      <span className="shrink-0 text-faint">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-[1.4] font-semibold text-text">{title}</p>
        <p className="text-2xs leading-[1.4] text-faint">{detail}</p>
      </div>
      {control}
    </div>
  );
}

function Section({
  title,
  action,
  children,
  last = false,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <section className={cx("px-4 py-3", !last && "border-b border-line")}>
      <div className="mb-1.5 flex h-6 items-center justify-between gap-2">
        <h3 className="label-xs">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Unavailable({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-flex items-center gap-1.5 text-2xs leading-[1.5] text-faint">{children}</p>
  );
}

function PathRow({ label, path }: { label: string; path: string | null }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-[44px] shrink-0 text-2xs text-faint">{label}</dt>
      <dd className="min-w-0 flex-1">
        {path ? (
          <span className="selectable block font-mono text-[10.5px] leading-[1.5] break-all text-muted">
            {path}
          </span>
        ) : (
          <span className="text-2xs text-faint italic">not present</span>
        )}
      </dd>
    </div>
  );
}

function CommentEditor({ info, store }: { info: KeyInfo; store: KeyStore }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(info.comment);
  const input = useRef<HTMLInputElement>(null);
  const saving = store.isPending(info.name, "comment");

  useEffect(() => {
    setDraft(info.comment);
  }, [info.comment]);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const commit = async () => {
    if (draft.trim() === info.comment) {
      setEditing(false);
      return;
    }
    const ok = await store.saveComment(info.name, draft.trim());
    if (ok) setEditing(false);
  };

  if (!editing) {
    return (
      <div className="group/comment flex items-center gap-1.5">
        <span
          className={cx(
            "min-w-0 flex-1 truncate text-xs",
            info.comment ? "selectable text-text" : "text-faint italic",
          )}
        >
          {info.comment || "No comment"}
        </span>
        <IconButton
          label="Edit comment"
          size="sm"
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100"
        >
          <Pencil className="size-3" />
        </IconButton>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <TextInput
        ref={input}
        value={draft}
        disabled={saving}
        placeholder="user@host"
        aria-label="Comment"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDraft(info.comment);
            setEditing(false);
          }
        }}
        className="h-7"
      />
      <Button size="sm" variant="primary" busy={saving} onClick={() => void commit()}>
        <Check className="size-3.5" strokeWidth={2.5} />
      </Button>
      <IconButton
        label="Cancel"
        size="sm"
        disabled={saving}
        onClick={() => {
          setDraft(info.comment);
          setEditing(false);
        }}
      >
        <X className="size-3.5" />
      </IconButton>
    </div>
  );
}
