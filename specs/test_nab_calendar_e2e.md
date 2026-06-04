# E2E Test: NAB Calendar — Date Selector Custom App

## User Story

As a Domo card viewer, I open the NAB date-selector card in local dev mode. The app loads the sample CSV, renders a calendar showing only dates that have data, lets me switch between Single and Between selection modes, and shows the correct YYYY – MMM caption format.

## Test Steps

### Step 1 — App loads
Navigate to `http://localhost:5173`. Wait for the page to fully render (no spinner visible).

**Verify:** Page does not show an error state. The `.app` container is visible.

Take screenshot: `01_app_loaded.png`

### Step 2 — Mode toggle visible
**Verify:** Two buttons labeled "Single date" and "Between" are visible (`.mode-toggle`). "Single date" is active (has red/highlighted background).

Take screenshot: `02_mode_toggle.png`

### Step 3 — Calendar renders
**Verify:** A calendar grid is visible (`.rdp-root` or `[class*="rdp"]`). Day cells are present.

Take screenshot: `03_calendar_visible.png`

### Step 4 — Caption format YYYY – MMM
**Verify:** The month caption text matches the pattern `YYYY – MMM` (e.g. `2024 – Dec`). It should contain an en-dash (–), not a hyphen (-).

Take screenshot: `04_caption_format.png`

### Step 5 — Data-available dates highlighted
**Verify:** Some day cells have a non-muted style (not fully transparent/hidden). Disabled days have reduced opacity. The calendar is not all-grey.

Take screenshot: `05_available_dates.png`

### Step 6 — Single mode: click an available date
Identify a day cell that is NOT disabled (has a clickable appearance). Click it.

**Verify:** After click, the clicked date cell appears selected (highlighted in red/accent color or shows as selected). The toolbar label updates to show the selected date in `YYYY – MMM – DD` format.

Take screenshot: `06_single_date_selected.png`

### Step 7 — Switch to Between mode
Click the "Between" button in the mode toggle.

**Verify:** The "Between" button becomes active (highlighted). Status text reads "Pick start date".

Take screenshot: `07_between_mode.png`

### Step 8 — Between mode: pick start date
Click an available day cell (first available date visible).

**Verify:** Status text changes to "Pick end date".

Take screenshot: `08_range_start_picked.png`

### Step 9 — Between mode: pick end date
Click a different available day cell that comes after the start date.

**Verify:** Status text shows the range summary format: contains "→" and "(N days)". Apply and Clear buttons are visible.

Take screenshot: `09_range_complete.png`

### Step 10 — Presets visible
**Verify:** Preset pill buttons are visible below the calendar (at minimum "All data" preset should be present since sample CSV spans 2024).

Take screenshot: `10_presets_visible.png`

### Step 11 — Clear button resets
Click the "× Clear" button.

**Verify:** Status text returns to "Pick start date". Range highlight clears from calendar.

Take screenshot: `11_range_cleared.png`

### Step 12 — Preset click stages range
Click the "All data" preset button.

**Verify:** Status text updates to show a range summary with "→" and "(N days)". Apply button is enabled (not disabled/grayed).

Take screenshot: `12_preset_applied.png`

### Step 13 — Settings panel
Click the gear icon in the toolbar.

**Verify:** Settings panel appears with three input fields: single date variable ID, range start variable ID, range end variable ID.

Take screenshot: `13_settings_panel.png`

## Success Criteria

- [ ] App loads without error
- [ ] Mode toggle shows Single / Between buttons, Single active by default
- [ ] Calendar renders with react-day-picker (`.rdp-root` present)
- [ ] Caption format matches `YYYY – MMM` with en-dash
- [ ] Available dates are visually distinct from disabled dates
- [ ] Single mode: clicking a date updates toolbar label
- [ ] Between mode: status text rotates Pick start → Pick end → range summary
- [ ] Apply and Clear buttons visible after range selected
- [ ] At least "All data" preset button present
- [ ] Clear button resets to "Pick start date"
- [ ] Settings panel has 3 variable ID inputs

## Output Format

```json
{
  "test_name": "NAB Calendar E2E",
  "status": "passed|failed",
  "screenshots": [],
  "error": null
}
```
