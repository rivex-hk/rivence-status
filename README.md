# Rivence status

**Live status:** <!--live status--> **🟩 All systems operational**

This repository is the external watch and the public status page for Rivence installs. It runs
on GitHub Actions and GitHub Pages, outside the AWS account the installs live in, so it still
sees an outage that takes the account's own alarms down with it. The page is served at the
address named by `status-website.cname` in `.upptimerc.yml`.

It holds the watch configuration, the uptime history, the page and one certificate job. It
holds no Rivence product code, no secrets and no hostnames: every install appears only under a
neutral label such as `EU-1`.

## What it watches

- **Health, every five minutes.** Upptime calls each install's `GET /api/health/ready` and
  treats anything but `200` as down. A down check opens an issue labelled `status` and the
  install's slug; recovery comments on it and closes it. That issue is both the incident
  record and the notification, since the organisation's GitHub notifications go to the alert
  address.
- **Certificates, daily.** `.github/workflows/cert-expiry.yml` runs `scripts/cert-days.mjs`,
  which reads each install's TLS certificate over `node:tls`. A certificate within 14 days of
  expiry, or one that cannot be read at all, opens an issue labelled `cert-expiry`. It never
  opens a second one for the same label while one is open. Close it once the certificate is
  renewed; the next run reopens it if not.

## Add an install

Only customer and dogfood installs are watched. **A demo install is never added**: it is
created per use and thrown away, so it would only ever read as an outage.

1. Pick the next free label for the region, such as `EU-2`. Never use a customer's name.
2. Add the repository secret `EU_2_URL` with the value `https://<host>/api/health/ready`.
3. Replace the repository secret `CERT_HOSTS` with the whole map, now including the new
   label, for example `{"EU-1":"<host>","EU-2":"<host>"}`. A secret cannot be read back, so
   the operator's password store holds the master copy of this map.
4. Add the site entry to `.upptimerc.yml` and commit it to `main`:

   ```yaml
   - name: EU-2
     slug: eu-2
     url: $EU_2_URL
     expectedStatusCodes:
       - 200
     maxRedirects: 0
   ```

   The push runs Setup CI, which adds the component to the page.

Removing an install is the same steps in reverse.

## Post an incident note

Everything here is public: never write a hostname, a customer's name or personal data.

- **The watch opened the issue:** add a comment to the open issue labelled `status` and the
  install's slug. Each comment shows on the page under that incident. Upptime locks the issue,
  so only members of the organisation can comment.
- **The watch saw nothing** (for example, wrong data while the install answers): open an issue
  titled `EU-1: <one plain sentence>` with the labels `status` and `eu-1`, comment on it as
  the incident moves, and close it when it is resolved.
- **Planned work:** open an issue from the "Maintenance window" template. The install's slug
  under `expectedDown` stops the window from opening an outage issue.

## How the repository is kept

The workflows started as the Upptime v1.46.0 template and are kept by hand, because every
action they use is pinned by commit SHA. The template's two self-updating workflows
(`update-template.yml` and `updates.yml`) are deliberately absent: they rewrite every workflow
back to unpinned tags and run unpinned code with the repository token. To upgrade Upptime,
re-pin `upptime/uptime-monitor` in every workflow at once.

The secrets are `GH_PAT`, a fine-grained token for this repository only, one `<LABEL>_URL` per
install, and `CERT_HOSTS`. The certificate job uses only the workflow's own `GITHUB_TOKEN`.

## Current status

<!--start: status pages-->
<!--end: status pages-->

## License

The workflows derive from [Upptime](https://github.com/upptime/upptime), [MIT](./LICENSE).
