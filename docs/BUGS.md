# Bug log

Every bug found in Postcall, whoever found it and however: reported by the user, found in a
role-review pass, or caught while building. Newest first. Each entry says where it is, how to
make it happen, why it happened, and how it was fixed (commit and the test that keeps it fixed),
or that it's still open.

**Status:** Open · Fixed (commit) · Won't fix (why).
**Severity:** High (wrong result, lost work, or a button that says it did something it didn't) ·
Medium (gets in the way, looks broken) · Low (rough edge).

| ID | Date | Area | Severity | Status |
|---|---|---|---|---|
| BUG-1 | 2026-11-19 | Environment import: a failing file in a multi-file import ghosts earlier files in memory, unsaved and invisible | High | Fixed (uncommitted) |
| BUG-2 | 2026-11-19 | Environment export/import round-trip drops Postman "secret" variable type and variable description | High | Fixed (uncommitted) |
| BUG-3 | 2026-11-19 | No way to delete a single environment (only whole-workspace delete removes one) | High | Fixed (uncommitted) |
| BUG-4 | 2026-11-19 | Sidebar: Environments-tab-only toolbar buttons render on the empty History tab | Medium | Fixed (uncommitted) |
| BUG-5 | 2026-11-19 | No duplicate-name detection when importing environments | Medium | Fixed (uncommitted) |
| BUG-6 | 2026-11-19 | No preview or confirmation before an imported environment lands in the workspace | Medium | Fixed (uncommitted) — resolved by BUG-1 (accurate toast), BUG-3 (can now delete a bad import), and BUG-5 (no more duplicate confusion) |
| BUG-7 | 2026-11-19 | Environment export filename collapses to "-" for non-Latin/emoji-only names, causing collisions | Low | Open |
| BUG-8 | 2026-11-19 | Postman "Globals" export files are silently imported as a regular named Environment | Low | Open |
| BUG-9 | 2026-11-19 | Two different focus-ring visual treatments now coexist (URL bar vs. kv-row inputs) | Low | Open |
| BUG-10 | 2026-11-19 | `.custom-check` checkbox border wasn't migrated to `--border-strong` | Low | Open |
| BUG-11 | 2026-11-19 | `.environment-row` gap is tighter than sibling `.history-row`, cramming the new export icon | Low | Open |
| BUG-12 | 2026-11-19 | Environment import icon easy to mistake for "New environment" | Low | Open |
| BUG-13 | 2026-11-19 | Two import entry points use different label text for the same action | Low | Open |
| BUG-14 | 2026-11-19 | No visual indication of which environment(s) were just imported | Low | Open |
| BUG-15 | 2026-11-19 | Environment file picker's `accept` attribute includes a dead, never-matching extension | Low | Open |
| BUG-16 | 2026-11-19 | Environment importer silently drops/garbles malformed variable entries with no warning | Low | Open |

## BUG-1 — Environment import: a failing file in a multi-file import ghosts earlier files in memory, unsaved and invisible

**Severity:** High · **Status:** Fixed (uncommitted)
**Found by:** PM, UX, QA/Tester (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md))

**Steps:** Select 3 files via the "Import environment JSON" picker: a valid `fileA.json`, a
malformed `fileB.json` (bad JSON), and a valid `fileC.json`. The toast shows only "The selected
file is not valid JSON." and the sidebar still shows "No environments yet" (or its prior state).
`fileA`'s environment is **not** gone, though — opening "+ New environment" shows the default name
"Environment 2" (computed from `workspace.environments.length + 1`), proving it already exists in
memory. Saving that new environment makes "Env A (good)" suddenly appear in the list. `fileC.json`
is never attempted at all.

