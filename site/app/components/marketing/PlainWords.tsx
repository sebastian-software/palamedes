/*
 * The "In plain words" aside: one question a newcomer would ask, answered
 * without jargon, placed beside the artifact or section it explains.
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
    <aside className={`border-t-2 border-accent bg-paper px-5 py-5 ${className}`}>
      <p className="micro text-[11px] tracking-label text-accent">In plain words</p>
      <p className="mt-2 text-[17px] font-bold">{question}</p>
      <p className="mt-2 text-[15.5px] leading-relaxed text-ink/80">{answer}</p>
    </aside>
  );
}
