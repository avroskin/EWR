# Arfleet RiskWatch Roadmap and Zone Logic Report

Last updated: 28/06/2026

## 1. Purpose of the Tool

Arfleet RiskWatch tracks vessel entry/exit records for risk areas used by the operations and insurance teams.

The dashboard is primarily for operations: fast visibility, editing, rotation changes, omitted calls, and voyage status.

The export side is primarily for insurance: filtered data from the dashboard must become an Excel file that can still be filtered further by vessel, charter, risk area, port, ETA/ATA, ETS/ATS, omitted calls, warnings, and notes.

The old Excel scrape/import is temporary. It was used to recover historical/current records from the legacy workbook. Once clean data and normal workflow are established, this import code should be removable without disturbing the base app.

## 2. Core Business Rules Already Established

### 2.1 Record ownership and charter freeze

- Vessel list and default charterer should come from a controlled source, currently settings/config and later possibly a clean Excel/profile file.
- User first selects risk zone/service.
- Vessel dropdown should only show vessels relevant to that selected zone.
- Charterer should auto-fill from vessel profile.
- Historical voyage records must keep the charterer saved at the time of creation/edit.
- If a vessel charter changes later, old records must not change. This is a red-line rule.

### 2.2 Date and status display

- All visible dates should be `dd/mm/yyyy`, not US `mm/dd/yyyy`.
- Port time labels:
  - ETA/ETS while estimated.
  - ATA/ATS when actual/confirmed.
- If a vessel has completed a call, the pill/card should turn green.
- If the vessel arrived but has not sailed, the pill/card should be pale orange/in-progress.
- Omitted ports must remain clearly visible, red, with an `OMIT` badge.
- Omitted ports should still preserve time data if entered, because omission timing can explain what happened.

### 2.3 Dashboard priorities

- Timeline is the most important area and should keep the largest real estate.
- Dashboard needs to show vessel name, charterer, voyage timeline, notes, warning indicator, and action/delete.
- Vessel and charterer names should dynamically fit without breaking the row.
- Notes column exists for rotation change, dry dock, vessel name changes, missing routes, etc.
- Last updated should be global/top-banner style, not repeated as a row action.
- Edit is opened by clicking the row.
- Action column only needs delete as a compact icon.

### 2.4 Warning/check rules

Current rule expectations:

- Reversed port dates: ETD/ETS before ETA/ATA should be high warning.
- Long port stay: port stay longer than 5 days should warn.
- Reversed zone dates: zone exit before zone entry should warn.
- Very long zone range currently warns after 45 days in code. This should be reviewed; user originally emphasized max 5 days for suspicious voyage/call logic, but some zone ranges may naturally be longer depending on route.
- Warning should be visible on dashboard as a small warning sign plus red row marker.
- When opening edit and correcting dates, stale warning should clear after save/reload.
- Edit modal should highlight the exact fields/port calls causing the warning.

### 2.5 Archive and service lifecycle

- Year archive logic stays.
- Operational year is finalized around 20/10 of that year and then new year/service cycle begins.
- Dashboard should stay clean by default.
- User can select older years through year filter.
- Current services/zones must be able to move to legacy once finished.
- User must also be able to open new services.
- Legacy records are read-only from dashboard.

### 2.6 Access/roles, not implemented yet

Future user model:

- Operations department: can add, edit, delete, mark legacy, open new services.
- Insurance/other users: can view dashboard and export only.
- Similar setup may be reused from Arclaim/portal project later, but not yet implemented here.

### 2.7 Backup and deployment

- App runs on spare/work laptop as local HTTP Express app.
- Server should bind to `0.0.0.0:3002` for LAN access.
- Other laptops use `http://<computer-ip>:3002`, not HTTPS.
- Daily automated backup/upload to work server is desired.
- Final version can be copied to work laptop and restored using saved data from server.

## 3. Current Risk Zones and Operational Logic

Current config contains 7 risk-zone keys:

