# Orbit — free Jamf Pro alerts

Orbit polls Jamf Pro and sends deduplicated alerts to Slack and email for failed policies, inventory/compliance changes, and devices that have stopped checking in.

The free deployment uses:

- **Render Free Web Service** for the Node.js app
- **GitHub Actions** to call Orbit every 15 minutes
- **Supabase Free** to retain alert history when Render sleeps or restarts

## 1. Create the Supabase state table

1. Create a free project at https://supabase.com.
2. Open **SQL Editor**, select **New query**, paste the contents of `supabase/setup.sql`, and click **Run**.
3. Open **Project Settings → Data API** and copy the **Project URL**.
4. Open **Project Settings → API Keys** and copy the **service_role** secret key.

Never put the service-role key in GitHub source code. Orbit uses it only as a private Render environment variable.

## 2. Deploy the free Render Web Service

1. In Render, select **New → Blueprint** and choose this repository.
2. Render detects `render.yaml` and creates the free `orbit-jamf-alerts` service.
3. Enter every requested secret:

   - `JAMF_BASE_URL`, `JAMF_CLIENT_ID`, `JAMF_CLIENT_SECRET`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `POLL_SECRET` — create a long random value and save it for GitHub
   - `SLACK_WEBHOOK_URL`
   - SMTP and email values if email delivery is enabled

4. Deploy and copy the Render service URL, for example `https://orbit-jamf-alerts-abcd.onrender.com`.
5. Open `<service-url>/health`. A new service should return JSON with `"ok": true`.

The app intentionally sets `RUN_ON_START=false` and `INTERNAL_SCHEDULER=false`; GitHub Actions owns the schedule.

## 3. Add the GitHub Actions secrets

In the GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret | Value |
| --- | --- |
| `ORBIT_URL` | Render URL without a trailing slash |
| `POLL_SECRET` | Exactly the same random value used in Render |

Open **Actions → Poll Orbit → Run workflow** for the first test. The workflow may take a minute or two while a sleeping free service wakes. A green check means `/poll` completed successfully.

## 4. Verify the first run

- Check the Render logs for `Orbit run complete`.
- Check Supabase **Table Editor → orbit_state** for the row named `main`.
- Confirm expected Slack and email alerts arrive.
- The first inventory run establishes a baseline, so it does not report every computer as changed.
- The scheduled GitHub workflow runs every 15 minutes, although GitHub can occasionally delay scheduled jobs.

## Security

- `/poll` accepts only `POST` requests carrying `Authorization: Bearer <POLL_SECRET>`.
- `/health` exposes status but no credentials.
- Jamf, Supabase, Slack, SMTP, and polling secrets must exist only in Render/GitHub secret stores.
- Use a read-only Jamf API role and a test Slack channel/mailbox for the initial rollout.

## Local development

Copy `.env.example` to `.env`, fill in the values, export them, then run:

```sh
npm ci
npm start
```

To use a local JSON state file, set `STATE_BACKEND=file`. Run all checks with `npm run check`.

## Alert behavior

- **Stale devices:** alerts after `STALE_DEVICE_DAYS` and repeats only after the cooldown.
- **Inventory changes:** watches OS version, FileVault, management status, and serial number after the first baseline.
- **Failed policies:** reads recent Jamf policy logs; per-computer API failures do not stop the remaining checks.
