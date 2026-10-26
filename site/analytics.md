# Website analytics

The shared site shell loads Rybbit once on `palamedes.dev` in production builds.
The site reports initial pageviews and pathname changes. Site listeners report
semantic actions with safe properties, including actions in the same-origin fragment
demo and playback events from the Bunny film. Development, localhost builds,
and preview hostnames don't load the SDK.

## Activate the production site

The production site entry and both repository Actions variables were configured
on October 19, 2026. The installed Rybbit version is 2.6.0. Production ingestion
still needs verification after this change is deployed. Automatic initial and
SPA pageviews must be disabled before deploying this integration.

1. Open the existing Rybbit instance and select or create the `palamedes.dev`
   site. Use its script URL and site ID, not the CLI update-service site.
2. Set the repository Actions variables `PALAMEDES_RYBBIT_SCRIPT_URL` (the full
   HTTPS script URL, typically ending in `/api/script.js`) and
   `PALAMEDES_RYBBIT_SITE_ID`. These are public browser configuration, not API
   credentials. Deploy Site passes them to Vite as `VITE_RYBBIT_SCRIPT_URL`
   and `VITE_RYBBIT_SITE_ID`. Both absent means tracking stays disabled.
3. In this site's tracking settings, disable **Automatic Initial Pageview** and
   **SPA Navigation**. The shared shell calls `rybbit.pageview()` once after
   script loading and on each subsequent pathname change, including history
   navigation. Rybbit v2.6.0's SPA listener counts query/anchor-only changes as
   visits even when URL parameters are disabled. Disable **URL Parameters** too;
   the site has no hash routing. Keep these settings when upgrading Rybbit so
   automatic and site-owned pageviews don't run together.
4. Disable Rybbit's **Outbound Links**, **Button Clicks**, **Copy Events**, and
   **Form Interactions** autocapture for this site. The site listeners already
   cover those actions with stable identifiers and safe properties. Running
   both would count actions twice, and automatic copy capture includes the
   copied text. Keep Session Replay disabled for this aggregate event setup.
5. Confirm the installed script supports `window.rybbit.event(name, properties)`
   and the settings above. The installed v2.6.0 script was tested against an
   isolated ingestion sink with automatic pageviews disabled as required above.
   Reuse existing visitor exclusions. The code also honors `disable-rybbit` and `__RYBBIT_OPTOUT__`.
6. After deployment, use one controlled visit to check the homepage, a docs
   route, browser back/forward, an action, and the film. Confirm one pageview
   per actual page visit and the expected events in Rybbit. Record this live
   evidence in #1278 before closing it. The isolated browser check below does
   not prove that a real Rybbit instance accepted production events.

To exclude your own visits, run
`localStorage.setItem('disable-rybbit', 'true')` on `palamedes.dev`, then reload.
Remove that item and reload to resume tracking. The same opt-out works for a
new tab of the standalone fragment demo on this origin. CI, local tests, and
previews never need access to a production analytics key or sink.

## Interaction coverage

Every event carries `page` (pathname only). Interaction events also carry
`control` and `placement`. Site-owned controls have explicit identifiers;
generated/third-party controls use a bounded structural path without classes,
copied content, search text, input values, or localized labels. Such fallback
paths are stable within a page revision; check them when upgrading ARDO or
changing layout structure.

| Surface                                                     | Event / properties                                                  | Verification                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| All public routes, including docs, API, decisions, and blog | Site-owned initial/pathname pageview                                | Live activation: direct entry, reload, internal links, back/forward                      |
| Navigation, CTAs, downloads, outbound links                 | `link_click`, destination origin/path, external/anchor flags        | Browser check and live activation; URL queries/fragments excluded from properties        |
| Site and generated buttons                                  | `button_click`, control/placement                                   | Browser check; custom actions replace the generic event                                  |
| Quickstart and ARDO tabs                                    | `tab_select`, stable tab value/control                              | Selection observer covers pointer and keyboard activation                                |
| FAQs, transcript, tool menu                                 | `disclosure_toggle`, requested expanded state                       | Native summary activation, including keyboard-generated clicks                           |
| Code-copy buttons                                           | `code_copy`, control/placement                                      | Browser check; measures the request, not guaranteed clipboard permission                 |
| ARDO search                                                 | `search_use` once per page visit; `search_result`, safe destination | Browser check; mouse and Enter selection, no query text                                  |
| Forms and other inputs, if added                            | `form_submit`, `control_change`, control only                       | Delegated handling; no field values; password/hidden fields excluded                     |
| Homepage locale card and splitting illustration             | `demo_locale` / `demo_screen`, fixed locale/screen value            | Browser check; other demo controls use `button_click`                                    |
| Same-origin fragment demo iframe                            | `demo_interaction`, action, locale, fixed placement                 | Browser check: view and language navigation; one SDK in parent                           |
| Standalone fragment demo                                    | Same delegated events plus its own initial pageview                 | Shared bootstrap; embedded instances don't load another SDK                              |
| Reading depth                                               | `scroll_depth`, percent 25/50/75/100, once per route visit          | Browser check; user scroll input arms measurement; route/history restoration is excluded |
| Homepage film                                               | `film_open`, `video_start`, `video_progress`, `video_complete`      | Browser protocol fixture plus coverage unit tests                                        |

