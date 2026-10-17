import { EditorialRail } from "@palamedes/site-ui";

/*
 * The "In plain words" aside: one question a newcomer would ask, answered
 * without jargon, placed beside the artifact or section it explains. It uses
 * the shared emphasis rail, so explanations read as asides, not as cards.
 */
export function PlainWords({
  question,
  answer,
  className = "",
}: {
  question: string;
  answer: string;
  className?: string;
}) {
  return (
    <EditorialRail tone="emphasis" className={className}>
      <p className="micro text-[11px] tracking-label text-accent">In plain words</p>
      <p className="mt-1.5 text-[17px] font-bold">{question}</p>
      <p className="mt-1.5 text-[15.5px] leading-relaxed text-ink/80">{answer}</p>
    </EditorialRail>
  );
}
