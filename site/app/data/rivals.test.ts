import { describe, expect, it } from "vitest"

import { RIVALS } from "./rivals"

describe("comparison acquisition content", () => {
  it("keeps every rival page on the shared decision, outcome, evaluation and FAQ contract", () => {
    expect(RIVALS).toHaveLength(8)

    for (const rival of RIVALS) {
      expect(rival.audience).not.toHaveLength(0)
      expect(rival.pickPalamedes.length).toBeGreaterThanOrEqual(3)
      expect(rival.pickRival.length).toBeGreaterThanOrEqual(3)
      expect(rival.differences.length).toBeGreaterThanOrEqual(3)
      expect(rival.outcomeProof.href).toMatch(/^\//u)
      expect(rival.evaluation.href).toMatch(/^\//u)
      expect(rival.faq).toHaveLength(5)
      expect(rival.faq.map((entry) => entry.q).join(" ")).toMatch(
        /without replacing|one framework|catalogs|runtime|give up/u
      )
    }
  })

  it("keeps the documented Lingui migration playbook while other pages state an evaluation boundary", () => {
    const lingui = RIVALS.find((rival) => rival.slug === "lingui")
    expect(lingui?.migration?.href).toBe("/docs/migrate-from-lingui")

    for (const rival of RIVALS.filter((candidate) => candidate.slug !== "lingui")) {
      expect(rival.evaluation.body).toMatch(/no documented|reversible|small|representative/u)
    }
  })
})
