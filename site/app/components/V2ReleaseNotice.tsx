export function V2ReleaseNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[13px] leading-relaxed text-ink/75 ${className}`}>
      <strong className="font-semibold">Palamedes 2.0 is out.</strong>{" "}
      <a
        href="/docs/release-notes-v2"
        className="text-accent underline underline-offset-4 hover:text-ink"
      >
        Read the release notes
      </a>
      .
    </p>
  );
}