1. `gulf_of_aden` - IMS / Gulf of Aden / HRA
2. `southwest_africa` - SW Africa / HRA
3. `mas_combined` - MAS / East Med and SW Africa / EWR + K&R
4. `black_sea` - Black Sea / EWR
5. `east_med` - East Mediterranean / EWR
6. `north_africa` - North Africa / Libya / LTS
7. `zeynep_c` - Zeynep C special/manual

Current 2026 data summary:

- MAS combined: 82 records
- IMS / Gulf of Aden: 38 records
- North Africa / Libya: 46 records
- Black Sea: 41 records
- Zeynep C: 8 records
- SW Africa: 15 records
- East Med: 19 records

## 4. Zone-by-Zone Rules

### 4.1 IMS / Hindistan / Gulf of Aden HRA

Operational meaning:

- Used for India route via IMS.
- Standard route normally includes Jeddah plus India ports such as Nhava Sheva and Mundra.
- HRA has outbound and inbound windows.

Current automatic rule:

- Anchor port: Jeddah.
- HRA outbound entry = Jeddah ETD/ETS + 14 hours.
- HRA outbound exit = outbound entry + 48 hours.
- HRA inbound entry = Jeddah ETA/ATA - 62 hours.
- HRA inbound exit = Jeddah ETA/ATA - 14 hours.

Important exception rule:

- If the usual Jeddah call is missing, do not invent HRA dates from another port such as Djibouti.
- In extreme route changes, the system should still show manual HRA outbound/inbound windows if selected by toggle.
- User must manually enter HRA outbound/inbound where the automatic Jeddah rule cannot apply.

Dashboard display:

- Show Jeddah departure as its own timeline card/window, not buried inside HRA outbound.
- Show Jeddah arrival as its own timeline card/window, not buried inside HRA inbound.
- Show HRA outbound and HRA inbound as separate timeline windows when available or manually enabled.
- If HRA dates are missing but expected, show manual-needed state rather than silently hiding the window.

Add/Edit requirements:

- Zone times must have toggles:
  - Show HRA outbound.
  - Show HRA inbound.
- If toggle is off, save blank zone times for that window.
- If toggle is on, allow manual entry even if auto-calculation fails.
- Auto-calculation may fill fields only when normal Jeddah anchor exists and relevant toggle is on.

Known data edge cases:

- GULBENIZ A had no Jeddah call and needed manual HRA handling.
- VIVIEN A and TURKON RIZE needed inbound windows displayed correctly.

### 4.2 MAS Combined / East Med + SW Africa / EWR + K&R

Operational meaning:

- Used for Middle East/East Med plus West/Southwest Africa leg under MAS.
- Port rotations are unstable and can change heavily, especially with CMA.
- Route may include Beirut, Lattakia, Tartous, Tripoli (Lebanon), Tincan, Apapa, Cotonou, Lekki.
- The important risk-zone calculation is tied to West Africa ports, not the East Med calls.

Current automatic rule:

- Formula ports: Tincan and Apapa.
- EWR entry = first ETA/ATA among formula ports - 10 hours.
- EWR exit = last ETS/ATS among formula ports + 10 hours.
- If formula ports are omitted/missing, no automatic zone calculation should be forced.

Timeline display:

- Show East Med ports and West Africa ports in sequence.
- Show omitted calls clearly in red with OMIT badge.
- Show EWR entry and EWR exit as separate zone markers/cards.
- Current UI should avoid stacked HRA/EWR lines where there is enough width.

Add/Edit requirements:

- Default ports may be suggested, but user must be able to add/delete/reorder port calls.
- User must be able to omit ports without losing the route context.
- Port calls need evenly spaced ETA/ETS/omit controls.
- Manual zone toggle should allow EWR entry/exit to be added if the formula ports are not normal.

Known data edge cases:

- MAS sheet had custom mini-headers in the legacy Excel.
- Some rows used Lekki/Cotonou instead of normal right-side port headers.
- Some rows contain notes such as vessel leaving Arkas charter.

### 4.3 SW Africa / HRA

Operational meaning:

- Current vessels go Southwest Africa through this route.
- Ports include Tincan, Apapa, Cotonou, Lekki.

Current automatic rule:

