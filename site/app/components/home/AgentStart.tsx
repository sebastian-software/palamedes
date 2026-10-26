import { CopyCommand } from "~/components/CopyCommand";
import { docsHref } from "~/data/links";

/*
 * The second door into setup, for readers who work with a coding agent. The
 * skill's scope is stated beside the command so nobody expects more from it.
 */
export function AgentStart() {
  return (
    <div className="mt-4 border border-ink/15 bg-paper/80 px-6 py-5">
      <p className="micro text-[11px] tracking-label text-slate">Prefer your coding agent?</p>
      <p className="mt-2 text-[15px] leading-relaxed text-ink/85">
        Add the Palamedes skill, then ask:{" "}
        <q className="font-semibold">Use the Palamedes skill to set up translations in this app.</q>
      </p>
      <CopyCommand
        command="npx skills add sebastian-software/palamedes --skill palamedes"
        label="Add the skill"
        className="mt-4"
      />
      <p className="mt-3 text-[13px] leading-relaxed text-ink/70">
        Covers Next.js App Router and Vite + React, including Lingui migration.{" "}
        <a href={docsHref("agent-skill")} className="text-accent underline underline-offset-4">
          What the agent does
        </a>
      </p>
    </div>
  );
}