The public site currently has no site-wide locale picker, theme toggle, or
submission form. The homepage language card and fragment demo do have language
controls. Tab selection follows ARIA state changes, so keyboard activation
doesn't depend on a library also dispatching clicks.

Separately hosted framework examples are destinations of outbound links. This
site cannot observe their internal interactions. The same applies to a shared
Bunny player link opened away from the site: the playback bridge works only
inside the embedded iframe. Raw static downloads and JavaScript-disabled visits
don't execute the browser SDK. Blockers, network failures, and visitor opt-outs
mean these reports describe observed visits rather than all server requests.

## Video definitions and reports

Video events include `video_id`, `video_version`, and `placement`. The current
film is `b37ad483-9fee-4c09-a0ca-1c7fadc4aaee`, version `v7`, placement
`homepage-film`; v6 was `df747a2a-efb7-414e-8e67-da6a3be9654f`. Update version
metadata when replacing the film.

- `video_start`: the timeline actually advances while playing. Opening the
  dialog or a play event without advancing playback doesn't count.
- `video_progress`: 25%, 50%, and 75% of the unique timeline has played; numeric
  `percent` identifies the threshold.
- `video_complete`: an `ended` event after at least 90% unique played coverage.

Played intervals are merged locally. Replay doesn't add coverage, seeks don't
fill the skipped interval, and samples with implausible jumps or more than two
seconds between updates are discarded conservatively. Normal playback speed
changes are accounted for. Long browser suspension can undercount coverage;
this is a playback metric, not proof of attention. Only milestones are sent.
Closing/reopening the film preserves deduplication during that page visit;
navigating away and returning starts a new visit.

Use page reports for traffic and the Events report for actions. Filter video
events by the same video/version/placement and reporting period. For a cohort
completion rate, use a `video_start` → `video_complete` funnel in the installed
Rybbit version and state whether it counts visitors or sessions. Dividing raw
completion events by raw starts is an event ratio, not a unique-viewer rate;
events near reporting-period boundaries can refer to starts outside the range.
Useful site goals include reaching `/get-started`, clicking a GitHub/npm link,
and playing/completing the film. A visitor can trigger several of these.

## Verify without production traffic

Build with public test values and run the browser check from the repository root:

```sh
VITE_RYBBIT_SCRIPT_URL=https://analytics.example.test/api/script.js \
VITE_RYBBIT_SITE_ID=palamedes-test pnpm build:site
pnpm verify:site-analytics
pnpm --filter @palamedes/site test
```

The browser check serves local build files under an intercepted production
origin, replaces the SDK with an isolated event sink, and replaces Bunny with a
Player.js protocol fixture. No analytics or video requests reach production.
It checks one pageview per pathname visit, query/anchor exclusion, listener
cleanup across navigation, keyboard search selection,
deduplication, payload content, iframe locale changes, opt-out, localhost
exclusion, and blocked-SDK usability. Pure unit tests cover played-interval
merging, seeking, pause/resume, playback speed, completion, and invalid samples.

The bootstrap adds one asynchronous SDK request only on the canonical production
hostname. The video bridge uses the documented Player.js message protocol and
loads no additional SDK. The fragment demo delegates to its parent when embedded.

References: [Rybbit script](https://rybbit.com/docs/script),
[autocapture](https://rybbit.com/docs/autocapture),
[custom events](https://rybbit.com/docs/track-events),
[visitor exclusion](https://rybbit.com/docs/hiding-own-traffic),
[Bunny playback API](https://bunny.net/docs/stream/playback-api),
[Player.js protocol](https://github.com/embedly/player.js/blob/master/SPEC.rst).