- EWR/HRA style entry = first port ETA/ATA - 10 hours.
- Exit = last port ETS/ATS + 10 hours.
- Zone event label currently configured as `EWR`, but business label says `SW Africa (HRA)`. This naming should be reviewed in rewrite so display label matches operational language.

Dashboard display:

- Show zone entry and zone exit as separate markers/cards.
- `pinExitToEnd` is currently true, meaning exit is placed at the end of the timeline.

Rewrite note:

- Decide whether the visible label should be HRA or EWR for this zone. The config name says HRA, event label says EWR.

### 4.4 Black Sea / EWR

Operational meaning:

- Used for Black Sea / Novorossiysk route.
- User also clarified Zeynep C should behave like this style when relevant, not like IMS.

Current automatic rule:

- EWR entry = first port ETA/ATA - 12 hours.
- EWR exit = last port ETS/ATS + 12 hours.
- Ports currently configured: Novorossiysk, Odessa.

Dashboard display:

- EWR entry, port call(s), EWR exit.
- Not outbound/inbound.
- Zone events are split into separate cards.

Add/Edit requirements:

- Toggle should say Show EWR entry / exit.
- User can manually add/remove EWR window if normal route logic does not fit.

Known issue:

- The old data currently mostly has Novorossiysk only.
- Odessa/Chornomorsk variants matter for Zeynep C.

### 4.5 North Africa / Libya / LTS

Operational meaning:

- Used for North Africa / Libya route.
- User referred to NAS and LTS for North Africa.
- Ports include Misurata, Tripoli (Libya), Benghazi, Al Khums / El Khoms.

Current rule:

- Config says manual.
- Zone events are disabled in config.
- Imported data often stores zoneEntry as first actual port ETA and zoneExit as last actual port ETS, but dashboard currently treats this zone differently.

Dashboard display:

- Primarily show port-call timeline.
- No automatic EWR/HRA cards unless the business decision changes.

Rewrite decision needed:

- Should LTS have visible entry/exit cards derived from first/last port dates, or should it remain port-only/manual?
- Current imported data contains zoneEntry/zoneExit for many Libya rows even though zoneEvents are disabled. The rewrite should define whether to keep these as hidden/export fields or remove/ignore them for this zone.

### 4.6 East Mediterranean / EWR

Operational meaning:

- Exists in config and data, but current operational direction says Middle East is handled via MAS.
- Ports include Tartous, Beirut, Lattakia, Tripoli (Lebanon).

Current automatic rule:

- Formula is first/last offset with 0 hours.
- Zone events disabled.

Rewrite decision needed:

- Is East Med still a live service/zone, or should it become legacy-only / hidden from normal add-new flow?
- If kept, should it remain separate from MAS or be merged fully into MAS service logic?

### 4.7 Zeynep C

Operational meaning:

- Zeynep C is a barge/special vessel.
- It is generally risk-zone free by default.
- It does not always go through risk zones.
- It needs its own risk-zone name/area field when applicable.

Current rule:

- Manual only.
- Zone events disabled by default.
- `No zone times` is checked by default when adding Zeynep C.
- If relevant ports/areas are present, user can untick/enable zone time fields manually.

Important clarification from user:

- Zeynep C should be like Black Sea, not IMS.
- It should display: EWR entry -> port call -> EWR exit.
- It must not show HRA outbound/inbound windows.
- Odessa, Odesa, Chornomorsk, Chernomorsk, Chronomork and Gulf of Aden HRA style labels may indicate zone-relevant records.

Dashboard display:

- If Zeynep C has relevant zone times, show one EWR-style window.
- If no zone times, show port call only / risk-free record.
- No automatic calculation should be forced.

Add/Edit requirements:

- Risk zone selected as Zeynep C.
- Zone/area name field visible.
- Zone times greyed out by default.
- User can untick/enable and manually enter EWR entry/exit.
- Port calls should be cleared/default-empty so user can edit freely.

## 5. Port Call Model Needed for Rewrite

Each voyage should contain ordered port-call objects:

