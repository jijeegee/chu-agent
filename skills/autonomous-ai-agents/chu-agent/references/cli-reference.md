# Chu CLI Reference

Live sources when anything looks stale: `chu --help`, `chu <command> --help`,
https://hermes-agent.nousresearch.com/docs/reference/cli-commands

### Global Flags

```
chu [flags] [command]        (no subcommand = interactive chat)

  --version, -V             Show version
  -z, --oneshot PROMPT      One-shot: print ONLY the final response (for scripts/pipes)
  -m MODEL  --provider P    Model/provider override for this invocation
  -t, --toolsets LIST       Comma-separated toolsets for this invocation
  --resume, -r SESSION      Resume session by ID or title
  --continue, -c [NAME]     Resume by name, or most recent session
  --worktree, -w            Isolated git worktree mode (parallel agents)
  --skills, -s SKILL        Preload skills (comma-separate or repeat)
  --profile, -p NAME        Use a named profile
  --yolo                    Skip dangerous command approval
  --tui / --cli             Force the Ink TUI / classic REPL
  --ignore-rules            Skip AGENTS.md/SOUL.md/memory/skill injection
  --safe-mode               Disable ALL customizations (troubleshooting)
  --pass-session-id         Include session ID in system prompt
```

### Chat

```
chu chat [flags]
  -q, --query TEXT          Single query, non-interactive
  --image PATH              Attach a local image to a single query
  -Q, --quiet               Suppress banner, spinner, tool previews
  --checkpoints             Enable filesystem checkpoints (/rollback)
  --max-turns N             Cap tool-calling iterations
  --source TAG              Session source tag (default: cli)
```
(plus the global flags above)

### Configuration

```
chu setup [section]      Wizard (model|tts|terminal|gateway|tools|agent)
chu model                Interactive model/provider picker
chu fallback [add|remove|list]  Fallback provider chain
chu config [show|edit|get|set|unset|path|env-path|check|migrate]
chu login / logout       OAuth sign-in / clear stored auth
chu doctor [--fix]       Check dependencies and config
chu status [--all]       Component status
```

### Tools & Skills

```
chu tools [list|enable NAME|disable NAME]   Per-platform toolsets (curses UI with no args)

chu skills list|browse|search QUERY|inspect ID
chu skills install ID    Hub identifier OR a direct https://…/SKILL.md URL
chu skills config        Enable/disable skills per platform
chu skills check|update|uninstall|publish PATH
chu skills tap add REPO  Add a GitHub repo as a skill source
chu bundles              Skill bundles (one /<name> alias loads several skills)
```

### MCP Servers

```
chu mcp add NAME (--url or --command) | remove | list | test NAME
chu mcp catalog | install NAME     Curated catalog install
chu mcp configure NAME             Toggle tool selection
chu mcp serve                      Run Chu as an MCP server
```
Details (transport, tool discovery, catalog): `references/native-mcp.md`.

### Gateway (Messaging Platforms)

```
chu gateway run|install|start|stop|restart|status|setup
```

20+ platforms: Telegram, Discord, Slack, WhatsApp (Baileys + Business Cloud API), iMessage (Photon — `chu photon setup`), Signal, Email, SMS, Matrix, Mattermost, Teams, LINE, SimpleX, ntfy, Google Chat, Home Assistant, DingTalk, Feishu, WeCom, Weixin, API Server, Webhooks. Open WebUI connects via the API Server adapter. Most adapters ship under `plugins/platforms/`.
Docs: https://hermes-agent.nousresearch.com/docs/user-guide/messaging/

### Sessions

```
chu sessions list|browse|rename ID TITLE|delete ID|export OUT|prune|stats
```

### Cron / Webhooks

```
chu cron list|create SCHED|edit ID|pause|resume|run ID|remove|status
    Schedules: '30m', 'every 2h', '0 9 * * *', ISO timestamp
chu webhook subscribe NAME|list|remove NAME|test NAME
```
Webhook payloads/routes: `references/webhooks.md`.

### Profiles

```
chu profile list|create NAME (--clone|--clone-all|--clone-from)|use|show|delete
chu profile rename A B | alias NAME | export NAME | import FILE
```

### Credentials & Pools

```
chu auth                 Interactive credential manager
chu auth add [PROVIDER]  Add OAuth or API-key credential (nous, openai-codex, qwen-oauth, …)
chu auth list|remove P IDX|reset PROVIDER|status
```
Multiple credentials per provider form a pool that rotates automatically and skips exhausted keys.

### Other

```
chu desktop / gui        Native desktop app
chu dashboard            Web admin panel + embedded chat (--stop / --status)
chu proxy                OpenAI-compatible local proxy backed by an OAuth provider
chu portal               Quick setup / sign in via Nous Portal
chu kanban <verb>        Multi-agent work-queue board
chu project              Named multi-folder workspaces
chu skin list|use|set    Switch/tweak skins (see references/themes.md)
chu pets <verb>          Pet mascots (see references/petdex.md)
chu memory setup|status|off|reset   Memory provider
chu secrets bitwarden|onepassword   External secret stores
chu moa                  Mixture-of-Agents slots
chu hooks / security / backup / import / checkpoints / console
chu logs [-f] [errors]   View agent/error logs
chu send                 One-off message through a gateway platform
chu pairing / plugins / insights / journey / computer-use
chu acp                  ACP server (IDE integration)
chu completion bash|zsh|fish
chu update / uninstall / claw migrate
```

Plugin- and provider-supplied subcommands (e.g. `chu photon setup`) only appear once their plugin is installed/active.

### Where to Find Things

| Looking for... | Location |
|---|---|
| Config options | `chu config edit` · [Configuration docs](https://hermes-agent.nousresearch.com/docs/user-guide/configuration) |
| Tools / toolsets | `chu tools list` · [Tools reference](https://hermes-agent.nousresearch.com/docs/reference/tools-reference) |
| Skills catalog | `chu skills browse` · [Skills catalog](https://hermes-agent.nousresearch.com/docs/reference/skills-catalog) |
| Provider setup | `chu model` · [Providers guide](https://hermes-agent.nousresearch.com/docs/integrations/providers) |
| Env variables | `chu config env-path` · [Env vars reference](https://hermes-agent.nousresearch.com/docs/reference/environment-variables) |
| Gateway logs | `~/.chu/logs/gateway.log` (or `chu logs`) |
| Sessions | `chu sessions browse` (reads state.db) |
