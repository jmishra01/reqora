# Role review — Postman Environment import/export

**Target:** uncommitted working-tree diff (`src/App.svelte`, `src/components/Sidebar.svelte`,
`src/lib/importers.ts`, `src/styles.css`) — adds "Import environment JSON" / "Export environment
JSON" to the sidebar's Environments tab, mirroring the existing collection-import flow, plus a new
`--border-strong` CSS token swapped in for several hardcoded border colors.

**Roles run:** Product Manager, UX Designer, UI/Visual Designer, QA/Test Engineer (per request;
the other 19 roles in the standard review set were not run this pass).

## Summary

| Role | Findings | Highest severity |
|---|---|---|
| Product Manager | 7 | High |
| UX Designer | 7 | High |
| UI / Visual Designer | 4 | Medium |
| QA / Test Engineer | 3 (+ 6 minor observations) | High |

Deduped, verified bugs are logged in [`../BUGS.md`](../BUGS.md) as BUG-1 through BUG-16.

---

## Product Manager / Owner

1. **Secret-type variables silently downgraded to plain variables** — High. Postman's `type:
   "secret"` flag is never read on import (`src/lib/importers.ts:202`) and is hardcoded to
   `"default"` on export (`src/App.svelte` `exportEnvironment`, ~line 705). A credential Postman
   marks sensitive becomes an ordinary visible variable with no warning. → BUG-2.
2. **Multi-file import: one bad file silently aborts the whole batch, and already-parsed
   environments are left in an uncommitted, unsaved limbo** — High.
   `importEnvironmentFiles` (`src/App.svelte:346-360`) pushes into `workspace.environments` by
   reference inside the loop and only calls `commitWorkspace()` after the loop completes; a throw
   on file 2 of 3 stops everything, and file 1's environment sits mutated-but-uncommitted until an
   unrelated later action reveals it. → BUG-1.
3. **No duplicate-name detection on import** — Medium. Re-importing a same-named environment
   produces indistinguishable duplicate rows. → BUG-5.
4. **Variable `description` is captured on import but dropped on export** — Medium. Documentation
   a user relied on is silently lost on round-trip. → BUG-2 (merged with the secret-type finding;
   same root cause in `exportEnvironment`).
5. **No handling of adjacent "Globals" export files** — Low/Medium. A Postman Globals export
   (`_postman_variable_scope: "globals"`) has the identical shape and imports as an ordinary named
   Environment with no indication of the scope mismatch. → BUG-8.
6. **`accept` attribute includes a non-matching pseudo-extension** — Low. `.postman_environment`
   in the file-picker's `accept` list never matches a real file extension (real exports are
   `*.postman_environment.json`); harmless since `.json` already covers it. → BUG-15.
7. **Silent "0 useful variables" import** — Low. An environment whose every variable lacks a key
   imports as an empty environment with no warning in the success toast. → BUG-16.

## UX / Product Designer

1. **Multi-file import bug — confirmed live**: importing `good.json` + `broken.json` together
   drops `good.json`'s environment entirely from the visible/persisted state, with only a generic
   JSON-error toast and no partial-success indication. Same root cause as PM #2. → BUG-1.
2. **No duplicate-name check** — identically-named environments become indistinguishable in both
   the sidebar list and the request toolbar's environment `<select>`. → BUG-5.
3. **Imported environments can never be deleted** — High. Verified end-to-end: Collections,
   requests, and workspaces all have a "Delete" action; environments have none anywhere in the UI
   (only deleting the entire workspace removes one). This gap predates the diff but the new import
   button makes creating unwanted/duplicate/wrong environments a one-click, now-unremovable
   accident. → BUG-3.
4. **Import icon easy to mistake for "New"** — Low. The 15px `FileUp` import icon sits directly
   next to the `Plus` "new environment" icon with only a hover-only native `title` tooltip to
   disambiguate (no visible label, nothing for keyboard users tabbing through). Mirrors the
   existing Collections import affordance, so it's a consistent-but-inherited weakness. → BUG-12.
5. **Two import entry points use different labels for the same action** — Low. Toolbar button:
   "Import environment JSON"; empty-state button: "Import JSON". → BUG-13.
6. **No preview, confirmation, or import summary before data lands in the workspace** — Medium.
   Import is immediate on file selection with no review step; combined with the delete gap (#3)
   and duplicate-name gap (#2), a wrong file selection is effectively permanent and silent. → BUG-6.
7. **No visual difference between a freshly-imported environment and pre-existing ones** — Low.
   New rows land at the bottom with no highlight/scroll/auto-open; the only feedback is a toast
   that disappears in 2.2s with no history. → BUG-14.

## UI / Visual Designer

1. **Environment-only header buttons leak into the empty History tab** — Medium. Verified in
   `src/components/Sidebar.svelte:139-151`: the branch chain is
   `{#if history && history.length} ... {:else if collections} ... {:else} ...environment
   buttons... {/if}`. The final `{:else}` is meant for the Environments tab only, but also catches
   History whenever it's empty, rendering "Import environment JSON" and "New environment" (plus
   the hidden file input) under the "HISTORY" heading. Pre-existing for the "New environment"
   button; this diff compounds it by adding the import control too. → BUG-4.
2. **Two different focus-ring visual languages now coexist** — Low/Medium.
   `.url-input-wrap:focus-within` (styles.css:165) now uses a soft 3px `--accent-soft` ring, while
   `.kv-row > input:focus` (styles.css:189) keeps a hard 1px inset `var(--accent)` box-shadow with
   no softening — both edited in this diff but not reconciled. → BUG-9.
3. **`.custom-check` checkbox border missed the `--border-strong` migration** — Low.
   `styles.css:190` still hardcodes `border: 1px solid #4a4e56` while every sibling border rule
   touched by this diff now uses `var(--border-strong)`; most visible in `.light` theme, where the
   checkbox border no longer matches any other "strong border" element. → BUG-10.
4. **`.environment-row` gap (9px → 4px) is now tighter than sibling `.history-row` (7px)** — Low.
   The new export icon sits only 4px from the trailing chevron, visibly cramped compared to the
   sibling row type that shares the same base rule. → BUG-11.

   Verified and ruled out (not findings): `--border-strong` is defined for every theme; row hover
   still applies to the now-`<div>` `.environment-row`; the 14px export icon matches its true
   siblings (other in-row action icons are also 14px); keyboard focus-visible works correctly on
   the new buttons.

## QA / Test Engineer

Ran `npm run check` and `npm run build` (both clean), fuzz-tested `parsePostmanEnvironment` with
~22 edge cases via a throwaway harness, and drove the real running app.

1. **Multi-file import: a later file's error silently leaves an earlier file's environment
   "ghosted" in memory, unsaved and invisible, until an unrelated action reveals it** — High.
   Reproduced end-to-end with 3 files (`fileA.json` valid, `fileB.json` malformed, `fileC.json`
   valid): after the failed import, `localStorage` confirms `environments: []`, but opening "+ New
   environment" shows the default name "Environment 2" — proof `fileA`'s environment already
   exists in memory. Saving that reveals "Env A (good)" appearing out of nowhere. `fileC.json` is
   never attempted at all. → BUG-1.
2. **Export silently turns a "secret" variable into a "default" one, and drops `description`** —
   High. Captured exact before/after JSON: `api_key` (`type: "secret"`) round-trips as
   `type: "default"`; `with_desc`'s `description` field vanishes entirely. → BUG-2.
3. **Export filename collapses to a single dash for non-Latin/emoji-only environment names** —
   Low/Medium. `"🎉🎉".replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'environment'` → `"-"`; two such
   environments would overwrite each other's downloaded file. → BUG-7.

Minor observations (not filed as standalone High/Medium bugs): non-string `key`/`value` entries
are silently coerced/dropped; duplicate keys across `values` are kept as separate rows with no
de-dup warning; Postman "Globals" exports are silently accepted as a plain Environment (same as PM
#5 → BUG-8); a whitespace-only `key` passes the truthy filter and imports as a real row → BUG-16;
a 10,000-variable file parses in ~14ms (no performance concern).
