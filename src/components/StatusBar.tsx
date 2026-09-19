import { Monitor, Moon, Sun } from "lucide-react";
import type { AgentStatus, AppInfo, KeyInfo } from "../lib/types";
import { plural } from "../lib/format";
import { cx, Tooltip } from "./ui";
import type { ThemeChoice } from "../hooks/useTheme";

export function StatusBar({
  keys,
  agent,
  info,
  theme,
  onTheme,
}: {
  keys: KeyInfo[];
  agent: AgentStatus | null;
  info: AppInfo | null;
  theme: ThemeChoice;
  onTheme: (next: ThemeChoice) => void;
}) {
  const enabled = keys.filter((k) => k.enabled).length;
  const loaded = agent?.keys.length ?? 0;
  const available = agent?.available ?? false;

  return (
    <footer className="flex h-[26px] shrink-0 items-center gap-3 border-t border-line bg-surface-2 px-3">
      <span className="tnum shrink-0 text-2xs text-faint">
        {plural(keys.length, "key")} · {enabled} enabled
      </span>

      <Tooltip
        side="top"
        text={
          agent
            ? available
              ? `ssh-agent is running with ${plural(loaded, "key")} loaded`
              : (agent.message ?? "ssh-agent is not reachable")
            : "Checking ssh-agent…"
        }
      >
        <span className="flex shrink-0 items-center gap-1.5 text-2xs">
          <span
            aria-hidden
            className={cx(
              "size-1.5 rounded-full",
              agent === null ? "bg-faint" : available ? "bg-positive" : "bg-warning",
            )}
          />
          <span className={available ? "text-muted" : "text-warning"}>
            {agent === null
              ? "ssh-agent…"
              : available
                ? `ssh-agent · ${loaded} loaded`
                : "ssh-agent unavailable"}
          </span>
        </span>
      </Tooltip>

      {info && (
        <span className="hidden min-w-0 flex-1 truncate font-mono text-2xs text-faint md:block">
          {info.sshDir}
        </span>
      )}
      <span className="flex-1 md:hidden" />

      <div
        role="radiogroup"
        aria-label="Theme"
        className="flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-surface p-[1px]"
      >
        {(
          [
            ["system", Monitor, "Match system"],
            ["light", Sun, "Light"],
            ["dark", Moon, "Dark"],
          ] as const
        ).map(([value, Icon, label]) => (
          <Tooltip key={value} side="top" text={label}>
            <button
              type="button"
              role="radio"
              aria-checked={theme === value}
              aria-label={label}
              onClick={() => onTheme(value)}
              className={cx(
                "flex size-[18px] items-center justify-center rounded transition-colors duration-150",
                theme === value ? "bg-sunken text-text" : "text-faint hover:text-muted",
              )}
            >
              <Icon className="size-3" strokeWidth={2.25} />
            </button>
          </Tooltip>
        ))}
      </div>

      <span className="tnum shrink-0 font-mono text-2xs text-faint">
        v{info?.version ?? "—"}
      </span>
    </footer>
  );
}