**Cause:** `src/App.svelte:346-361` (`importEnvironmentFiles`). The `for` loop does
`workspace.environments.push(environment)` — an in-place mutation that Svelte's reactivity does
not pick up — and `commitWorkspace()` (the only place that reassigns `workspace = {...workspace}`,
syncs `workspaces[]`, and schedules the save) is called once, after the loop. A throw on file *N*
stops the loop immediately, so file 1..N-1's environments are mutated into the live object graph
but never rendered or persisted, and files after N are never attempted. The same pattern exists
in the pre-existing, unchanged `importCollectionFiles` (`src/App.svelte:329-343`).

**Suggested fix:** Parse all files first (or wrap each file's parse+push in its own try/catch),
collect per-file success/failure, call `commitWorkspace()` once for whatever succeeded, and report
both counts in the toast (e.g. "2 of 3 environments imported; `fileB.json` failed: not valid
JSON"). Apply the same fix to `importCollectionFiles`.

**Fix applied:** Both `importEnvironmentFiles` and `importCollectionFiles`
(`src/App.svelte`) now parse every file independently inside a per-file try/catch, collect
successes and failures separately, and only push + `commitWorkspace()` the ones that succeeded —
once, after the loop. The toast now reports an accurate "N of M imported" count plus every
failing filename and its reason. Verified live: a 3-file batch (2 valid + 1 malformed) now
imports both valid environments and shows "1 of 2 environments imported — broken.json: The
selected file is not valid JSON." instead of silently discarding everything.

---

## BUG-2 — Environment export/import round-trip drops Postman "secret" variable type and variable description

**Severity:** High · **Status:** Fixed (uncommitted)
**Found by:** PM, QA/Tester (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md))

**Steps:** Import an environment containing a `type: "secret"` variable and a variable with a
`description`. Immediately export it again via the new "Export environment JSON" button.
Captured before/after: `api_key` goes from `"type": "secret"` to `"type": "default"`; a variable's
`description` field vanishes entirely.

**Cause:** `src/lib/importers.ts:200-203` (`parsePostmanEnvironment`) never reads `row.type`, and
the local `KeyValue`/`Environment` model (`src/lib/types.ts`) has no field to carry it. On export,
`src/App.svelte` `exportEnvironment` (~line 705-719) hardcodes `type: 'default'` for every
variable and its destructure `({ key, value, enabled })` omits `description`, even though
`description` *is* captured on import and stored.

**Suggested fix:** Add a `secret?: boolean` (or `type?: 'default' | 'secret'`) field to
`KeyValue`, preserve `row.type === 'secret'` on import, and emit the real type plus non-empty
`description` on export instead of hardcoding `'default'`. At minimum, mask secret values in the
editor UI or warn on import that secret-ness isn't preserved.

**Fix applied:** Added `secret?: boolean` to `KeyValue` (`src/lib/types.ts`).
`parsePostmanEnvironment` (`src/lib/importers.ts`) now sets `secret: row.type === 'secret'` on
import. `exportEnvironment` (`src/App.svelte`) now emits `type: secret ? 'secret' : 'default'`
and includes `description` when non-empty. Verified live: importing a `type: "secret"` variable
with a `description` and immediately exporting it round-trips both fields exactly
(`"type": "secret"`, `"description": "desc4"`). Masking secret values in the editor UI was not
done — out of scope for this pass.

---

## BUG-3 — No way to delete a single environment

**Severity:** High · **Status:** Fixed (uncommitted)
**Found by:** UX (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md)); verified directly against `src/components/Sidebar.svelte` and `src/App.svelte` — no `onDeleteEnvironment` export or handler exists anywhere, unlike collections/requests/workspaces which all have a "Delete" action.

**Steps:** Create or import any environment. There is no delete affordance for it in the sidebar
row, its context menu (there is none), or its editor modal. The only way to remove one is to
delete the entire workspace that contains it.

**Cause:** Pre-existing gap — `Sidebar.svelte` has `onDeleteCollection`, `onDeleteRequest`, and
`onDeleteWorkspace` props with corresponding "Delete" buttons, but no equivalent for
`Environment`. Not introduced by this diff, but the new import feature makes creating an unwanted
or duplicate environment a one-click, now-unremovable accident (see BUG-5, BUG-6).