- `port`: display name
- `eta`: estimated/actual arrival timestamp
- `etaConfirmed`: false means ETA, true means ATA
- `ets`: estimated/actual departure timestamp
- `etsConfirmed`: false means ETS/ETD, true means ATS/ATD
- `omit`: vessel did not call this port
- optional future fields:
  - `source`: manual/import/system
  - `sequence`: stable order number
  - `notes`: port-specific notes

Rules:

- Delete port call must exist in edit modal.
- Reorder/drag must exist.
- Omitted ports remain in timeline and export.
- Omitted ports can have dates/times.
- Empty port rows should not save unless they contain meaningful data.

## 6. Zone Window Model Needed for Rewrite

Current fields are:

- `zoneEntry`
- `zoneExit`
- `zoneEntryReturn`
- `zoneExitReturn`
- corresponding confirmed booleans
- calculated fields for server recalculation

Rewrite should use a cleaner internal model:

- For normal single-window zones: one zone window called `main`.
- For IMS: two zone windows called `outbound` and `inbound`.
- For Zeynep C: one manual window called `main` when enabled.

Proposed normalized shape:

```json
{
  "zoneWindows": [
    {
      "key": "main",
      "label": "EWR",
      "mode": "manual|calculated",
      "enabled": true,
      "entry": "ISO date or null",
      "entryConfirmed": false,
      "exit": "ISO date or null",
      "exitConfirmed": false,
      "calculationStatus": "ok|manual_needed|disabled|not_applicable"
    }
  ]
}
```

Compatibility layer can map old fields to this model until data migration is complete.

## 7. Export Requirements

Insurance export should use dashboard filters.

Preferred one-sheet layout:

- Vessel Name
- Charter
- HRA / K&R Area
- Port Name / Risk Zone
- Entry Time / ETA / ATA
- Exit Time / ETS / ATS
- Omitted / Called indicator
- Notes
- Check / Warning

Export should display one row per event/port call where needed, while grouping vessel/charter/area visually enough for readability.

Important export needs:

- Filterable by port name.
- Filterable by omitted/called.
- Filterable by vessel, charterer, zone/service, warning.
- Zone events and port calls should be in the same sheet if possible.
- Avoid plain-text route summary columns that cannot be filtered.

## 8. Temporary Import Code Rule

Old Excel parsing/scraping is temporary and should remain modular/removable.

Rewrite target:

- `import/legacyExcel/*` or similar separate folder.
- No dashboard/add-edit logic should depend on import parser functions.
- Import output should produce normalized voyage records only.
- Once old data work is complete, delete import folder and related route/menu without touching main app.

## 9. Recommended Rewrite Architecture

### 9.1 Shared domain modules

Create pure rule modules used by both server and front-end:

- `domain/riskZones.js`
- `domain/zoneCalculations.js`
- `domain/voyageValidation.js`
- `domain/timelineBuilder.js`
- `domain/exportRows.js`
- `domain/auditRules.js`

These should avoid direct DOM access.

### 9.2 Server responsibilities

Server should own:

- validation
- saving records
- recalculation when appropriate
- audit warning generation
- backup/export endpoints
- archive and legacy lifecycle

Server should not silently overwrite manual values unless the rule says it is safe and the field is not manually confirmed/enabled.

### 9.3 Front-end responsibilities

Front-end should own:

- form state
- showing/hiding toggles
- previewing calculated values
- timeline rendering
- user-friendly validation display

Front-end should not be the only place where business rules live.

### 9.4 Data safety

Before rewrite:

- Create full backup of `data/config.json` and `data/voyages_2026.json`.
- Add tests around the current expected examples for each zone.
- Build migration/compatibility tests for old fields to new `zoneWindows` model.

## 10. Rewrite Phases

### Phase 1 - Freeze requirements and examples

- Pick 2-3 real voyage examples per zone.
- Mark expected timeline cards for each example.
- Mark expected export rows for each example.
- Confirm unresolved decisions for SW Africa label, Libya zone display, East Med future.

### Phase 2 - Build domain rule engine

- Implement shared calculation engine.
- Rules should output zone windows/events, not mutate voyage directly.
- Support:
  - IMS Jeddah HRA rule
  - first/last offset rule
  - manual rule
  - disabled/no-zone rule
  - manual-needed fallback

