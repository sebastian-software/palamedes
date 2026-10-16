# ADR-029: Effective Flow Project Setup

**Status:** Accepted

**Last updated:** 2026-10-16

One tracked setup record owns the project-specific Effective Flow configuration; runtime state stays local and ignored.

## Decision

The configuration below is the single tracked Effective Flow setup for this
repository. `.effective-flow/` holds generated runtime state and is ignored.
No second setup file or local copy defines competing values.

## Context

This ADR holds this project's tracked Effective Flow configuration. `.effective-flow/` is a pure
runtime directory and completely gitignored.

## Configuration

| Key                               | Value                      |
| --------------------------------- | -------------------------- |
| review.profile                    | focused                    |
| review.autoConfirmScope           | false                      |
| review.designDecisionSources      | standard                   |
| review.validation                 | full                       |
| applyReview.defaultCommitStrategy | null                       |
| applyReview.finalValidation       | full                       |
| applyReview.stashPolicy           | interactive                |
| applyReview.worktree.baseDir      | .effective-flow/.worktrees |
| applyReview.worktree.setup        | auto                       |
| worktree.enabled                  | true                       |
| delivery.completion               | pr                         |
| delivery.baseBranch               | origin/main                |
| tracker.mode                      | remote                     |
| plan.dir                          | docs/plan                  |
| language.project                  | en                         |
| mergeGate.completion              | merge                      |

## Consequences

Project workflow changes update this table and its references together.
Runtime artifacts do not enter the decision corpus or source control.
