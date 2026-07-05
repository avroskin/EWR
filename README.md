# Arfleet RiskWatch

Local EWR / K&R voyage tracking tool for risk-zone monitoring, Excel export, audit checks, and yearly archive preparation.

## Run

```bash
npm start
```

Default local address:

```text
http://127.0.0.1:3002
```

The server can be started on another port when it is launched from the Portal project:

```bash
PORT=3002 HOST=127.0.0.1 npm start
```

On Windows PowerShell:

```powershell
$env:PORT='3002'; $env:HOST='127.0.0.1'; npm start
```

## Checks

```bash
npm run check
npm run smoke
npm audit --omit=dev
```

Legacy import script check, only when working on old workbook migration:

```bash
npm run check:import
```

`npm run smoke` starts the app on a temporary local port, checks config, voyages, and audit endpoints, then shuts it down.

## Data Notes

Runtime data lives in `data/`:

- `config.json` stores known vessels, charterers, services, and risk-zone rules.
- `voyages_2026.json` stores current voyage records.
- `data/backups/` is created automatically before server writes overwrite JSON files.

Do not rely on the old Excel file as final archive truth. The current workbook is known to be outdated; future archiving should be based on the planned clean workbook/import flow.

## Portal Integration

This project remains the EWR tool. The separate Portal project should link to or launch this app rather than moving EWR data into the Portal folder.

Recommended local route from Portal:

```text
http://127.0.0.1:3002
```

## Import Helpers

`tools/import-legacy/import_excel2.js` is the existing workbook import script. Treat it as a disposable migration utility, not normal startup code. Run it only with `npm run import:legacy`; the base app no longer depends on this folder.

`update_config.js` refreshes known names from voyage data while preserving risk-zone rules.
