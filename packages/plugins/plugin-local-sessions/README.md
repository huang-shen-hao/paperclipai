# Local Sessions

Read-only browser for the agent transcripts that live on the machine running
Paperclip. It answers two questions that are otherwise buried in `~`:

1. **What did my local agents actually do?** Every session from QwenWork/Qoder
   CLI, Codex, Claude Code, and Hermes in one list.
2. **Which local transcript produced this Paperclip task?** Sessions the local
   adapters start are titled `Paperclip · <agent>` and are badged
   `来自 Paperclip` in the list, so a task on the board can be traced back to
   the exact conversation that ran it.

## Stores it reads

| Provider | Location | Format |
| --- | --- | --- |
| 千问办公 / Qoder CLI | `~/.qoder-cn/projects/<cwd-slug>/<session>.jsonl` | JSONL turns + `custom-title` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl`, `~/.codex/archived_sessions/`, plus `~/.codex/history.jsonl` for titles | JSONL `session_meta` + `response_item` |
| Claude Code | `~/.claude/projects/<cwd-slug>/<uuid>.jsonl` | JSONL turns + `last-prompt` |
| Hermes Agent | `~/.hermes/state.db` | SQLite `sessions` + `messages` |

Hermes is the only store that records accounting, so token counts and cost are
shown for Hermes rows and left blank elsewhere.

Everything is read-only. The Hermes database is opened with `readOnly: true`
and closed immediately after each query so the plugin never contends with a
running agent.

## Where it shows up

- **Sidebar** → *本机会话* (a `sidebar` slot).
- **Page** → `/:companyPrefix/local-sessions` (a `page` slot, `routePath:
  local-sessions`).

The page has provider filter chips with counts, a search box across
title/directory/model, and a two-pane list + transcript view.

## Configuration

Instance config (`instanceConfigSchema`):

| Key | Default | Meaning |
| --- | --- | --- |
| `homeDir` | server `$HOME` | Absolute path whose dot-directories hold the stores. |
| `maxSessionsPerProvider` | 200 | Scan cap per provider. |
| `maxMessagesPerSession` | 400 | Transcript tail length. |
| `hideEmptySessions` | true | Drop sessions with zero turns. |

The provider scan walks directories, so results are cached in the worker for
15 seconds. The **重新扫描** button clears that cache and refetches.

## Styling note

Plugin UI is same-origin with the host app, but the host's Tailwind build only
compiles classes found in the host's own sources — classes invented in a plugin
bundle silently do nothing. This plugin therefore ships a small scoped
stylesheet (`pls-*` in `src/ui/index.tsx`) and layers it over the host theme
variables (`--card`, `--border`, `--muted-foreground`, …).

## Development

```bash
pnpm --filter @paperclipai/plugin-local-sessions build
```

Then install (or reload after a rebuild) from the instance:

```bash
curl -X POST http://127.0.0.1:3100/api/plugins/install \
  -H 'content-type: application/json' \
  -d '{"packageName":"'"$PWD"'/packages/plugins/plugin-local-sessions","isLocalPath":true}'
# subsequent rebuilds
curl -X POST http://127.0.0.1:3100/api/plugins/paperclip.local-sessions/upgrade \
  -H 'content-type: application/json' -d '{}'
```
