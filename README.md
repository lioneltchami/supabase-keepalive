# Supabase Free keepalive

A small GitHub Actions workflow that makes a read-only request to a single
`public.keepalive` row in each configured Supabase project every six hours. It
can reduce inactivity pauses on Free projects, but it cannot guarantee that a
project will never be paused.

The check uses only a Supabase publishable key or legacy anon key. **Do not add
a Supabase secret or service-role key.** The script rejects elevated keys before
making requests. The public repository contains no project credentials.

## Configure each Supabase project

For every project to monitor:

1. Open that project's Supabase Dashboard → **SQL Editor** and run
   [`sql/keepalive.sql`](sql/keepalive.sql). It creates one fixed row and allows
   the `anon` role to read only that table.
2. Copy the project's Project URL and publishable key from its dashboard. A
   legacy anon key is supported as well.

## Configure GitHub Actions

In this repository, open **Settings → Secrets and variables → Actions → Secrets**
and create `SUPABASE_KEEPALIVE_PROJECTS_JSON` with a JSON array like this:

```json
[
  {
    "name": "Example project",
    "url": "https://PROJECT_REF.supabase.co",
    "expectedHost": "PROJECT_REF.supabase.co",
    "apiKey": "sb_publishable_..."
  }
]
```

Use each project's exact hostname for `expectedHost` (without `https://` or a
path). Never put actual keys in this file, a commit, an issue, or a pull
request. Store the JSON only as the Actions secret.

First, use **Actions → Supabase keepalive → Run workflow** to validate the
configuration manually. Manual runs work while the schedule is disabled. After
the manual run succeeds, open **Settings → Secrets and variables → Actions →
Variables**, create `SUPABASE_KEEPALIVE_ENABLED`, and set its value to `true`.
Scheduled runs remain skipped until that variable is enabled.

## Operation and security

- Scheduled checks run every six hours at minute 23 UTC; each run checks all
  configured projects with bounded concurrency.
- The job has read-only repository permissions and uses pinned GitHub Actions.
- The workflow runs only on a schedule or manual dispatch; it does not run
  project credentials on pull-request code. Fork pull-request test workflows
  do not receive repository secrets.
- Enable GitHub notifications for failed runs. Scheduled runs can be delayed or
  dropped during load, and schedules in public repositories can be disabled
  after 60 days without repository activity. Check the Actions page periodically.

## Local test

Requires Node.js 22 or later. Run:

```sh
node --test scripts/supabase-keepalive.test.mjs
```
