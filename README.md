# Rivence status

This repository is the external watch and the public status page for Rivence installs. It runs
on GitHub Actions and GitHub Pages, outside the AWS account the installs live in, so it still
sees an outage that takes the account's own alarms down with it.

It holds no Rivence product code, no stored credential and no hostname. Every install appears
only under a neutral label such as `EU-1`. The one place a hostname lives is the `INSTALLS`
repository secret.

## How it works

- **Probe, every five minutes** (`.github/workflows/probe.yml`, `scripts/probe.mjs`). The probe
  calls each install's `GET /api/health/ready`. A `200` means up. Anything else, including a
  redirect, an error, or no answer within 10 seconds, is retried once after 5 seconds and is
  down if it fails again.
  - The first failed probe opens an issue labelled `incident` and the install's slug (`eu-1`).
    The issue is authored by `github-actions[bot]`, so it notifies the owner.
  - Recovery comments on that issue and closes it.
- **Data, on `gh-pages` under `data/`.** `main` holds only code.
  - `status.json` holds each install's current state.
  - `uptime/<slug>.json` holds 90 days of minutes down per day.
  - `incidents.json` holds the last 90 days of `incident` issues and their comments, so the
    page never calls the GitHub API.

  - `heartbeat.json` holds the time of the latest probe run. It is rewritten on every run, so the
    probe commits every five minutes.

  The page shows that time as "Last checked". When it is more than 15 minutes old (three missed
  runs), the banner and every component read "Status unknown - probes stalled" instead of
  "Operational". The 15 minutes is `STALE_AFTER_MINUTES` in `site/shape.mjs`, three times the
  cron interval; a test fails if the workflow's cron and `PROBE_INTERVAL_MINUTES` drift apart.

- **Downtime accounting.** Downtime runs from the first failed probe to the first successful
  one. A gap between two runs counts for at most 30 minutes, so a stalled schedule does not
  invent hours of outage.
- **Certificates, daily** (`.github/workflows/cert-expiry.yml`, `scripts/cert-days.mjs`). A
  certificate within 14 days of expiry, or one that cannot be read, opens an issue labelled
  `cert-expiry`, never a second one for the same install while one is open. Close it once the
  certificate is renewed.
- **The page** is `site/`: static HTML, CSS and JavaScript with no framework, no CDN and no
  external fonts. It reads `data/*.json`. A push to `main` touching `site/` publishes it to
  `gh-pages` (`.github/workflows/site.yml`), leaving `data/` and `CNAME` alone.

Every workflow uses only its own `GITHUB_TOKEN`, with the permissions its job needs. Every
action is pinned by commit SHA.

## Add an install

Only customer and dogfood installs are watched. **A demo install is never added**: it is
created per use and thrown away, so it would only ever read as an outage.

Edit the one repository secret `INSTALLS`, a JSON map of label to bare hostname:

```json
{ "EU-1": "<host>", "EU-2": "<host>" }
```

- Use the next free label for the region, and never a customer's name.
- A secret cannot be read back, so the operator's password store holds the master copy of this
  map. Paste the whole map each time.

The next probe run adds the install to the page. Removing an install is the same edit. Its
history stays in `data/` but is no longer shown.

## Post an incident update

Everything here is public: never write a hostname, a customer's name or personal data. A
hostname that slips into an issue is replaced by its label before it reaches the page.

- **The probe opened the issue:** comment on it. Each comment shows on the page as an update
  within five minutes.
- **The probe saw nothing** (for example, wrong data while the install answers): open an issue
  with the labels `incident` and the install's slug (`eu-1`). Title it with one plain sentence,
  add updates as comments, and close it when it is resolved.

On the page, the newest update of a closed incident reads "Resolved" and the first reads
"Investigating".

## Tests

```sh
node --test "test/*.test.mjs"
```