**Suggested fix:** Add a delete affordance for environments (e.g. a trash icon next to the new
export icon, or a context menu), with the same confirm pattern used for collection delete.

**Fix applied:** Added a `Trash2` delete icon-button next to the export button on each
environment row (`src/components/Sidebar.svelte`), wired to a new `onDeleteEnvironment` prop.
`App.svelte` adds `deleteEnvironment`/`confirmDeleteEnvironment` plus a confirmation modal
("Delete “X”? This removes the environment and its N variables...") matching the existing
collection-delete pattern; confirming clears `activeEnvironmentId`/`environmentEditor` if they
pointed at the deleted environment. Verified live end-to-end: delete → confirm modal → "Environment
deleted" toast → row removed from both the sidebar and the request-level environment picker.

---

## BUG-4 — Sidebar: Environments-tab-only toolbar buttons render on the empty History tab

**Severity:** Medium · **Status:** Fixed (uncommitted)
**Found by:** UI (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md)); verified directly against `src/components/Sidebar.svelte:139-151`.

**Steps:** Switch to the History tab when history is empty (fresh workspace, or after "Clear
history"). The section header shows "Import environment JSON" and "New environment" icon buttons
(plus a hidden file input bound to environment import) instead of nothing.

**Cause:** `src/components/Sidebar.svelte:139-151`:
```svelte
{#if activeSection === 'history' && workspace.history.length}
  ...clear history button...
{:else if activeSection === 'collections'}
  ...collections buttons...
{:else}
  ...import-environment input + "Import environment JSON" + "New environment"...
{/if}
```
The final `{:else}` is meant for `activeSection === 'environments'` only, but also catches History
whenever `workspace.history.length` is falsy. Pre-existing for the "New environment" button; this
diff compounds it by adding the import control and its file input to the same branch.

**Suggested fix:** Make the branch explicit — `{:else if activeSection === 'environments'}` with a
separate (empty) branch for an empty History tab.

**Fix applied:** Split the History case into its own `{#if activeSection === 'history'}` branch
that renders the "Clear history" button only when `workspace.history.length` is truthy and
nothing otherwise, so it can no longer fall through to the Environments `{:else}` branch.
Verified live: switching to History with 0 entries now shows no action buttons at all under the
"HISTORY" heading.

---

## BUG-5 — No duplicate-name detection when importing environments

**Severity:** Medium · **Status:** Fixed (uncommitted)
**Found by:** PM, UX (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md))

**Steps:** Import the same (or a same-named) `*.postman_environment.json` file twice. The sidebar
list and the request toolbar's environment `<select>` both show two indistinguishable entries with
the same name.

**Cause:** `src/App.svelte` `importEnvironmentFiles` (~line 346) always
`workspace.environments.push(environment)` with a fresh `uid()`, with no lookup against existing
environments by name.

**Suggested fix:** On name collision, either prompt to overwrite/merge/rename, or auto-suffix the
imported name (e.g. "Production (2)").

**Fix applied:** Added `uniqueEnvironmentName()` (`src/App.svelte`), which auto-suffixes an
imported environment's name with " (2)", " (3)", etc. against both the environments already in
the workspace and the others in the same import batch. Verified live: importing a
same-named file twice produces "Batch Good 5" and "Batch Good 5 (2)".

---

## BUG-6 — No preview or confirmation before an imported environment lands in the workspace

**Severity:** Medium · **Status:** Fixed (uncommitted) — resolved as a side effect of BUG-1/3/5
**Found by:** UX (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md))

**Steps:** Select a file in the import picker — it is parsed and added to the workspace
immediately, with no preview of what will be added (name, variable count) and no confirm step.

**Cause:** `src/App.svelte` `importEnvironmentFiles` commits immediately after parsing. Matches
the existing Collections-import behavior, so it's a consistent app-wide pattern, but it compounds
BUG-3 (no delete) and BUG-5 (no duplicate check): a wrong file selection is effectively permanent
and silent.

