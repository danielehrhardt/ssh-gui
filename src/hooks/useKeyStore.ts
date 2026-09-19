import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorCode, errorMessage } from "../lib/api";
import type { AgentStatus, GenerateOptions, KeyInfo, RenameOutcome } from "../lib/types";
import type { ToastApi } from "../components/Toasts";

export type PendingKind = "enabled" | "agent" | "comment";

function token(name: string, kind: PendingKind): string {
  return `${name}::${kind}`;
}

export interface AgentAddResult {
  ok: boolean;
  /** The agent asked for a passphrase — prompt and retry. */
  needsPassphrase: boolean;
  message: string;
}

export interface KeyStore {
  keys: KeyInfo[];
  agent: AgentStatus | null;
  loading: boolean;
  refreshing: boolean;
  loadError: string | null;
  isPending: (name: string, kind: PendingKind) => boolean;
  refresh: () => Promise<void>;
  setEnabled: (key: KeyInfo, enabled: boolean) => Promise<void>;
  addToAgent: (name: string, passphrase?: string) => Promise<AgentAddResult>;
  removeFromAgent: (name: string) => Promise<void>;
  saveComment: (name: string, comment: string) => Promise<boolean>;
  generate: (options: GenerateOptions) => Promise<KeyInfo>;
  importKey: (sourcePath: string, name: string) => Promise<KeyInfo>;
  rename: (name: string, newName: string, updateConfig: boolean) => Promise<RenameOutcome>;
  remove: (name: string, permanent: boolean) => Promise<void>;
  reveal: (name: string) => Promise<void>;
}

export function useKeyStore(toast: ToastApi): KeyStore {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());

  const mark = useCallback((key: string, on: boolean) => {
    if (on) inFlight.current.add(key);
    else inFlight.current.delete(key);
    setPending(new Set(inFlight.current));
  }, []);

  const isPending = useCallback(
    (name: string, kind: PendingKind) => pending.has(token(name, kind)),
    [pending],
  );

  const patch = useCallback((name: string, changes: Partial<KeyInfo>) => {
    setKeys((all) => all.map((k) => (k.name === name ? { ...k, ...changes } : k)));
  }, []);

  const replace = useCallback((name: string, next: KeyInfo) => {
    setKeys((all) => all.map((k) => (k.name === name ? next : k)));
  }, []);

  const loadAgent = useCallback(async () => {
    try {
      setAgent(await api.agentStatus());
    } catch (e) {
      setAgent({ available: false, message: errorMessage(e), keys: [] });
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await api.listKeys();
      setKeys(next);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
    void loadAgent();
  }, [loadAgent]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* ── Optimistic toggles ─────────────────────────────────────────────── */

  const setEnabled = useCallback(
    async (key: KeyInfo, enabled: boolean) => {
      const id = token(key.name, "enabled");
      if (inFlight.current.has(id)) return;
      mark(id, true);
      const before = key;
      patch(key.name, { enabled, inAgent: enabled ? key.inAgent : false });
      try {
        const updated = await api.setKeyEnabled(key.name, enabled);
        replace(key.name, updated);
        toast.success(
          enabled ? `${key.name} enabled` : `${key.name} disabled`,
          enabled
            ? "ssh can use this key again."
            : "Moved to ~/.ssh/disabled, where ssh cannot see it.",
        );
        void loadAgent();
      } catch (e) {
        patch(key.name, { enabled: before.enabled, inAgent: before.inAgent });
        toast.error(`Could not ${enabled ? "enable" : "disable"} ${key.name}`, errorMessage(e));
      } finally {
        mark(id, false);
      }
    },
    [loadAgent, mark, patch, replace, toast],
  );

  const addToAgent = useCallback(
    async (name: string, passphrase?: string): Promise<AgentAddResult> => {
      const id = token(name, "agent");
      if (inFlight.current.has(id)) {
        return { ok: false, needsPassphrase: false, message: "Already working on it." };
      }
      mark(id, true);
      patch(name, { inAgent: true });
      try {
        await api.agentAdd(name, passphrase);
        toast.success(`${name} added to ssh-agent`);
        void loadAgent();
        return { ok: true, needsPassphrase: false, message: "" };
      } catch (e) {
        patch(name, { inAgent: false });
        const message = errorMessage(e);
        const needsPassphrase = errorCode(e) === "passphrase_required" && passphrase === undefined;
        if (!needsPassphrase && passphrase === undefined) {
          toast.error(`Could not add ${name} to the agent`, message);
        }
        return { ok: false, needsPassphrase, message };
      } finally {
        mark(id, false);
      }
    },
    [loadAgent, mark, patch, toast],
  );

  const removeFromAgent = useCallback(
    async (name: string) => {
      const id = token(name, "agent");
      if (inFlight.current.has(id)) return;
      mark(id, true);
      patch(name, { inAgent: false });
      try {
        await api.agentRemove(name);
        toast.success(`${name} removed from ssh-agent`);
        void loadAgent();
      } catch (e) {
        patch(name, { inAgent: true });
        toast.error(`Could not remove ${name} from the agent`, errorMessage(e));
      } finally {
        mark(id, false);
      }
    },
    [loadAgent, mark, patch, toast],
  );

  /* ── Plain mutations ────────────────────────────────────────────────── */

  const saveComment = useCallback(
    async (name: string, comment: string) => {
      const id = token(name, "comment");
      mark(id, true);
      try {
        const updated = await api.setComment(name, comment);
        replace(name, updated);
        toast.success("Comment updated");
        return true;
      } catch (e) {
        toast.error("Could not update the comment", errorMessage(e));
        return false;
      } finally {
        mark(id, false);
      }
    },
    [mark, replace, toast],
  );

  const generate = useCallback(
    async (options: GenerateOptions) => {
      const key = await api.generateKey(options);
      setKeys((all) => [...all, key]);
      void loadAgent();
      return key;
    },
    [loadAgent],
  );

  const importKey = useCallback(async (sourcePath: string, name: string) => {
    const key = await api.importKey(sourcePath, name);
    setKeys((all) => [...all, key]);
    return key;
  }, []);

  const rename = useCallback(async (name: string, newName: string, updateConfig: boolean) => {
    const outcome = await api.renameKey(name, newName, updateConfig);
    setKeys((all) => all.map((k) => (k.name === name ? outcome.key : k)));
    return outcome;
  }, []);

  const remove = useCallback(async (name: string, permanent: boolean) => {
    await api.deleteKey(name, permanent);
    setKeys((all) => all.filter((k) => k.name !== name));
  }, []);

  const reveal = useCallback(
    async (name: string) => {
      try {
        await api.revealKey(name);
      } catch (e) {
        toast.error("Could not open the file manager", errorMessage(e));
      }
    },
    [toast],
  );

  return {
    keys,
    agent,
    loading,
    refreshing,
    loadError,
    isPending,
    refresh,
    setEnabled,
    addToAgent,
    removeFromAgent,
    saveComment,
    generate,
    importKey,
    rename,
    remove,
    reveal,
  };
}