### Phase 3 - Build normalized timeline model

- One timeline builder handles all zones.
- Inputs: voyage + risk zone config.
- Output: ordered timeline events.
- Timeline events include port calls, omitted calls, zone entries/exits, manual-needed cards, notes/warnings.

### Phase 4 - Rewrite Add/Edit voyage module

- One state object for form.
- One save payload builder.
- Zone toggles write to state, not directly scattered DOM fields.
- Port call add/delete/reorder/omit handled in module.
- Calculated preview updates from domain rule engine.

### Phase 5 - Rewrite dashboard renderer

- Dashboard consumes normalized timeline events.
- Remove zone-specific rendering hacks where possible.
- Keep special display labels only in config/domain layer.

### Phase 6 - Rewrite export rows

- Export rows are generated from the same normalized timeline events as dashboard.
- This ensures dashboard and insurance export tell the same story.

### Phase 7 - Modularize legacy import

- Move old Excel import/scrape into removable module.
- Keep import reports separate.
- Remove all import-only assumptions from base app.

### Phase 8 - Role/access layer

- Add operations vs insurance user mode after core logic is stable.
- Reuse portal/Arclaim pattern if appropriate.

## 11. Open Decisions Before Full Rewrite

1. SW Africa display label: should zone event label be HRA or EWR?
2. Libya/North Africa: should LTS show visible zone entry/exit, or only ports?
3. East Med: keep as active separate zone, merge into MAS, or make legacy-only?
4. Zone long-range warning: should 45-day zone warning remain, or should logic be route-specific?
5. Zeynep C Gulf of Aden records: should label be `HRA`, `EWR`, or user-entered zone/area name?
6. Port actual labels: should departure actual be shown as ATS, ATD, or keep current wording?
7. Export: should omitted calls with blank dates still export as their own rows? Recommendation: yes.

## 12. Immediate Next Step

Before rewriting all code, create a small test fixture file with example voyages for each zone and expected outputs.

Recommended fixture examples:

- IMS normal with Jeddah outbound/inbound.
- IMS missing Jeddah, manual HRA windows enabled.
- MAS normal with Tincan/Apapa.
- MAS changed rotation with omitted Apapa or only Lekki/Cotonou.
- Black Sea normal Novorossiysk.
- Libya multi-port manual/port-only.
- Zeynep C risk-free.
- Zeynep C Black-Sea-style EWR entry/port/exit.

Once these examples are accepted, the full rewrite can be done much more safely.

## 13. Confirmed Corrections From Zone Review

This section supersedes any earlier uncertain wording above.

### 13.1 Grand rules

- Omitted ports must still show their time fields.
- Omitted ports must preserve ETA/ETS or ATA/ATS if entered.
- Auto-calculation may only fill estimated/unconfirmed fields.
- Auto-calculation must never overwrite fields marked actual/confirmed.
- If the normal calculation source is missing, the system must not invent values from another unrelated port.
- Manual toggles must allow the user to enter exceptions cleanly.

### 13.2 Active zones for normal new-voyage selection

Normal users should see these active choices:

- IMS / Hindistan
- MAS
- Black Sea
- Libya / LTS
- Zeynep C

### 13.3 Hidden legacy/future zones

These should be kept in config/data, but hidden from normal new-voyage selection for now:

- SW Africa
- East Med

Reason: MAS currently covers the operational East Med + Southwest Africa route, but these may split again in the future.

### 13.4 IMS / Hindistan confirmed logic

Default port rows when IMS is selected:

1. Jeddah Departure
2. Nhava Sheva
3. Mundra
4. Jeddah Arrival

Jeddah Departure row:

- Only departure time is relevant.
- Used to calculate HRA outbound.
- HRA outbound entry = Jeddah departure + 14 hours.
- HRA outbound exit = outbound entry + 48 hours.

Jeddah Arrival row:

- Only arrival time is relevant.
- Used to calculate HRA inbound.
- HRA inbound entry = Jeddah arrival - 62 hours.
- HRA inbound exit = Jeddah arrival - 14 hours.

Important IMS behavior:

