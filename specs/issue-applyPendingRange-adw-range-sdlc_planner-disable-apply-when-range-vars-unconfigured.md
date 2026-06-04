# Bug: Apply button silently fails when Range Start / Range End variables not configured

## Metadata
issue_number: `[applyPendingRange]`
adw_id: `range`
issue_json: `function`

## Bug Description

In Between mode on the live deployment (`nab-au.domo.com`, design `4896fd53-0232-42d3-b31b-7be12b50e6ed`), the customer:

1. Toggled to Between mode.
2. Picked two dates on the calendar (both endpoints highlighted, pill showed `YYYY – MMM → YYYY – MMM (unapplied)`).
3. Clicked `Apply`.

Nothing visible happened. The browser console logged exactly one line from our code:

```
index-BJVFdReK.js:48 [applyPendingRange] range function IDs not configured
```

That message is the `console.warn` inside `applyPendingRange()` (App.tsx `~line 460`) firing because `rangeStartFnIdRef.current === null || rangeEndFnIdRef.current === null`. The customer doesn't have two date-typed page variables bound yet (their App Studio page has only the original `vTillSelectedMonth` variable / functionId `131272`, bound to the Single slot). The guard correctly refused to fire `domo.requestVariablesUpdate`, but the user never saw any UI feedback — no toast, no inline error, the Apply button simply absorbed the click. From the user's perspective, the feature is broken.

The pre-existing warn banner ("Configure Range Start + Range End in Settings to enable Between mode") *does* render — but it disappears when the Settings panel is open, has no call-to-action button, and is small/dismissible in the visual hierarchy.

Expected behaviour: clicking dates and Apply in an unconfigured Between mode should give clear, actionable, visible feedback that points the user at Settings, not a silent console warn.

## Problem Statement

The Apply button is enabled (and therefore clickable) when the pending range is complete + dirty even if the user has not yet bound `rangeStartFunctionId` and `rangeEndFunctionId` in Settings. Clicking it produces no visible response, only a developer-targeted console warning. Users have no way to discover what went wrong without DevTools.

## Solution Statement

Three surgical changes in `app/client/src/App.tsx`:

1. **Gate Apply button on `betweenConfigured`** — disable Apply (in addition to the existing `!rangeIsDirty || !pendingRangeComplete` guard) when both range function IDs are not bound. Provide an explanatory `title` attribute the user can hover for context.
2. **Make the warn banner prominent + actionable** — keep the existing banner text but render it inside the toolbar area (always visible in Between mode when unconfigured, even when Settings is closed), restyle as a clearly orange callout, and add an inline "Open Settings" button that flips `setShowSettings(true)` on click.
3. **Show a visible inline error on the rare case Apply still fires unconfigured** — if `applyPendingRange()` runs and the refs are null, set a transient `applyError` state to a friendly string ("Range Start and Range End variables not configured. Open Settings to bind them."), render it next to the toolbar pill in red for ~5 seconds, then clear it. This belt-and-braces handles edge cases like keyboard `Enter` firing before React disables the button on the same tick.

No data-model changes, no AppDB schema changes, no new dependencies.

## Steps to Reproduce

1. Open `https://nab-au.domo.com/app-studio/466965973/pages/1128411643` (any App Studio page with the brick where only one date variable is currently bound — the existing Single slot).
2. Hard-refresh.
3. Click `Between` in the brick's mode toggle.
4. Click any in-data date on the calendar. Click a second in-data date.
5. Click `Apply` (button is enabled because the pending range is complete + dirty).
6. Observe: nothing changes in the brick or downstream cards. Open DevTools console. Observe `[applyPendingRange] range function IDs not configured`.

## Root Cause Analysis

Two interacting issues:

1. **Apply enable state is incomplete.** `App.tsx` renders Apply with `disabled={!rangeIsDirty || !pendingRangeComplete}`. The third precondition — `betweenConfigured` — is enforced inside `applyPendingRange()` via an early-return guard but is not reflected in the button's `disabled` attribute. So the button looks live, accepts the click, and silently no-ops.
2. **Configuration warn is too subtle.** The warn banner (`.warn` class) is small orange text rendered above the calendar, but only when Settings is *closed*. The user can interact with the calendar grid + Apply button without ever scrolling past it. There is no in-line CTA so even users who notice the banner have to guess where to go.

Fixing only the disabled state addresses the silent-no-op symptom. Fixing only the banner addresses discoverability. Both are needed because they reinforce each other: the disabled button + hover tooltip plus a prominent CTA tells the user *what is wrong* and *exactly where to fix it*.

## Relevant Files

Use these files to fix the bug:

