export function BenchmarkVersion({ version }: { version: string }) {
  return (
    <span
      data-tool-version={version}
      className="inline-block whitespace-nowrap text-[12px] font-normal text-gray-spec"
    >
      v{version}
    </span>
  );
}
