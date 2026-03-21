import { plural } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"

export function CounterWidget({ count }: { count: number }) {
  return (
    <section>
      <h2>
        <Trans>Counter Example</Trans>
      </h2>
      <p>
        {plural(count, {
          one: "You clicked # time",
          other: "You clicked # times",
        })}
      </p>
    </section>
  )
}
