---
sidebar_position: 2
---

# Profiles: Running Multiple Agents

Run multiple independent Chu agents on the same machine — each with its own config, API keys, memory, sessions, skills, and gateway state.

## What are profiles?

A profile is a separate Chu home directory. Each profile gets its own directory containing its own `config.yaml`, `.env`, `SOUL.md`, memories, sessions, skills, cron jobs, and state database. Profiles let you run separate agents for different purposes — a coding assistant, a personal bot, a research agent — without mixing up Chu state.

:::caution Give every agent its own profile
Never point two agent processes at the same profile (the same Chu home). Both write memory automatically, and each loads the other's writes into its system prompt at session start — so two writers on one home compound each other's state until it stops being anything you configured. Profiles exist exactly to prevent this; agents that need shared memory should use an [external memory provider](/user-guide/features/memory-providers) instead.
:::

When you create a profile, it automatically becomes its own command. Create a profile called `coder` and you immediately have `coder chat`, `coder setup`, `coder gateway start`, etc.

## Quick start

```bash
chu profile create coder       # creates profile + "coder" command alias
coder setup                       # configure API keys and model
coder chat                        # start chatting
```

That's it. `coder` is now its own Chu profile with its own config, memory, and state.

## Creating a profile

:::tip
Quickest setup: run `chu setup --portal` inside the new profile to wire up models + tools at once. See [Nous Portal](/integrations/nous-portal).
:::

### Blank profile

```bash
chu profile create mybot
```

Creates a fresh profile with bundled skills seeded. Run `mybot setup` to configure API keys, model, and gateway tokens.

If you plan to use this profile as a kanban worker (or want the kanban orchestrator to route work to it), pass `--description "<role>"` at create time so the orchestrator knows what it's good at:

```bash
chu profile create researcher --description "Reads source code and external docs, writes findings."
```

