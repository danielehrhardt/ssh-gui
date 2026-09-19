import { Bot, ShieldCheck, Terminal } from "lucide-react";
import { Dialog } from "./Dialog";
import { Button, CopyButton, cx } from "./ui";
import type { AppInfo } from "../lib/types";

export function AiCliDialog({ info, onClose }: { info: AppInfo | null; onClose: () => void }) {
  const cli = info?.cliPath ?? "sshkm";
  const quoted = cli.includes(" ") ? `"${cli}"` : cli;

  const claudeSnippet = `claude mcp add sshkm -- ${quoted} mcp`;
  // Hand-formatted so `args` stays on one line — JSON.stringify would spread it.
  const jsonSnippet = [
    "{",
    '  "mcpServers": {',
    '    "sshkm": {',
    `      "command": ${JSON.stringify(cli)},`,
    '      "args": ["mcp"]',
    "    }",
    "  }",
    "}",
  ].join("\n");
  const examples = [
    { cmd: "sshkm list", note: "Every key with its status, one line each." },
    {
      cmd: 'sshkm generate work --comment "me@work"',
      note: "Create an Ed25519 key called work.",
    },
    { cmd: "sshkm disable old_key", note: "Park a key in ~/.ssh/disabled." },
    { cmd: "sshkm pubkey work", note: "Print the public key, ready to paste." },
  ];

  return (
    <Dialog
      title="AI & CLI"
      description="Everything this window does is also available on the command line — and to AI assistants through the built-in MCP server."
      onClose={onClose}
      // Wide enough that a typical bundled CLI path keeps the add-command on
      // one line; longer paths still wrap gracefully at a space.
      width="max-w-[640px]"
      footer={
        <>
          <span className="mr-auto font-mono text-2xs text-faint">
            sshkm {info?.version ?? "—"}
          </span>
          <Button variant="primary" onClick={onClose} data-autofocus>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 p-3">
          <ShieldCheck className="mt-px size-3.5 shrink-0 text-positive" strokeWidth={2.25} />
          <div className="min-w-0">
            <p className="text-xs leading-[1.45] font-semibold text-text">
              Private keys never leave your machine
            </p>
            <p className="mt-0.5 text-2xs leading-[1.5] text-muted">
              The MCP server only ever returns metadata and public keys — never private key bytes
              or passphrases. Deletes go to the system trash unless permanent removal is requested
              explicitly, and deleting, renaming and importing are flagged as destructive so your
              assistant asks you first.
            </p>
          </div>
        </div>

        <Block
          icon={<Bot className="size-3.5" strokeWidth={2.25} />}
          title="Claude Code"
          body="Register the MCP server once; the assistant can then list, generate, enable and disable keys for you."
        >
          <Snippet text={claudeSnippet} />
        </Block>

        <Block
          icon={<Terminal className="size-3.5" strokeWidth={2.25} />}
          title="Any other MCP client"
          body="Drop this into the client's MCP configuration file."
        >
          <Snippet text={jsonSnippet} multiline />
        </Block>

        <Block
          icon={<Terminal className="size-3.5" strokeWidth={2.25} />}
          title="Command line"
          body="The same operations, scriptable."
        >
          <div className="divide-y divide-line overflow-hidden rounded-md border border-line bg-sunken">
            {examples.map((ex) => (
              <div key={ex.cmd} className="group/ex flex items-center gap-2 px-2.5 py-1.5">
                <code className="selectable min-w-0 flex-1 truncate font-mono text-[10.5px] text-text">
                  <span className="text-faint">$ </span>
                  {ex.cmd}
                </code>
                <span className="hidden shrink-0 text-2xs text-faint sm:block">{ex.note}</span>
                <CopyButton
                  iconOnly
                  size="sm"
                  text={ex.cmd}
                  label="Copy command"
                  copiedLabel="Copied"
                  className="opacity-0 group-hover/ex:opacity-100 focus-visible:opacity-100"
                />
              </div>
            ))}
          </div>
        </Block>

        {info && (
          <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-2xs">
            <dt className="text-faint">CLI path</dt>
            <dd className="selectable font-mono break-all text-muted">
              {info.cliPath ?? "not bundled with this build — see the README to install sshkm"}
            </dd>
            <dt className="text-faint">ssh directory</dt>
            <dd className="selectable font-mono break-all text-muted">{info.sshDir}</dd>
            <dt className="text-faint">Platform</dt>
            <dd className="font-mono text-muted">{info.platform}</dd>
          </dl>
        )}
      </div>
    </Dialog>
  );
}

function Block({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-faint">{icon}</span>
        <h3 className="text-xs font-semibold text-text">{title}</h3>
      </div>
      <p className="mb-2 text-2xs leading-[1.5] text-muted">{body}</p>
      {children}
    </section>
  );
}

function Snippet({ text, multiline = false }: { text: string; multiline?: boolean }) {
  return (
    <div className="group/snip relative">
      <pre
        className={cx(
          "selectable scroller overflow-x-auto rounded-md border border-line bg-sunken",
          "py-2 pr-10 pl-2.5 font-mono text-[10.5px] leading-[1.6] text-text",
          multiline ? "max-h-40 whitespace-pre" : "whitespace-pre-wrap",
        )}
      >
        {text}
      </pre>
      <span className="absolute top-1.5 right-1.5">
        <CopyButton iconOnly size="sm" text={text} label="Copy" copiedLabel="Copied" />
      </span>
    </div>
  );
}
