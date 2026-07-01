# E2E: Page-filter emission (v1.3)

Validate that the Date Selector brick emits `domo.filterContainer` on date
pick and that downstream cards on the same App Studio page refresh.

## Preconditions
- `date-selector-1.3.0.zip` uploaded to `nab-au.domo.com` (design id
  `4896fd53-0232-42d3-b31b-7be12b50e6ed`).
- Test page: `https://nab-au.domo.com/app-studio/1292970502/pages/1611752341`.
- At least one card on the page filtered by the `Date` column of dataset
  `sampleData` (or the equivalent shared dataset).

## Steps

1. **Load page as admin.** Confirm gear icon visible in toolbar; dropdown
   default view.
2. **Open gear panel.** Confirm three new controls visible: `Filter
   column`, `Filter operator`, `Data type`. No Variable name, no Variable
   ID, no Detected list, no discovery snippet.
3. **Pick column.** Filter column dropdown lists `sampleData` columns.
   Pick `Date`. Confirm status line reads `filter=Date EQUALS`.
4. **Pick date.** Close gear. Pick a date from the dropdown. In DevTools
   Network / iframe protocol tab confirm a `filterContainer` message
   emitted with payload `[{column:"Date", operator:"EQUALS",
   values:["<iso>"], dataType:"DATE"}]`.
5. **Downstream card refresh.** Confirm the target card re-renders with
   rows narrowed to the picked date.
6. **Second brick, independent config.** Add a second Date Selector card
   to the same page. Configure it with a different filter column. Confirm
   both AppDB config docs coexist (query the collection; two docs, distinct
   `cardId` values).
7. **Reload.** Refresh the page. Confirm brick rehydrates the last picked
   date AND re-emits the filter payload (target card stays filtered
   without any manual re-click).
8. **External filter round-trip.** Set the same `Date` column filter from
   another card / page filter. Confirm this brick's dropdown reflects the
   externally-set date via the `onFiltersUpdate` listener.
9. **End-user role.** Toggle role to user (or view as non-admin). Confirm
   gear icon hidden; dropdown still functional; filter emission works.

## Pass criteria
Every step above completes without console errors and every expected UI /
network artefact appears.