You can also set or auto-generate the description later with `chu profile describe` — see the [Kanban guide](./features/kanban#auto-vs-manual-orchestration) for the full routing model.

### Clone config only (`--clone`)

```bash
chu profile create work --clone
```

Copies your current profile's `config.yaml`, `.env`, `SOUL.md`, and skills into the new profile. Same API keys, model, and capabilities, but fresh sessions and memory. Edit `~/.chu/profiles/work/.env` for different API keys, or `~/.chu/profiles/work/SOUL.md` for a different personality.

### Clone everything (`--clone-all`)

```bash
chu profile create backup --clone-all
```

Copies **everything** — config, API keys, personality, all memories, skills, plugins. A complete working snapshot. Per-profile history is excluded (session history, `state.db`, `backups/`, `state-snapshots/`, `checkpoints/`) — these belong to the source profile and can reach tens of GB. **Cron jobs are not cloned** either: they are scheduled work bound to the source profile and its delivery channel, and a clone that inherited them would run every job twice (two gateways, same job ids). The new profile starts with an empty `cron/`. For a full backup including history and cron jobs, use `chu profile export` or `chu backup` instead.

:::note OAuth logins are shared, not copied
Anthropic (Claude Pro/Max), OpenAI Codex, and xAI OAuth logins use **single-use refresh tokens** — a copy of one is not a second credential, it is the same credential with two owners, and the first profile to refresh it revokes it for every other copy. `--clone-all` (and the dashboard's credential mirroring) therefore drops those OAuth rows from the clone. The new profile keeps reading the login from the root `~/.chu/auth.json`, and a token refresh performed inside any profile is written back to root, so all profiles stay signed in. Static API keys are copied as usual. To give a profile its own separate OAuth login, run `chu -p <name> auth add <provider>` inside it.
:::

### Clone from a specific profile

```bash
chu profile create work --clone-from coder
```

`--clone-from <source>` selects the source profile directly and implies a config/skills/SOUL clone. Combine it with `--clone-all` when you want a full copy of that source profile:

```bash
chu profile create work-backup --clone-from coder --clone-all
```

:::tip Honcho memory + profiles
When Honcho is enabled, clone operations automatically create a dedicated AI peer for the new profile while sharing the same user workspace. Each profile builds its own observations and identity. See [Honcho -- Multi-agent / Profiles](./features/memory-providers.md#honcho) for details.
:::

## Using profiles

### Command aliases

Every profile automatically gets a command alias at `~/.local/bin/<name>`:

```bash
coder chat                    # chat with the coder agent
coder setup                   # configure coder's settings
coder gateway start           # start coder's gateway
coder doctor                  # check coder's health
coder skills list             # list coder's skills
coder config set model.default anthropic/claude-sonnet-4
```

The alias works with every chu subcommand — it's just `chu -p <name>` under the hood.

### The `-p` flag

You can also target a profile explicitly with any command:

```bash
chu -p coder chat
chu --profile=coder doctor
chu chat -p coder -q "hello"    # works in any position
```

### Sticky default (`chu profile use`)

```bash
chu profile use coder
chu chat                   # now targets coder
chu tools                  # configures coder's tools
chu profile use default    # switch back
```

Sets a default so plain `chu` commands target that profile. Like `kubectl config use-context`.

### Knowing where you are

The CLI always shows which profile is active:

- **Prompt**: `coder ❯` instead of `❯`
- **Banner**: Shows `Profile: coder` on startup
- **`chu profile`**: Shows current profile name, path, model, gateway status

## Profiles vs workspaces vs sandboxing

Profiles are often confused with workspaces or sandboxes, but they are different things:

- A **profile** gives Chu its own state directory: `config.yaml`, `.env`, `SOUL.md`, sessions, memory, logs, cron jobs, and gateway state.
- A **workspace** or **working directory** is where terminal commands start. That is controlled separately by `terminal.cwd`.
- A **sandbox** is what limits filesystem access. Profiles do **not** sandbox the agent.

On the default `local` terminal backend, the agent still has the same filesystem access as your user account. A profile does not stop it from accessing folders outside the profile directory.

If you want a profile to start in a specific project folder, set an explicit absolute `terminal.cwd` in that profile's `config.yaml`:

```yaml
terminal:
  backend: local
  cwd: /absolute/path/to/project
```

Using `cwd: "."` on the local backend means "the directory Chu was launched from", not "the profile directory".

Also note:

- `SOUL.md` can guide the model, but it does not enforce a workspace boundary.
- Changes to `SOUL.md` take effect cleanly on a new session. Existing sessions may still be using the old prompt state.
- Asking the model "what directory are you in?" is not a reliable isolation test. If you need a predictable starting directory for tools, set `terminal.cwd` explicitly.

## Running gateways

Each profile runs its own gateway as a separate process with its own bot token:

```bash
coder gateway start           # starts coder's gateway
assistant gateway start       # starts assistant's gateway (separate process)
```

### Different bot tokens

Each profile has its own `.env` file. Configure a different Telegram/Discord/Slack bot token in each:

```bash
# Edit coder's tokens
nano ~/.chu/profiles/coder/.env

# Edit assistant's tokens
nano ~/.chu/profiles/assistant/.env
```

### Safety: token locks

If two profiles accidentally use the same bot token, the second gateway will be blocked with a clear error naming the conflicting profile. Supported for Telegram, Discord, Slack, WhatsApp, and Signal.

### Persistent services

```bash
coder gateway install         # creates chu-gateway-coder systemd/launchd service
assistant gateway install     # creates chu-gateway-assistant service
```

Each profile gets its own service name. They run independently.

:::note Inside the official Docker image
Per-profile gateways are supervised by [s6-overlay](https://github.com/just-containers/s6-overlay) (PID 1 in the container), so `chu profile create <name>` automatically registers an s6 service slot at `/run/service/gateway-<name>/`. `chu -p <name> gateway start/stop/restart` dispatches to `s6-svc` instead of spawning a bare process — crashes are auto-restarted and `docker restart` preserves the previously-running set of gateways. See [Per-profile gateway supervision](/user-guide/docker#per-profile-gateway-supervision) for details.
:::

## Configuring profiles

Each profile has its own:

- **`config.yaml`** — model, provider, toolsets, all settings
- **`.env`** — API keys, bot tokens
- **`SOUL.md`** — personality and instructions

```bash
coder config set model.default anthropic/claude-sonnet-4
echo "You are a focused coding assistant." > ~/.chu/profiles/coder/SOUL.md
```

If you want this profile to work in a specific project by default, also set its own `terminal.cwd`:

```bash
coder config set terminal.cwd /absolute/path/to/project
```

### From the dashboard

The [web dashboard](features/web-dashboard.md#managing-multiple-profiles)
is a machine-level surface that can manage **any** profile's config, API
keys, skills, MCPs, and model via the profile switcher in its sidebar — no
per-profile dashboard needed. `coder dashboard` routes to the machine
dashboard with the `coder` profile preselected. The dashboard's Chat tab
also follows the switcher, spawning a conversation under the selected
profile's home.

Note: "Set as active" on the dashboard's Profiles page is the sticky
default for **future CLI/gateway runs** (same as `chu profile use`) —
to edit a profile from the dashboard, use the switcher instead.

## Updating

`chu update` pulls code once (shared) and syncs new bundled skills to **all** profiles automatically:

```bash
chu update
# → Code updated (12 commits)
# → Skills synced: default (up to date), coder (+2 new), assistant (+2 new)
```

User-modified skills are never overwritten.

## Managing profiles

```bash
chu profile list           # show all profiles with status
chu profile show coder     # detailed info for one profile
chu profile rename coder dev-bot   # rename (updates alias + service)
chu profile export coder   # pack into coder.tar.gz (shareable; keys stripped)
chu profile import coder.tar.gz   # install an archive as a new profile
```

In chat, the same two live as `/export` and `/import` — and in the desktop app as **⌘K → Export/Import profile…**. See [Sharing a profile](#sharing-a-profile).

### Naming the default profile

The default profile's internal ID is always `default` — it can't be truly
renamed because `~/.chu` is the installation root. Renaming it instead
sets a **display name**, which UI surfaces show in place of the bare ID:

```bash
chu profile rename default Harumesu   # Unicode fine: 小助手
```

The display name appears in `chu profile list`/`show`, the `/profile`
chat command, the dashboard, and the desktop app (including the Bot Mode
roster). It is presentation-only: `-p default`, service names, cron jobs,
and every other reference keep using the canonical `default` ID. It is
stored as `display_name` in `~/.chu/profile.yaml`; remove that line to
revert. Named profiles can carry a `display_name` too (it survives a real
rename), but `rename` for them still renames the profile itself.

## Deleting a profile

```bash
chu profile delete coder
```

This stops the gateway, removes the systemd/launchd service, removes the command alias, and deletes all profile data. You'll be asked to type the profile name to confirm.

Use `--yes` to skip confirmation: `chu profile delete coder --yes`

:::note
You cannot delete the default profile (`~/.chu`). To remove everything, use `chu uninstall`.
:::

## Tab completion

```bash
# Bash
eval "$(chu completion bash)"

# Zsh
eval "$(chu completion zsh)"
```

Add the line to your `~/.bashrc` or `~/.zshrc` for persistent completion. Completes profile names after `-p`, profile subcommands, and top-level commands.

## How it works

Profiles use the `CHU_HOME` environment variable. When you run `coder chat`, the wrapper script sets `CHU_HOME=~/.chu/profiles/coder` before launching chu. Since 119+ files in the codebase resolve paths via `get_chu_home()`, Chu state automatically scopes to the profile's directory — config, sessions, memory, skills, state database, gateway PID, logs, and cron jobs.

This is separate from terminal working directory. Tool execution starts from `terminal.cwd` (or the launch directory when `cwd: "."` on the local backend), not automatically from `CHU_HOME`.

On host installs, tool subprocesses keep your real OS-user `HOME` by default so
existing CLI credentials under `~` keep working across profiles. Profile data is
isolated by `CHU_HOME`, not by changing `HOME`. Container backends still use
`{CHU_HOME}/home` for persistent tool state, and host users who need strict
per-profile tool config can opt in with `terminal.home_mode: profile`.

This means two things that are easy to mix up:

- `CHU_HOME` is the profile boundary. It controls Chu config, `.env`,
  memory, sessions, skills, logs, cron jobs, gateway state, and other Chu
  data.
- `HOME` is the operating-system/user home that external CLIs expect. On host
  installs, Chu keeps it as the real user home by default so tools like
  `git`, `ssh`, `gh`, `az`, `npm`, Claude Code, and Codex find the same
  credentials they use in your normal shell.

The tradeoff is that host profiles share normal user-level CLI state by default.
If you need separate CLI identities per profile, set `terminal.home_mode:
profile` in that profile's `config.yaml`. In that mode Chu launches tool
subprocesses with `HOME={CHU_HOME}/home`; you then need to initialize or link
the profile-specific `~/.ssh`, `~/.gitconfig`, `~/.config/gh`, cloud CLI auth,
Claude/Codex auth, npm state, and similar files inside that profile home.

Chu also exposes `CHU_REAL_HOME` to subprocesses so scripts can still find
the actual account home when `home_mode: profile` is active.

The default profile is simply `~/.chu` itself. No migration needed — existing installs work identically.

## Sharing a profile

A profile you built on one machine can go to another — your own workstation, a teammate's laptop, or the community. Two paths:

**Send a file.** `/export` packs the profile into one `.tar.gz` — skills, memory, persona, crons, plugins, settings, and (from the desktop) your theme and layout. API keys are stripped. The recipient runs `/import`.

```bash
# In chat, run /export, hand over the file, and they run /import on it
chu profile export coder
chu profile import ./coder.tar.gz --name coder
```

**Publish a distribution.** Package the profile as a **git repository** so recipients install it with one command and pull versioned updates later. Carries the SOUL, config, skills, cron jobs, and MCP connections; credentials, memories, and sessions stay per-machine.

```bash
# Install a whole agent from a git repo
chu profile install github.com/you/research-bot --alias

# Update later when the author ships a new version (keeps your memories + .env)
chu profile update research-bot
```

Use an export file for a one-time handoff or a move; use a distribution for an agent you'll keep shipping. See **[Profile Distributions: Share a Whole Agent](./profile-distributions.md)** for both — the comparison table, authoring, publishing, update semantics, and the security model.