- If Jeddah departure is missing, do not calculate HRA outbound.
- If Jeddah arrival is missing, do not calculate HRA inbound.
- Do not fall back to Djibouti or any other port.
- HRA outbound and inbound windows must be manually editable by toggle.
- If any relevant Jeddah or HRA field is confirmed/actual, do not overwrite it.
- Known bug to check during rewrite: entering estimated Jeddah departure previously caused HRA times to disappear.

### 13.5 MAS confirmed logic

Default port rows when MAS is selected:

1. Beirut
2. Lattakia
3. Tincan
4. Apapa
5. Cotonou

Calculation:

- MAS includes East Med + Southwest Africa operational route.
- EWR calculation is based on the West Africa side.
- Current formula ports: Tincan and Apapa.
- EWR entry = first relevant West Africa ETA - 10 hours.
- EWR exit = last relevant West Africa ETS + 10 hours.

Important MAS behavior:

- User can delete, omit, reorder, or add ports.
- If Tincan/Apapa are omitted/missing, do not force calculation.
- If source times or EWR times are confirmed/actual, do not overwrite them.

### 13.6 Black Sea confirmed logic

Default port row when Black Sea is selected:

1. Novorossiysk

Calculation:

- EWR entry = first port ETA - 12 hours.
- EWR exit = last port ETS + 12 hours.

Important Black Sea behavior:

- Timeline display is EWR entry -> port call(s) -> EWR exit.
- No outbound/inbound split.
- User can manually add other ports such as Odessa if needed.
- Confirmed/actual values must not be overwritten.

### 13.7 Libya / LTS confirmed logic

Default port rows when Libya/LTS is selected:

1. Misurata
2. Benghazi
3. Tripoli (Libya)
4. Al Khums

Behavior:

- Port calls only.
- No visible zone entry/exit windows.
- No automatic zone calculation.
- Rotation may change, so add/delete/reorder/omit must remain flexible.

### 13.8 Zeynep C confirmed logic

Zeynep C is unique and must remain flexible.

Behavior:

- Risk-free by default.
- No automatic calculation.
- Zone times disabled/greyed by default.
- User can manually enable and edit zone/area timing if needed.
- Do not force IMS logic.
- Do not force Black Sea logic.
- It may have outbound/inbound, one window, multiple windows, one port call, multiple calls, anchored waiting, or no zone timing.
- Add/Edit must not trap the user into a fixed route shape.

## 14. Rock-Solid Rewrite Design

The rewrite should be built around a rule engine and a form-state model, not around scattered DOM edits.

### 14.1 Main principle

There should be one source of truth for voyage editing:

- The form creates a draft voyage object.
- Port rows update draftVoyage.portCalls.
- Zone toggles update draftVoyage.zoneWindows.
- The rule engine receives the draft and returns calculated suggestions.
- The UI displays suggestions, but does not silently mutate confirmed/actual fields.
- Save builds payload from the draft, not by scraping random DOM fields.

### 14.2 Proposed modules

Create these modules before rewriting UI behavior:

- public/js/voyageEditor/state.js or equivalent: draft voyage state.
- public/js/voyageEditor/rules.js: front-end preview of zone calculations.
- public/js/voyageEditor/ports.js: add/delete/reorder/omit port calls.
- public/js/voyageEditor/zoneWindows.js: HRA/EWR/manual window toggles.
- server/domain/rules.js: server-side trusted calculation engine.
- server/domain/validation.js: payload validation.
- server/domain/timeline.js: timeline event creation.
- server/domain/audit.js: warning/check logic.

If staying with simple script files, expose one namespace only, such as window.VoyageEditor, and keep internal helpers private.

### 14.3 Rule engine contract

The rule engine should be pure.

Input shape:

```json
{
  "zone": "gulf_of_aden",
  "portCalls": [],
  "zoneWindows": [],
  "confirmedPolicy": "neverOverwriteConfirmed"
}
```

Output shape:

```json
{
  "suggestions": [
    {
      "windowKey": "hra_outbound",
      "entry": "ISO or null",
      "exit": "ISO or null",
      "status": "ok|manual_needed|disabled|missing_anchor"
    }
  ],
  "messages": []
}
```

