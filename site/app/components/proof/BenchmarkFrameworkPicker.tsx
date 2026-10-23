import { useId } from "react";
import { BENCHMARK_FRAMEWORKS, type BenchmarkFramework } from "~/data/framework-bench";

export function BenchmarkFrameworkPicker({
  value,
  onChange,
}: {
  value: BenchmarkFramework;
  onChange: (framework: BenchmarkFramework) => void;
}) {
  const name = useId();
  return (
    <fieldset className="mt-8">
      <legend className="micro mb-3 text-[11px] tracking-label text-gray-spec">
        Benchmark framework
      </legend>
      <div className="flex flex-wrap gap-2">
        {BENCHMARK_FRAMEWORKS.map((framework) => (
          <label key={framework.id} className="cursor-pointer">
            <input
              className="peer sr-only"
              type="radio"
              name={name}
              value={framework.id}
              checked={value === framework.id}
              onChange={() => onChange(framework.id)}
            />
            <span className="block min-h-11 border border-hair px-5 py-3 text-[14px] font-semibold peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
              {framework.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
