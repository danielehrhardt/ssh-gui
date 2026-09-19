import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  FileDown,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { api, errorMessage } from "./lib/api";
import type { AppInfo, KeyInfo } from "./lib/types";
import { matchesQuery, sortKeys, type SortKey } from "./lib/format";
import { useKeyStore } from "./hooks/useKeyStore";
import { useMediaQuery, useTheme } from "./hooks/useTheme";
import { ToastProvider, useToast } from "./components/Toasts";
import { Button, cx, IconButton, Kbd, Segmented, Tooltip } from "./components/ui";
import { KeyList, KeyListHeader } from "./components/KeyList";
import { Inspector } from "./components/Inspector";
import { StatusBar } from "./components/StatusBar";
import { LoadFailed, Loading, NoKeys, NoneInFilter, NoResults } from "./components/EmptyState";
import { GenerateDialog } from "./components/GenerateDialog";
import { ImportDialog } from "./components/ImportDialog";
import { RenameDialog } from "./components/RenameDialog";
import { DeleteDialog } from "./components/DeleteDialog";
import { PassphraseDialog } from "./components/PassphraseDialog";
import { AiCliDialog } from "./components/AiCliDialog";

type Filter = "all" | "enabled" | "disabled" | "agent";

type Modal =
  | { kind: "none" }
  | { kind: "generate" }
  | { kind: "import"; sourcePath: string }
  | { kind: "rename"; name: string }
  | { kind: "delete"; name: string }
  | { kind: "passphrase"; name: string }
  | { kind: "ai" };

export default function App() {
  return (
    <ToastProvider>
      <Workspace />
    </ToastProvider>
  );
}