- `app/client/src/App.tsx` — single component holding `applyPendingRange`, the toolbar Apply button (around the `.toolbar-actions` block), the `.warn` banner render, and `betweenConfigured` derived state. All three changes happen here.
- `app/client/src/App.css` — add a new `.config-banner` style for the upgraded inline warning (orange background, padding, inline-flex with the CTA button). Add `.apply-error` style for the transient red inline message. The existing `.warn` class stays for the "no variable configured at all" empty state still used in Single mode.
- `specs/issue-at-adw-the-sdlc_planner-improve-variable-selection-ux.md` — predecessor spec where the chip-based Settings UX + Apply/Cancel was introduced. The Apply button enable logic lives there; this bug is a follow-up patch.
- `specs/issue-pending-adw-pending-sdlc_planner-between-selection-mode.md` — the original Between spec; for context only. No edits.
- `.claude/commands/ship.md` — re-publish flow once the fix is in. No edits.
- `specs/v1-iteration-yyyy-mmm-and-between.md` — outstanding customer-facing acceptance doc; cross-reference only.

### New Files

None. The fix is three small edits to `App.tsx` plus two CSS classes. The project still has no `.claude/commands/e2e/` infrastructure (the e2e file from prior specs was never created); the playwright validation will run inline via the `playwright-validator` subagent.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Tighten Apply button disabled logic in `App.tsx`

- Find the Apply button render (`<button className="btn-apply" ...>` inside `.toolbar-actions`).
- Change `disabled={!rangeIsDirty || !pendingRangeComplete}` to `disabled={!rangeIsDirty || !pendingRangeComplete || !betweenConfigured}`.
- Replace the existing `title="Apply (Enter)"` with a conditional: when `!betweenConfigured`, set the title to `"Configure Range start / Range end in Settings first"`; otherwise keep `"Apply (Enter)"`.

### 2. Tighten Enter keyboard handler

- In `onRootKeyDown` (the root `onKeyDown` handler), update the `Enter` branch to also require `betweenConfigured`. If pressing Enter would invoke a no-op, do nothing instead — don't even set `applyError`, because the user did not trigger the visible Apply button.
- Specifically: `if (e.key === 'Enter' && pendingRangeComplete && betweenConfigured)` (was `pendingRangeComplete`).

### 3. Upgrade the warn banner

- Replace the existing `{showBetweenWarn && <p className="warn">...</p>}` block with a new component named `ConfigBanner` (inline, not a separate file). Render conditions: `selectionMode === 'between' && !betweenConfigured && !showSettings`.
- Markup:
  ```tsx
  <div className="config-banner">
    <span>⚙ Range Start / Range End variables are not configured. Bind them to enable Between mode.</span>
    <button className="config-banner-cta" onClick={() => setShowSettings(true)}>Open Settings</button>
  </div>
  ```
- Add CSS for `.config-banner` in `App.css`: orange background (`#fef3c7`), 1px solid amber border (`#fcd34d`), 6px padding, 5px border-radius, `display: flex`, `justify-content: space-between`, `align-items: center`, `gap: 8px`, `font-size: 11px`, `color: #92400e`. The CTA button: brand-red background (`#ef3340`), white text, 4px 10px padding, 4px border-radius, font-size 11px, no border, cursor pointer; hover state darker (`#d62d39`).
- Remove the now-redundant `.warn` render that fires under the same condition (the old `showBetweenWarn` block). The original `.warn` style stays in the CSS file because it's still used by the "no variable configured at all" empty-state in single mode.

### 4. Add transient `applyError` state

- Add `const [applyError, setApplyError] = useState<string | null>(null);` near the other UI state.
- In `applyPendingRange`, replace the existing early-return + `console.warn` lines for the unconfigured case with:
  ```ts
  if (rangeStartFnIdRef.current === null || rangeEndFnIdRef.current === null) {
    console.warn('[applyPendingRange] range function IDs not configured');
    setApplyError('Range Start and Range End variables not configured. Open Settings to bind them.');
    setTimeout(() => setApplyError(null), 5000);
    return;
  }
  ```
- Render `applyError` next to the toolbar pill: when non-null, replace the pill's content with a red `.apply-error` span carrying the message. Click on the message dismisses immediately.
- CSS for `.apply-error`: `color: #b91c1c; font-size: 11px; cursor: pointer;`.

### 5. Manual local validation

- `bash scripts/start.sh` (or `/start`).
- Open http://localhost:5173/. Hard reload.
- Toggle Between mode. Confirm:
  - The new `.config-banner` orange callout renders prominently with the `Open Settings` button visible.
  - Clicking `Open Settings` opens the panel.
- Without configuring Range Start / End, open Settings → close again without saving anything. Pick two in-data dates. Confirm:
  - `.btn-apply` is **disabled** (greyed out).
  - Hovering shows tooltip "Configure Range start / Range end in Settings first".