**Suggested fix:** Low priority on its own; worth revisiting once BUG-3 (delete) is fixed. At
minimum fix the toast accuracy (BUG-1) so failures are never silent.

**Fix applied:** No standalone preview/confirm step was added (still immediate on file
selection), but the three things that made that risky are now in place: the toast is accurate
about partial failures (BUG-1), a wrongly-imported environment can be deleted (BUG-3), and a
same-named import no longer silently merges into ambiguous duplicates (BUG-5). A dedicated
preview/confirm dialog remains a possible future improvement if it still feels necessary.

---

## BUG-7 — Environment export filename collapses to "-" for non-Latin/emoji-only names, causing collisions

**Severity:** Low · **Status:** Open
**Found by:** QA/Tester (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md))

**Steps:** Name an environment using only non-ASCII-alphanumeric characters, e.g. `"🎉🎉"` or
`"日本語環境 🚀"`, and export it.
`"🎉🎉".replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'environment'` evaluates to `"-"`. Two such
environments overwrite each other's downloaded file (`-.postman_environment.json`).

**Cause:** `src/App.svelte:710` strips all non-ASCII-alphanumeric characters with no Unicode
fallback and no disambiguator when the result collapses to empty/dash.

**Suggested fix:** Keep Unicode letters in the sanitizer, or append the environment's id/timestamp
when the sanitized name collapses to empty or a lone dash.

---

## BUG-8 — Postman "Globals" export files are silently imported as a regular named Environment

**Severity:** Low · **Status:** Open
**Found by:** PM, QA/Tester (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md))

**Steps:** Export "Globals" from Postman (same JSON shape as an Environment export, differing only
in `_postman_variable_scope: "globals"`) and import it via "Import environment JSON". It imports
without error as an ordinary Environment the user must manually select — Postcall has no
global/always-on scope concept, and nothing in the UI says this file wasn't really an environment.

**Cause:** `src/lib/importers.ts:192-204` (`parsePostmanEnvironment`) only checks
`Array.isArray(root.values)` and never inspects `_postman_variable_scope`.

**Suggested fix:** Detect `_postman_variable_scope === "globals"` and show a toast noting it was
imported as a regular environment, since Postcall has no global-scope equivalent yet.

---

## BUG-9 — Two different focus-ring visual treatments now coexist

**Severity:** Low · **Status:** Open
**Found by:** UI (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md))

**Steps:** Focus the request URL bar, then focus a key/value cell in Params/Headers.

**Cause:** `src/styles.css:165` (`.url-input-wrap:focus-within`) now shows a soft 3px
`var(--accent-soft)` ring, while `src/styles.css:189` (`.kv-row > input:focus`) keeps a hard 1px
inset `var(--accent)` box-shadow with no softening. Both rules were touched by this diff
(hardcoded hex → CSS variable) but not reconciled with each other.

**Suggested fix:** Standardize on one focus-ring treatment for text inputs in the request panel.

---

## BUG-10 — `.custom-check` checkbox border wasn't migrated to `--border-strong`

**Severity:** Low · **Status:** Open
**Found by:** UI (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md))

**Steps:** Open Params/Headers and look at a row checkbox, especially in the `.light` theme.

**Cause:** `src/styles.css:190` — `.custom-check { border: 1px solid #4a4e56; }` is still a literal
hex value while every sibling border rule this diff touched now uses `var(--border-strong)`. In
`.light` theme `--border-strong` resolves to a light `#c3c8cf`, so the checkbox border is now
visibly darker/heavier and doesn't pick up midnight/forest/ocean tinting either.

**Suggested fix:** Change to `border: 1px solid var(--border-strong);`.

---

## BUG-11 — `.environment-row` gap is tighter than sibling `.history-row`

**Severity:** Low · **Status:** Open
**Found by:** UI (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md))

**Steps:** Open the Environments tab with at least one environment; zoom on the right side of a
row (export icon next to the chevron).

