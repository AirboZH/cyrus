# DEPLOY — Cyrus Edge Worker (self-hosted, on-host)

How the running Cyrus service is **deployed and operated** on this host: where it
lives, how to ship an update, how to restart safely, and how to roll back.

This is the operations runbook. For a **first-time** install (Linear OAuth app,
public webhook URL, etc.) see [SELF_HOSTING.md](./SELF_HOSTING.md); this document
assumes the service is already installed and running.

---

## What runs where

| Thing | Value |
| --- | --- |
| Deployed source tree | `/root/cyrus` (git checkout, tracks `origin/main` of `yuanze-dev/cyrus`) |
| Process manager | systemd unit **`cyrus.service`** (`/etc/systemd/system/cyrus.service`) |
| Entry command | `/usr/bin/node /root/cyrus/apps/cli/dist/src/app.js start` |
| Runs as | `root`, `HOME=/root`, loads `~/.cyrus/.env` automatically |
| Config | `~/.cyrus/config.json` (routing, repos, tokens) — hot-reloaded, no restart needed |
| Package manager | `pnpm@10.33.1` (see `packageManager` in root `package.json`) |

> **Do not confuse `/root/cyrus` with `/root/.cyrus/repos/cyrus`.**
> `/root/cyrus` is the code that actually runs. `/root/.cyrus/repos/cyrus` is just
> the routing checkout Cyrus uses when it works *on* the Cyrus repo as an agent
> task. Editing the routing checkout does **not** change what is running in
> production — deploy edits only take effect from `/root/cyrus`.

The service connects to Linear over webhooks and (when enabled) to Feishu over a
persistent **WebSocket long connection** — so there is no inbound event URL to
update on the Feishu side when you redeploy.

---

## Deploy an update

Run these in `/root/cyrus` after your change has landed on `main`
(a merged PR, or a fast-forwardable commit):

```bash
cd /root/cyrus

# 1. Pull the merged code (fast-forward only — never create a merge commit here)
git fetch origin main && git merge --ff-only origin/main

# 2. Install deps + build (builds packages/* and apps/cli/dist)
pnpm install --frozen-lockfile && pnpm build

# 3. Smoke test the edge worker before restarting
pnpm --filter cyrus-edge-worker test:run

# 4. Restart (see the pitfall below before running this)
```

Only proceed to the restart once the build and smoke test are green.

---

## Restarting safely (important pitfall)

Feishu / Linear agent sessions run as **child processes of the edge worker**.
A plain foreground restart kills the whole process group — including the very
session that issued the command — so an in-progress reply never gets sent and the
restart looks like it "hung".

**Deploying from inside an agent session? Detach the restart from your cgroup so
it fires *after* you finish replying:**

```bash
# Delayed restart — survives your session ending, lets your final reply flush
systemd-run --on-active=5 systemctl restart cyrus.service
```

**Restarting from a plain shell (not an agent session)?** A direct restart is fine:

```bash
systemctl restart cyrus.service
```

Verify it came back up:

```bash
systemctl is-active cyrus.service          # -> active
journalctl -u cyrus.service -n 50 --no-pager
# Feishu enabled: look for "Feishu long connection ready" in the logs
```

> The edge worker restart is a hard cut — any in-flight agent task is interrupted
> and there is no startup reconciliation. Prefer deploying during a quiet window,
> or after confirming no agent session is mid-task.

---

## Roll back

Redeploy the previous known-good commit, then rebuild and restart the same way:

```bash
cd /root/cyrus
git log --oneline -n 10          # find the last good SHA
git checkout <good-sha>          # or: git reset --hard <good-sha>
pnpm install --frozen-lockfile && pnpm build
systemd-run --on-active=5 systemctl restart cyrus.service
```

Once back on a healthy commit, return to tracking `main` (`git checkout main`)
before the next deploy.

---

## Quick reference

```bash
systemctl status cyrus.service                 # current state
journalctl -u cyrus.service -f                 # tail logs live
systemctl restart cyrus.service                # restart (plain shell only)
systemd-run --on-active=5 systemctl restart cyrus.service   # restart from an agent session
systemctl cat cyrus.service                    # show the unit definition
```

---

## Notes & known limitations

- **Secrets** live in `~/.cyrus/.env` and `~/.cyrus/config.json` — never commit
  them; this document intentionally references them by path only.
- **No zero-downtime deploy**: the restart is a hard cut with no in-flight task
  reconciliation. Deploy during a quiet window when possible.
- A mirror instance runs independently on another host (macOS, via launchd unit
  `ai.cyrus.edge` + a Cloudflare tunnel) with its own Linear/Feishu credentials.
  Its steps mirror the above (`git pull && pnpm install && pnpm build`, then
  `launchctl kickstart -k gui/$(id -u)/ai.cyrus.edge`) but it is **not** driven
  from this host — deploy it over SSH on that machine.