- Press `Enter` with focus on the root. Confirm no `applyError` appears (because Enter handler also checks `betweenConfigured`).
- Force-fire `applyPendingRange()` from the DevTools console to simulate an edge case (`document.querySelector('.btn-apply')` won't be clickable but the function is still on the React fiber — easier: temporarily remove the `disabled` attr via DevTools, then click). Confirm the red `.apply-error` message appears for ~5 seconds and self-clears.
- Configure Range Start / Range End via the Advanced section in Settings (paste fnIds `200` and `300`). Confirm:
  - `.config-banner` disappears.
  - Apply button becomes enabled when the pending range is complete + dirty.
  - Clicking Apply (or pressing Enter) fires `window.__lastVariableUpdate` exactly as in the previous validation.

### 6. Run the Playwright validation

- Use the `playwright-validator` subagent. Prompt: navigate to http://localhost:5173/, hard-reload + clear sessionStorage, switch to Between mode, verify `.config-banner` renders with the CTA, pick two dates, verify `.btn-apply` is disabled with the configuration tooltip, click `Open Settings` to confirm the panel opens, configure fnIds via Advanced, verify the banner disappears and the button becomes enabled, click Apply, verify `window.__lastVariableUpdate` populates.

### 7. Build and publish

- `cd app/client && npm run build`. Zero errors expected.
- `cd app/client/dist && npx ryuu publish` to push to design `4896fd53-0232-42d3-b31b-7be12b50e6ed` on `nab-au.domo.com`.

### 8. Customer-side verification

- Hard-refresh the App Studio page that hosts the brick.
- Confirm the orange config banner is now visible in Between mode with the "Open Settings" CTA.
- Confirm clicking the CTA opens the Settings panel.
- Customer (or test user) is unblocked from the silent-no-op state.

### 9. Run the Validation Commands

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- `cd app/client && grep -n "betweenConfigured" src/App.tsx` — must show the new reference inside the `.btn-apply` `disabled` expression AND inside the `onRootKeyDown` Enter branch in addition to the existing usages.
- `cd app/client && grep -n "config-banner" src/App.tsx src/App.css` — must show both the JSX usage and the CSS rule.
- `cd app/client && grep -n "applyError" src/App.tsx` — must show the state declaration, the `setApplyError` call inside `applyPendingRange`, and the render site next to the toolbar pill.
- `cd app/client && grep -c "console.warn.\\[applyPendingRange" src/App.tsx` — must equal `1` (we keep the developer-targeted warn but always pair it with a user-visible message).
- `cd app/client && npx tsc --noEmit` — clean.
- `cd app/client && npm run build` — clean.
- Manual: hard reload http://localhost:5173/, toggle Between, confirm:
  - Orange `.config-banner` visible with CTA.
  - Apply button disabled until both range fnIds are bound.
  - Apply button tooltip changes between unconfigured / configured states.
  - Pressing Enter does nothing while unconfigured (no `applyError` flash).
  - After configuring + picking two dates: Apply enables; clicking fires `window.__lastVariableUpdate`.
- Playwright via `playwright-validator` subagent: same flow end-to-end, with screenshots `01-banner-visible.png`, `02-apply-disabled.png`, `03-apply-enabled.png`, `04-after-apply.png`.
- Re-publish via `cd app/client/dist && npx ryuu publish` and validate against the live customer brick on `nab-au.domo.com`.

## Notes

- The original `[applyPendingRange] range function IDs not configured` warn stays in the console for engineers / future bug reports — pairing a console-level developer message with a user-visible UI affordance is the right shape, not either / or.
- The orange amber colour palette (`#fef3c7` / `#fcd34d` / `#92400e`) matches the existing `.settings-empty` styling so the system feels consistent.
- The `setTimeout(() => setApplyError(null), 5000)` auto-clear keeps the toolbar uncluttered after the user sees the message; clicking the message also dismisses immediately.
- This bug only manifests in Between mode. Single mode's "Open settings to configure variable" warn (under `.warn`) is unaffected — it stays for the case where no Single fnId is bound either.
- No new npm dependencies. No new AppDB columns. No new App Studio variables required to deploy the fix (the customer still needs two date variables on their page to actually use Between mode, but that is a customer-side configuration step documented in the README, not part of this code fix).
- Cross-link: this fix builds on the Apply/Cancel + Enter/Esc work from `specs/issue-at-adw-the-sdlc_planner-improve-variable-selection-ux.md`. After the fix lands, push to a follow-up branch (`fix-apply-when-unconfigured`) off the current local tip so the patch can be reviewed in isolation.
