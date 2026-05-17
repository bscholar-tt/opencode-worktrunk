# opencode-worktrunk

An [OpenCode](https://opencode.ai) plugin that creates and manages git worktrees using [worktrunk](https://worktrunk.dev) (`wt`).

## Requirements

- [worktrunk](https://worktrunk.dev/worktrunk/) (`wt` in PATH)
- OpenCode with plugin support

## Tools

### `worktree_create`

Creates a new git worktree via `wt switch -c <branch>` and opens a forked session in OpenCode pointing at it.

| Arg | Required | Description |
|-----|----------|-------------|
| `branch` | yes | Branch name (e.g. `feature/my-feature`) |
| `baseBranch` | no | Base branch to create from (defaults to HEAD) |

### `worktree_delete`

Removes a worktree and its branch via `wt remove <branch>`.

| Arg | Required | Description |
|-----|----------|-------------|
| `branch` | yes | Branch name of the worktree to delete |

## Status Markers

The plugin automatically updates the worktrunk status marker for the current worktree:

| Marker | Meaning |
|--------|---------|
| 🤖 | Agent is executing a tool |
| 💬 | Session is idle / waiting |

These show up in `wt list` and any worktrunk-aware status line.

## Installation

Add to your OpenCode config:

```json
{
  "plugin": ["bscholar-tt/opencode-worktrunk"]
}
```
