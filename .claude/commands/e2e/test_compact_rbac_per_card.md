# E2E: compact UI + RBAC gear + per-card settings (v1.2)

Validates the v1.2 release contract:
- End user sees only the dropdown / calendar
- Admin sees the toolbar + gear
- Two card instances on the same page hold independent settings
- Variable resolution is by NAME via the registry dataset (no console snippet)

## Prereqs

- Latest v1.2 zip published to the target Domo instance (Asset Library →
  Apps → Date Selector → Upload New Version → `date-selector-1.2.0.zip`)
- An App Studio page with at least one Date variable defined on it
- A bound `variablesDataSet` registry dataset (Variable, VariableID columns)
- Two instances of the Date Selector card dropped on the page
- Test viewer who is NOT a Domo Admin and NOT the App Studio app owner

## Steps

### 1. End-user view (non-admin, non-owner)
- Open the published page as the non-admin viewer.
- Expect: only the dropdown (or calendar, depending on the saved view) is
  visible. No List / Calendar / gear icons. No `selected-display` label.
- Pick a date from the dropdown.
- Expect: cards on the page filtered by the configured variable refresh.
- Capture screenshot → `docs/img/05-end-user-view.png`.

### 2. Admin view — same card
- Sign in as a Domo Admin OR the App Studio app owner. Open the same page.
- Expect: toolbar visible with List, Calendar, gear (⚙) icons. No
  `selected-display` chip in the toolbar.
- Click the gear.
- Expect: settings panel opens. Variable name input + Default view radio +
  Date format select are visible. The "Discover variable IDs" console
  snippet block is NOT present. Legacy numeric ID input is hidden behind a
  collapsed `Advanced — legacy numeric variable ID` disclosure.
- Capture screenshot → `docs/img/02-settings-panel.png` (replaces v1.1 image).

### 3. Configure Card A
- Type a variable name into the Variable name field (autocomplete from
  registry). Pick one.
- Change Date format to `YYYY-MMM`.
- Set Default view → List.
- Confirm the bottom status line reads
  `Admin · Card <8-char-id> · driving <variableName>`.

### 4. Configure Card B (different instance, same page)
- Click into the second Date Selector card on the page. Open its gear.
- Verify the inputs are EMPTY (Card B has its own AppDB doc set; Card A's
  configuration does NOT bleed across).
- Configure Card B with a different variable name and Date format
  (`YYYY-MM-DD`).
- Save.

### 5. Reload + verify independence
- Reload the page.
- Expect: Card A retains its variable + `YYYY-MMM` format + List view.
  Card B retains its different variable + `YYYY-MM-DD` format.
- Capture screenshot of both cards → `docs/img/06-two-cards-independent.png`.

### 6. Variable update fires correctly
- Pick a date in Card A.
- Open browser DevTools → Network tab. Re-pick a different date.
- Expect: a request to `requestVariablesUpdate` carrying the functionId
  RESOLVED FROM THE REGISTRY (not the legacy hardcoded `131272`).
- Verify the cards filtered by that variable re-render.

### 7. Registry empty path
- Temporarily unbind the `variablesDataSet` dataset on Card A (designer →
  data bindings → clear). Reload the card.
- Open the gear.
- Expect: the Variable name autocomplete shows no suggestions; the
  Advanced disclosure can be expanded to enter a numeric `functionId` as
  fallback.
- Re-bind the dataset to restore the registry path.

## Pass / fail

PASS: all 7 steps complete without falling back to the dev console; both
cards remain independent across reload; the legacy snippet block is absent.

FAIL: gear icon visible to non-admin; settings change on Card A modifies
Card B; numeric `131272` appears in the variable update payload despite a
named registry mapping.