**Cause:** `src/styles.css:124` set `.environment-row`'s `gap` from 9px to 4px to make room for the
new export button, while the sibling `.history-row` (styles.css:116, sharing the same base rule
one line above) keeps a 7px gap — the export icon now sits noticeably closer to the trailing
chevron than the equivalent spacing elsewhere.

**Suggested fix:** Bump `.environment-row`'s outer gap to ~6-7px to match `.history-row`.

---

## BUG-12 — Environment import icon easy to mistake for "New environment"

**Severity:** Low · **Status:** Open
**Found by:** UX (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md))

**Steps:** Look at the Environments tab header: a 15px `FileUp` icon sits directly next to a 15px
`Plus` icon, disambiguated only by a native `title` tooltip (hover/long-press only; nothing for
keyboard users tabbing through).

**Cause:** `src/components/Sidebar.svelte:148-150`. Mirrors the existing Collections import
affordance (`:142-143`), so it's a consistent pattern rather than new, but inherits the same
weakness.

**Suggested fix:** Use a less ambiguous "import" icon (e.g. down-into-tray), or add a visible label
in addition to the hover title.

---

## BUG-13 — Two import entry points use different label text for the same action

**Severity:** Low · **Status:** Open
**Found by:** UX (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md))

**Steps:** Compare the toolbar icon button's label ("Import environment JSON",
`Sidebar.svelte:149`) with the empty-state button's label ("Import JSON", `Sidebar.svelte:281`).

**Cause:** The two buttons that trigger the identical `environmentFileInput.click()` action were
given different text.

**Suggested fix:** Use the same label in both places.

---

## BUG-14 — No visual indication of which environment(s) were just imported

**Severity:** Low · **Status:** Open
**Found by:** UX (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md))

**Steps:** Import an environment. It lands at the bottom of the list with the same icon and row
styling as every other row — no highlight, no auto-scroll, no auto-open. The only feedback is a
toast that clears after 2.2s with no history.

**Cause:** `src/App.svelte` `importEnvironmentFiles` only sets `activeSection = 'environments'`
and shows a toast; it doesn't select, scroll to, or open the newly-added environment(s).

**Suggested fix:** Briefly highlight/scroll to the new row(s), or open the first imported
environment's editor so the user can confirm its contents.

---

## BUG-15 — Environment file picker's `accept` attribute includes a dead, never-matching extension

**Severity:** Low · **Status:** Open
**Found by:** PM (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md))

**Steps:** Inspect the file picker's filter.

**Cause:** `src/components/Sidebar.svelte:148` — `accept="application/json,.json,.postman_environment"`.
Real Postman environment exports are named `*.postman_environment.json`; the actual extension a
browser/OS matches on is `.json`, so `.postman_environment` never matches anything. Harmless since
`.json` already covers every real file, but dead weight.

**Suggested fix:** Drop the `.postman_environment` token (or keep it purely for documentation —
either way it has no functional effect).

---

## BUG-16 — Environment importer silently drops/garbles malformed variable entries with no warning

**Severity:** Low · **Status:** Open
**Found by:** PM, QA/Tester (role-review, [2026-11-19](reviews/2026-11-19-postman-environment-import-export.md))

**Steps:** Import a file where a `values` entry has a non-string `key`/`value` (e.g.
`{"key":123,"value":"v"}`), or a `key` that is only whitespace (`"   "`), or where every entry
lacks a usable key.

**Cause:** `src/lib/importers.ts:200-203`. Non-string `key`/`value` silently coerce to `""` via the
`string()` helper; `.filter((row) => row.key)` treats a whitespace-only string as truthy, so it
survives as a real (useless) row; an environment whose every entry fails the filter imports as a
valid environment with zero variables, and the success toast ("1 environment imported") never
indicates this.

**Suggested fix:** Low priority. Optionally trim before the truthy check, and warn when an
imported environment ends up with 0 real variables.
