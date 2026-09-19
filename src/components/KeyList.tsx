import { useEffect, useRef } from "react";
import { FileKey2, Lock, ShieldAlert, Unlock } from "lucide-react";
import type { KeyInfo } from "../lib/types";
import { algoLabel, algoMeta, plural, shortFingerprint } from "../lib/format";
import { Badge, CopyButton, cx, IconButton, Switch, Tooltip } from "./ui";
import type { KeyStore } from "../hooks/useKeyStore";

export function KeyList({
  keys,
  selected,
  onSelect,
  store,
  agentAvailable,
  agentMessage,
  onToggleAgent,
  listRef,
}: {
  keys: KeyInfo[];
  selected: string | null;
  onSelect: (name: string) => void;
  store: KeyStore;
  agentAvailable: boolean;
  agentMessage: string | null;
  onToggleAgent: (key: KeyInfo) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="SSH keys"
      aria-activedescendant={selected ? `key-${selected}` : undefined}
      className="scroller flex-1 py-1"
    >
      {keys.map((key) => (
        <KeyRow
          key={key.name}
          info={key}
          selected={key.name === selected}
          onSelect={() => onSelect(key.name)}
          store={store}
          agentAvailable={agentAvailable}
          agentMessage={agentMessage}
          onToggleAgent={() => onToggleAgent(key)}
        />
      ))}
    </div>
  );
}

function KeyRow({
  info,
  selected,
  onSelect,
  store,
  agentAvailable,
  agentMessage,
  onToggleAgent,
}: {
  info: KeyInfo;
  selected: boolean;
  onSelect: () => void;
  store: KeyStore;
  agentAvailable: boolean;
  agentMessage: string | null;
  onToggleAgent: () => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const meta = algoMeta(info.algorithm);
  const enablePending = store.isPending(info.name, "enabled");
  const agentPending = store.isPending(info.name, "agent");
  const dim = !info.enabled;

  useEffect(() => {
    if (selected) node.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const canUseAgent = agentAvailable && info.hasPrivate && info.enabled;
  const agentTooltip = !agentAvailable
    ? (agentMessage ?? "ssh-agent is not available")
    : !info.hasPrivate
      ? "Public-only key — nothing to load"
      : !info.enabled
        ? "Enable the key first"
        : info.inAgent
          ? "Remove from ssh-agent"
          : "Add to ssh-agent";

  return (
    <div
      ref={node}
      id={`key-${info.name}`}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cx(
        "group relative flex h-[54px] items-center gap-3 px-3 transition-colors duration-150",
        selected ? "bg-accent-soft" : "hover:bg-sunken",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "absolute inset-y-0 left-0 w-[2px] transition-opacity duration-150",
          selected ? "bg-accent opacity-100" : "opacity-0",
        )}
      />

      {/* Algorithm identity */}
      <span
        className={cx(
          "flex h-[20px] w-[38px] shrink-0 items-center justify-center rounded",
          "font-mono text-[10px] font-semibold tracking-tight transition-opacity",
          dim && "opacity-55",
        )}
        style={{
          color: meta.color,
          background: `color-mix(in srgb, ${meta.color} 13%, transparent)`,
        }}
        title={algoLabel(info)}
      >
        {meta.glyph}
      </span>

      {/* Name, comment, hosts */}
      <div className={cx("min-w-0 flex-1", dim && "opacity-60")}>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] leading-[1.35] font-semibold text-text">
            {info.name}
          </span>
          {info.hasPrivate ? (
            info.encrypted ? (
              <Tooltip text="Protected by a passphrase">
                <Lock className="size-3 shrink-0 text-faint" strokeWidth={2.25} />
              </Tooltip>
            ) : (
              <Tooltip text="No passphrase — anyone with the file can use it">
                <Unlock className="size-3 shrink-0 text-warning" strokeWidth={2.25} />
              </Tooltip>
            )
          ) : null}
          {!info.hasPrivate && <Badge tone="neutral">Public only</Badge>}
          {info.format === "pem" && (
            <Badge tone="warning" title="Legacy PEM container">
              PEM
            </Badge>
          )}
          {meta.legacy && <Badge tone="warning">Legacy</Badge>}
        </div>
        <div className="flex items-center gap-1.5 text-2xs leading-[1.35] text-muted">
          <span className="truncate">
            {info.comment || <span className="text-faint italic">no comment</span>}
          </span>
          {info.usedByHosts.length > 0 && (
            <>
              <span className="text-faint">·</span>
              <span className="truncate text-faint" title={info.usedByHosts.join(", ")}>
                {info.usedByHosts.length === 1
                  ? info.usedByHosts[0]
                  : `${info.usedByHosts[0]} +${info.usedByHosts.length - 1}`}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Fingerprint */}
      <span
        className={cx(
          "hidden w-[152px] shrink-0 text-right font-mono text-[10.5px] md:block",
          dim ? "text-faint/70" : "text-faint",
        )}
        title={info.fingerprint ?? undefined}
      >
        {info.fingerprint ? (
          shortFingerprint(info.fingerprint, 6)
        ) : (
          <span className="inline-flex items-center gap-1 font-sans">
            <ShieldAlert className="size-3" /> no fingerprint
          </span>
        )}
      </span>

      {/* Controls */}
      <div className="flex shrink-0 items-center gap-0.5">
        {info.publicKey && (
          <span
            className={cx(
              "transition-opacity duration-150",
              selected
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
            )}
          >
            <CopyButton
              iconOnly
              size="sm"
              text={info.publicKey}
              label="Copy public key"
              copiedLabel="Public key copied"
            />
          </span>
        )}
        <Tooltip text={agentTooltip}>
          <IconButton
            label={info.inAgent ? "Remove from ssh-agent" : "Add to ssh-agent"}
            size="sm"
            disabled={!canUseAgent || agentPending}
            onClick={(e) => {
              e.stopPropagation();
              onToggleAgent();
            }}
            className={cx(
              info.inAgent && "text-accent hover:text-accent",
              !info.inAgent &&
                !selected &&
                "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
          >
            <FileKey2 className="size-3.5" strokeWidth={info.inAgent ? 2.5 : 2} />
          </IconButton>
        </Tooltip>
        <span className="ml-1.5">
          <Switch
            checked={info.enabled}
            pending={enablePending}
            tone="positive"
            label={`${info.enabled ? "Disable" : "Enable"} ${info.name}`}
            onChange={(next) => store.setEnabled(info, next)}
          />
        </span>
      </div>
    </div>
  );
}

/** Column captions above the list — anchors the eye at high key counts. */
export function KeyListHeader({ count, filtered }: { count: number; filtered: number }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-b border-line bg-surface-2 px-3">
      <span className="label-xs w-[38px] shrink-0">Alg</span>
      <span className="label-xs flex-1">
        {filtered === count ? plural(count, "key") : `${filtered} of ${plural(count, "key")}`}
      </span>
      <span className="label-xs hidden w-[152px] shrink-0 text-right md:block">Fingerprint</span>
      <span className="label-xs w-[96px] shrink-0 text-right">Enabled</span>
    </div>
  );
}
