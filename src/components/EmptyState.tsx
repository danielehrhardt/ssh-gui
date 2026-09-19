import { FileDown, KeyRound, Loader2, Plus, SearchX, TriangleAlert } from "lucide-react";
import { Button } from "./ui";

export function NoKeys({
  onGenerate,
  onImport,
}: {
  onGenerate: () => void;
  onImport: () => void;
}) {
  return (
    <Shell
      icon={<KeyRound className="size-5 text-accent" strokeWidth={1.75} />}
      title="No SSH keys yet"
      body="Generate one to get started, or bring an existing key in from somewhere else on this machine."
    >
      <div className="mt-4 flex items-center gap-2">
        <Button variant="primary" onClick={onGenerate}>
          <Plus className="size-3.5" strokeWidth={2.5} />
          Generate key
        </Button>
        <Button onClick={onImport}>
          <FileDown className="size-3.5" />
          Import key
        </Button>
      </div>
    </Shell>
  );
}

export function NoResults({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <Shell
      icon={<SearchX className="size-5 text-faint" strokeWidth={1.75} />}
      title="No keys match"
      body={`Nothing here for “${query}”. Search covers names, comments, fingerprints and hosts.`}
    >
      <Button className="mt-4" onClick={onClear}>
        Clear search
      </Button>
    </Shell>
  );
}

export function NoneInFilter({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <Shell
      icon={<KeyRound className="size-5 text-faint" strokeWidth={1.75} />}
      title={`No ${label.toLowerCase()} keys`}
      body="Nothing to show with this filter applied."
    >
      <Button className="mt-4" onClick={onClear}>
        Show all keys
      </Button>
    </Shell>
  );
}

export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Shell
      icon={<TriangleAlert className="size-5 text-danger" strokeWidth={1.75} />}
      title="Could not read your ssh directory"
      body={message}
    >
      <Button className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    </Shell>
  );
}

export function Loading() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-xs text-faint">
      <Loader2 className="anim-spin size-3.5" />
      Reading your ssh directory…
    </div>
  );
}

function Shell({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-10 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-line bg-surface-2">
        {icon}
      </div>
      <h2 className="text-[13px] font-semibold text-text">{title}</h2>
      <p className="mt-1 max-w-[320px] text-xs leading-[1.55] text-muted">{body}</p>
      {children}
    </div>
  );
}
