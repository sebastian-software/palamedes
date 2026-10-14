export function V2ReleaseNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[13px] leading-relaxed text-ink/75 ${className}`}>
      <strong className="font-semibold">2.0 preview.</strong> Try the upcoming release through the
      repository examples. Registry latest still supplies 1.x.{" "}
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