The rule engine must never directly save data and must never directly change the page.

### 14.4 Confirmed/actual overwrite policy

Implement one shared helper concept:

```js
function canApplySuggestion(field) {
  return !field.confirmed && !field.manuallyEdited;
}
```

Rules:

- Confirmed actual fields are locked from auto-fill.
- Manually edited fields should not be overwritten unless the user explicitly requests recalculation.
- Empty estimated fields can receive suggestions.
- If a source anchor is confirmed actual, the calculated output may be shown as a suggestion, but should not overwrite confirmed/manual destination fields.

### 14.5 IMS should not use duplicate plain port names internally

For IMS, avoid two identical Jeddah rows with ambiguous meaning.

Use distinct internal roles:

```json
{
  "port": "Jeddah",
  "role": "jeddah_departure",
  "visibleLabel": "Jeddah Departure",
  "arrivalEnabled": false,
  "departureEnabled": true
}
```

and

```json
{
  "port": "Jeddah",
  "role": "jeddah_arrival",
  "visibleLabel": "Jeddah Arrival",
  "arrivalEnabled": true,
  "departureEnabled": false
}
```

This avoids the current fragile situation where the code searches for one port name and cannot tell outbound/inbound intent clearly.

### 14.6 Zone windows should be normalized

Instead of relying only on fixed fields such as zoneEntryReturn, use a normalized internal structure:

```json
{
  "zoneWindows": [
    {
      "key": "hra_outbound",
      "label": "HRA Outbound",
      "kind": "hra_outbound",
      "enabled": true,
      "entry": null,
      "entryConfirmed": false,
      "exit": null,
      "exitConfirmed": false
    }
  ]
}
```

Compatibility mapping can still save/read old fields until migration is complete:

- hra_outbound.entry <-> zoneEntry
- hra_outbound.exit <-> zoneExit
- hra_inbound.entry <-> zoneEntryReturn
- hra_inbound.exit <-> zoneExitReturn

### 14.7 Timeline and export must use the same event builder

The dashboard and Excel export should not build routes separately.

One shared timeline/event builder should produce:

- port arrival event
- port departure event
- omitted port event
- zone entry event
- zone exit event
- manual-needed event
- warning event/metadata

Dashboard renders those events visually.
Export writes those events into filterable rows.

This prevents the dashboard and export from disagreeing.

### 14.8 Tests required before rewrite

Before rewriting behavior, create fixtures for:

1. IMS normal with Jeddah departure and arrival.
2. IMS missing Jeddah departure, manual outbound needed.
3. IMS missing Jeddah arrival, manual inbound needed.
4. MAS normal Tincan/Apapa.
5. MAS omitted Apapa.
6. MAS missing formula ports.
7. Black Sea normal Novorossiysk.
8. Libya port-only route.
9. Zeynep C no-zone record.
10. Zeynep C flexible manual zone record.
11. Omitted port with times preserved.
12. Confirmed field not overwritten by recalculation.

Each fixture should define expected:

- saved payload
- calculation suggestions
- dashboard timeline events
- export rows
- warnings

### 14.9 Rewrite order

Recommended safe order:

1. Add fixtures/tests around current desired behavior.
2. Build server-side pure rule engine.
3. Build front-end preview wrapper around same rules or matching rule definitions.
4. Replace IMS add/edit defaults first, because it has the most fragile logic.
5. Replace MAS add/edit defaults and calculation.
6. Replace Black Sea and Libya simpler flows.
7. Replace Zeynep C flexible manual flow.
8. Replace dashboard timeline builder.
9. Replace export builder to use same event model.
10. Hide SW Africa and East Med from active new-voyage selection, but keep config/data.

### 14.10 What not to do

- Do not keep adding route-specific exceptions directly inside dashboard rendering.
- Do not calculate from ambiguous port names only.
- Do not let front-end and server calculate different things.
- Do not overwrite confirmed/actual values.
- Do not make Zeynep C fit any fixed route pattern.
- Do not remove legacy/import modules until after the stable rewrite is verified.
