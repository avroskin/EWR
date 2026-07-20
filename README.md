# Arfleet RiskWatch

Local EWR / K&R voyage tracking tool for risk-zone monitoring, Excel export, audit checks, and yearly archive preparation.

## Run

```bash
EWR_SETTINGS_PASSWORD="choose-a-strong-password" npm start
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
$env:PORT='3002'; $env:HOST='127.0.0.1'; $env:EWR_SETTINGS_PASSWORD='choose-a-strong-password'; npm start
```

The server binds to `0.0.0.0` by default so trusted workstations on the local network can connect using the host computer's IP address. Set `HOST=127.0.0.1` when access should be limited to the host computer. An explicit `EWR_SETTINGS_PASSWORD` (or SHA-256 `EWR_SETTINGS_PASSWORD_HASH`) is required to unlock changes; there is no built-in password.

## Checks

```bash
npm run check
npm run smoke
npm audit --omit=dev
```

`npm run smoke` starts the app on a temporary local port, checks config, voyages, and audit endpoints, then shuts it down.

## Data Notes

The authoritative runtime data source is:

- `data/ewr.sqlite` stores configuration, active voyages, and archived voyages.
- `data/backups/` contains timestamped, integrity-checked SQLite snapshot archives.
- `data/*.json` files are historical migration material only. The running application does not read or update them.

The server creates a backup at startup and checks hourly. Each backup has a timestamp, so later changes on the same day are captured. To create one immediately:

```bash
npm run backup:data
```

On Windows, backups are also copied to the configured network share. Override it with `EWR_NETWORK_BACKUP_DIR`; set that variable to an empty value when only local backups are wanted.

Do not rely on the old Excel file as final archive truth. The current workbook is known to be outdated; future archiving should be based on the planned clean workbook/import flow.

## Portal Integration

This project remains the EWR tool. The separate Portal project should link to or launch this app rather than moving EWR data into the Portal folder.

Recommended local route from Portal:

```text
http://127.0.0.1:3002
```

## Import Helpers

Legacy JSON/import reports are retained only for migration traceability. Do not overwrite `ewr.sqlite` from them without making and validating a current SQLite backup first.

`update_config.js` refreshes known names from all SQLite voyage and archive records while preserving risk-zone rules.

`ewr-git-upload/` is a legacy distribution snapshot, not a second runtime installation. Make code and data changes only in the project root unless deliberately rebuilding that distribution package.
