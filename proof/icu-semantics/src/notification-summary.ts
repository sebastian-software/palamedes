import { t } from "@palamedes/core/macro"

export function notificationSummary(role: "admin" | "member", count: number) {
  return t({
    message:
      "{role, select, admin {{count, plural, =0 {No pending approvals} one {# pending approval} other {# pending approvals}}} other {{count, plural, =0 {No pending tasks} one {# pending task} other {# pending tasks}}}}",
    context: "dashboard.notifications",
    comment: "Nested select and plural fixture for the checked ICU semantics proof.",
  })
}
