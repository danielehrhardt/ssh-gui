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

  // Responses can arrive out of order (window-focus refreshes, slow ssh-add). Each loader stamps
  // its request; only the newest stamp may write state. Mutations bump the list stamp too, so a
  // listing that was read from disk before a delete/generate can never overwrite its result.
  const listStamp = useRef(0);
  const agentStamp = useRef(0);
  const activeRefreshes = useRef(0);

  const invalidateList = useCallback(() => {
    listStamp.current += 1;
  }, []);

  const loadAgent = useCallback(async () => {
    const mine = ++agentStamp.current;
    let next: AgentStatus;
    try {
      next = await api.agentStatus();
    } catch (e) {
      next = { available: false, message: errorMessage(e), keys: [] };
    }
    if (agentStamp.current === mine) setAgent(next);
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++listStamp.current;
    activeRefreshes.current += 1;
    setRefreshing(true);
    try {
      const next = await api.listKeys();
      if (listStamp.current === mine) {
        setKeys(next);
        setLoadError(null);
      }
    } catch (e) {
      if (listStamp.current === mine) setLoadError(errorMessage(e));
    } finally {
      activeRefreshes.current -= 1;
      setRefreshing(activeRefreshes.current > 0);
      setLoading(false);
    }
    void loadAgent();
  }, [loadAgent]);

  /** Runs a mutation so that no listing started before it finished can overwrite its result. */
  const mutate = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      invalidateList();
      try {
        return await work();
      } finally {
        invalidateList();
      }
    },
    [invalidateList],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* ── Optimistic toggles ─────────────────────────────────────────────── */

  const setEnabled = useCallback(
    async (key: KeyInfo, enabled: boolean) => {
      const id = token(key.name, "enabled");
      if (inFlight.current.has(id)) return;
      mark(id, true);
      patch(key.name, { enabled, inAgent: enabled ? key.inAgent : false });
      try {
        const updated = await mutate(() => api.setKeyEnabled(key.name, enabled));
        replace(key.name, updated);
        toast.success(
          enabled ? `${key.name} enabled` : `${key.name} disabled`,
          enabled
            ? "ssh can use this key again."
            : "Moved to ~/.ssh/disabled, where ssh cannot see it.",
        );
        void loadAgent();
      } catch (e) {
        // Undo only our own guess, then ask the disk: a snapshot from before the call may be stale.
        patch(key.name, { enabled: !enabled });
        toast.error(`Could not ${enabled ? "enable" : "disable"} ${key.name}`, errorMessage(e));
        void refresh();
      } finally {
        mark(id, false);
      }
    },
    [loadAgent, mark, mutate, patch, refresh, replace, toast],
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
        await mutate(() => api.agentAdd(name, passphrase));
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
        return { ok: false, needsPassphrase, message: message || "ssh-add failed." };
      } finally {
        mark(id, false);
      }
    },
    [loadAgent, mark, mutate, patch, toast],
  );

  const removeFromAgent = useCallback(
    async (name: string) => {
      const id = token(name, "agent");
      if (inFlight.current.has(id)) return;
      mark(id, true);
      patch(name, { inAgent: false });
      try {
        await mutate(() => api.agentRemove(name));
        toast.success(`${name} removed from ssh-agent`);
        void loadAgent();
      } catch (e) {
        patch(name, { inAgent: true });
        toast.error(`Could not remove ${name} from the agent`, errorMessage(e));
        void refresh();
      } finally {
        mark(id, false);
      }
    },
    [loadAgent, mark, mutate, patch, refresh, toast],
  );

  /* ── Plain mutations ────────────────────────────────────────────────── */

  const saveComment = useCallback(
    async (name: string, comment: string) => {
      const id = token(name, "comment");
      if (inFlight.current.has(id)) return false;
      mark(id, true);
      try {
        const updated = await mutate(() => api.setComment(name, comment));
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
    [mark, mutate, replace, toast],
  );

  const generate = useCallback(
    async (options: GenerateOptions) => {
      const key = await mutate(() => api.generateKey(options));
      setKeys((all) => [...all.filter((k) => k.name !== key.name), key]);
      void loadAgent();
      return key;
    },
    [loadAgent, mutate],
  );

  const importKey = useCallback(
    async (sourcePath: string, name: string) => {
      const key = await mutate(() => api.importKey(sourcePath, name));
      setKeys((all) => [...all.filter((k) => k.name !== key.name), key]);
      return key;
    },
    [mutate],
  );

  const rename = useCallback(
    async (name: string, newName: string, updateConfig: boolean) => {
      const outcome = await mutate(() => api.renameKey(name, newName, updateConfig));
      setKeys((all) => all.map((k) => (k.name === name ? outcome.key : k)));
      return outcome;
    },
    [mutate],
  );

  const remove = useCallback(
    async (name: string, permanent: boolean) => {
      await mutate(() => api.deleteKey(name, permanent));
      setKeys((all) => all.filter((k) => k.name !== name));
      void loadAgent();
    },
    [loadAgent, mutate],
  );

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