function Workspace() {
  const toast = useToast();
  const store = useKeyStore(toast);
  const [theme, setTheme] = useTheme();
  const narrow = useMediaQuery("(max-width: 760px)");

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>({ kind: "none" });
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [picking, setPicking] = useState(false);

  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.appInfo().then(setInfo, () => setInfo(null));
  }, []);

  /* ── Derived lists ──────────────────────────────────────────────────── */

  const counts = useMemo(
    () => ({
      all: store.keys.length,
      enabled: store.keys.filter((k) => k.enabled).length,
      disabled: store.keys.filter((k) => !k.enabled).length,
      agent: store.keys.filter((k) => k.inAgent).length,
    }),
    [store.keys],
  );

  const visible = useMemo(() => {
    const byFilter = store.keys.filter((k) => {
      if (filter === "enabled") return k.enabled;
      if (filter === "disabled") return !k.enabled;
      if (filter === "agent") return k.inAgent;
      return true;
    });
    return sortKeys(
      byFilter.filter((k) => matchesQuery(k, query)),
      sort,
    );
  }, [store.keys, filter, query, sort]);

  const selectedKey = useMemo(
    () => store.keys.find((k) => k.name === selected) ?? null,
    [store.keys, selected],
  );

  // Keep a sane selection as the visible set changes.
  useEffect(() => {
    if (store.loading) return;
    if (selected && visible.some((k) => k.name === selected)) return;
    setSelected(visible.length > 0 ? visible[0].name : null);
  }, [visible, selected, store.loading]);

  /* ── Actions ────────────────────────────────────────────────────────── */

  const close = useCallback(() => setModal({ kind: "none" }), []);

  const toggleAgent = useCallback(
    async (key: KeyInfo) => {
      if (key.inAgent) {
        await store.removeFromAgent(key.name);
        return;
      }
      const result = await store.addToAgent(key.name);
      if (!result.ok && result.needsPassphrase) {
        setModal({ kind: "passphrase", name: key.name });
      }
    },
    [store],
  );

  const startImport = useCallback(async () => {
    if (picking) return;
    setPicking(true);
    try {
      const path = await api.pickKeyFile();
      if (path) setModal({ kind: "import", sourcePath: path });
    } catch (e) {
      toast.error("Could not open the file picker", errorMessage(e));
    } finally {
      setPicking(false);
    }
  }, [picking, toast]);

  const copySelectedPublicKey = useCallback(async () => {
    if (!selectedKey?.publicKey) return;
    try {
      await api.copyText(selectedKey.publicKey);
      toast.success(`Public key of ${selectedKey.name} copied`);
    } catch (e) {
      // Saying nothing would let the user paste whatever was on the clipboard before.
      toast.error("Could not copy the public key", errorMessage(e));
    }
  }, [selectedKey, toast]);

  const move = useCallback(
    (delta: number) => {
      if (visible.length === 0) return;
      const at = visible.findIndex((k) => k.name === selected);
      const next = at < 0 ? 0 : Math.min(visible.length - 1, Math.max(0, at + delta));
      setSelected(visible[next].name);
    },
    [visible, selected],
  );

  /* ── Refresh on focus ───────────────────────────────────────────────── */

  const refresh = store.refresh;
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  /* ── Keyboard ───────────────────────────────────────────────────────── */

  const modalOpen = modal.kind !== "none";

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;

      if (e.key === "Escape") {
        if (modalOpen) return; // the dialog handles its own Escape
        if (typing && target === search.current) {
          setQuery("");
          search.current?.blur();
          e.preventDefault();
        } else if (query) {
          setQuery("");
          e.preventDefault();
        }
        return;
      }

      if (modalOpen) return;

      if (mod && e.key.toLowerCase() === "r") {
        e.preventDefault();
        void refresh();
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
        return;
      }
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setModal({ kind: "generate" });
        return;
      }
      if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        void startImport();
        return;
      }
      if (mod && e.key.toLowerCase() === "c" && !typing) {
        if ((window.getSelection()?.toString() ?? "").length > 0) return;
        if (!selectedKey?.publicKey) return;
        e.preventDefault();
        void copySelectedPublicKey();
        return;
      }
      if (typing) return;

      // ⌘⌫ in a text field means "delete to start of line" — it must never reach this.
      if (mod && e.key === "Backspace" && selectedKey) {
        e.preventDefault();
        setModal({ kind: "delete", name: selectedKey.name });
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
        return;
      }
      // Plain Backspace is too easy to hit by accident; only Delete or ⌘⌫ (above) ask to delete.
      const bare = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (e.key === "Delete" && bare && selectedKey) {
        e.preventDefault();
        setModal({ kind: "delete", name: selectedKey.name });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, query, move, refresh, selectedKey, startImport, copySelectedPublicKey]);

  /* ── Render ─────────────────────────────────────────────────────────── */

  const renameTarget = modal.kind === "rename" ? store.keys.find((k) => k.name === modal.name) : null;
  const deleteTarget = modal.kind === "delete" ? store.keys.find((k) => k.name === modal.name) : null;
  const names = useMemo(() => store.keys.map((k) => k.name), [store.keys]);

  const body = () => {
    if (store.loading) return <Loading />;
    if (store.loadError) return <LoadFailed message={store.loadError} onRetry={() => void refresh()} />;
    if (store.keys.length === 0) {
      return <NoKeys onGenerate={() => setModal({ kind: "generate" })} onImport={() => void startImport()} />;
    }
    if (visible.length === 0) {
      if (query.trim().length > 0) return <NoResults query={query.trim()} onClear={() => setQuery("")} />;
      return (
        <NoneInFilter
          label={filter === "agent" ? "agent-loaded" : filter}
          onClear={() => setFilter("all")}
        />
      );
    }
    return (
      <>
        <KeyListHeader count={store.keys.length} filtered={visible.length} />
        <KeyList
          keys={visible}
          selected={selected}
          onSelect={setSelected}
          store={store}
          agentAvailable={store.agent?.available ?? false}
          agentMessage={store.agent?.message ?? null}
          onToggleAgent={(k) => void toggleAgent(k)}
          listRef={list}
        />
      </>
    );
  };

  const showInspector = !narrow || selectedKey !== null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      {/* Title bar */}
      <header
        data-tauri-drag-region
        className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3"
      >
        <div data-tauri-drag-region className="flex min-w-0 items-center gap-2 pr-2">
          <KeyRound className="size-4 shrink-0 text-accent" strokeWidth={2.25} />
          <span className="font-mono text-[13px] font-semibold tracking-tight text-text">
            sshkm
          </span>
        </div>

        <div data-tauri-drag-region className="h-full flex-1" />

        <Tooltip text="Refresh (⌘R)">
          <IconButton
            label="Refresh"
            onClick={() => void refresh()}
            disabled={store.refreshing}
          >
            <RefreshCw className={cx("size-3.5", store.refreshing && "anim-spin")} />
          </IconButton>
        </Tooltip>
        <Button variant="ghost" onClick={() => setModal({ kind: "ai" })}>
          <Bot className="size-3.5" />
          AI &amp; CLI
        </Button>
        <div className="mx-1 h-4 w-px bg-line" />
        <Button onClick={() => void startImport()} busy={picking}>
          {!picking && <FileDown className="size-3.5" />}
          Import
        </Button>
        <Button variant="primary" onClick={() => setModal({ kind: "generate" })}>
          <Plus className="size-3.5" strokeWidth={2.5} />
          Generate key
        </Button>
      </header>

      {/* Toolbar */}
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-3">
        <div className="relative min-w-0 flex-1 md:max-w-[320px]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <input
            ref={search}
            type="text"
            role="searchbox"
            aria-label="Search keys"
            placeholder="Search keys…"
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            className={cx(
              "h-7 w-full rounded-md border border-line bg-sunken pr-14 pl-8 text-xs text-text",
              "placeholder:text-faint transition-[border-color,box-shadow,background-color] duration-150",
              "focus:border-accent focus:bg-surface focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-soft)]",
            )}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-faint hover:text-text"
            >
              <X className="size-3" />
            </button>
          ) : (
            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
              <Kbd>/</Kbd>
            </span>
          )}
        </div>

        <Segmented
          ariaLabel="Filter keys"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "enabled", label: "Enabled", count: counts.enabled },
            { value: "disabled", label: "Disabled", count: counts.disabled },
            { value: "agent", label: "In agent", count: counts.agent },
          ]}
        />

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <label htmlFor="sort" className="label-xs hidden lg:block">
            Sort
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className={cx(
              "h-7 appearance-none rounded-md border border-line bg-sunken pr-6 pl-2 text-xs text-muted",
              "bg-[length:10px] bg-[right_6px_center] bg-no-repeat",
              "focus:border-accent focus:outline-none",
            )}
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6' fill='none' stroke='%238b8b98' stroke-width='1.5'><path d='M1 1l4 4 4-4'/></svg>\")",
            }}
          >
            <option value="name">Name</option>
            <option value="modified">Modified</option>
            <option value="algorithm">Algorithm</option>
          </select>
        </div>
      </div>

      {/* Body */}
      <main className="flex min-h-0 flex-1">
        <section
          className={cx(
            "flex min-w-0 flex-1 flex-col border-r border-line bg-surface",
            narrow && selectedKey && "hidden",
          )}
        >
          {body()}
        </section>

        {showInspector && (
          <aside
            aria-label="Key details"
            className={cx(
              "flex shrink-0 flex-col bg-surface",
              narrow ? "w-full" : "w-[344px] lg:w-[368px]",
            )}
          >
            <Inspector
              info={selectedKey}
              store={store}
              agentAvailable={store.agent?.available ?? false}
              agentMessage={store.agent?.message ?? null}
              onToggleAgent={(k) => void toggleAgent(k)}
              onRename={(k) => setModal({ kind: "rename", name: k.name })}
              onDelete={(k) => setModal({ kind: "delete", name: k.name })}
              onClose={narrow ? () => setSelected(null) : undefined}
            />
          </aside>
        )}
      </main>

      <StatusBar
        keys={store.keys}
        agent={store.agent}
        info={info}
        theme={theme}
        onTheme={setTheme}
      />

      {/* Dialogs */}
      {modal.kind === "generate" && (
        <GenerateDialog
          existingNames={names}
          onClose={close}
          onGenerate={async (options) => {
            const key = await store.generate(options);
            close();
            setSelected(key.name);
            toast.success(`${key.name} generated`, "The private key and its .pub file are ready.");
          }}
        />
      )}

      {modal.kind === "import" && (
        <ImportDialog
          sourcePath={modal.sourcePath}
          existingNames={names}
          onClose={close}
          onImport={async (sourcePath, name) => {
            const key = await store.importKey(sourcePath, name);
            close();
            setSelected(key.name);
            toast.success(`${key.name} imported`);
          }}
        />
      )}

      {modal.kind === "rename" && renameTarget && (
        <RenameDialog
          info={renameTarget}
          existingNames={names}
          onClose={close}
          onRename={async (name, newName, updateConfig) => {
            const outcome = await store.rename(name, newName, updateConfig);
            close();
            setSelected(outcome.key.name);
            toast.success(
              `Renamed to ${outcome.key.name}`,
              outcome.affectedHosts.length === 0
                ? undefined
                : outcome.configUpdated
                  ? `IdentityFile updated for ${outcome.affectedHosts.join(", ")}.` +
                    (outcome.configBackup ? ` Previous config saved as ${outcome.configBackup}.` : "")
                  : `${outcome.affectedHosts.join(", ")} still point at the old name.`,
            );
          }}
        />
      )}

      {modal.kind === "delete" && deleteTarget && (
        <DeleteDialog
          info={deleteTarget}
          onClose={close}
          onDelete={async (name, permanent) => {
            await store.remove(name, permanent);
            close();
            if (selected === name) setSelected(null);
            toast.success(
              permanent ? `${name} deleted permanently` : `${name} moved to the Trash`,
              permanent ? undefined : "You can restore it from the Trash if you need it back.",
            );
          }}
        />
      )}

      {modal.kind === "passphrase" && (
        <PassphraseDialog
          keyName={modal.name}
          onClose={close}
          onSubmit={async (passphrase) => {
            const result = await store.addToAgent(modal.name, passphrase);
            if (result.ok) {
              close();
              return null;
            }
            return result.message;
          }}
        />
      )}

      {modal.kind === "ai" && <AiCliDialog info={info} onClose={close} />}
    </div>
  );
}
