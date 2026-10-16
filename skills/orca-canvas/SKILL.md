---
name: orca-canvas
description: >-
  Use the native Orca Canvas capability graph from an agent terminal: discover
  connected nodes, call browser, simulator, notes, todos, timers,
  network observers, and coordinate other Canvas agents through edge-scoped
  permissions with durable restart-safe state.
---

# Orca Canvas

Canvas is a native Orca orchestration surface. A line is a capability grant;
it is not decoration. The agent can use only the nodes directly connected to
its own agent node, and the main Orca process checks that edge before every
call.

Start every turn by reading the live capability graph:

```text
orca canvas connections --json
orca canvas graph --json
```

Call a specific node by stable id when there is more than one node of a kind:

```text
orca canvas call --tool browser.snapshot --node <browser-node> --json
orca canvas call --tool simulator.ax --node <simulator-node> --json
orca canvas call --tool note.read --node <note-node> --json
```

For every request with two or more concrete actions, keep a durable Todo in
sync. Discover connections first. If no Todo is connected, create one and then
discover again:

```text
orca canvas call --tool todo.spawn --args '{}' --json
orca canvas connections --json
orca canvas call --tool todo.list --node <todo-node> --json
orca canvas call --tool todo.add --node <todo-node> --args '{"text":"first action"}' --json
orca canvas call --tool todo.toggle --node <todo-node> --args '{"itemId":"<item-id>"}' --json
```

Add each action once, toggle it immediately after completion, and leave every
unfinished item pending. This is mandatory progress state, not optional prose.

Browser and simulator calls use the same native Orca runtime as the regular
CLI. A Canvas browser is addressable as `canvas-<node-id>`:

```text
orca snapshot --page canvas-<browser-node> --json
orca screenshot --page canvas-<browser-node> --json
```

Use the Canvas browser only for visible or authenticated page work. Inspecting
code, files, APIs, databases, and build output stays in the agent's native
terminal. `browser.spawn` reuses a browser already connected to the agent, and
`browser.navigate` navigates that same page; Canvas browser tools cannot create
extra tabs or profiles. Prefer one `browser.snapshot`, act with its fresh refs,
then use a semantic `browser.wait` condition instead of polling or sleeping.
`browser.screenshot` returns MCP image content and should be used when pixels
matter, not as a substitute for the accessibility snapshot. Snapshots default
to 24 KiB; raise `maxBytes` only when the bounded head and tail are insufficient.

The Canvas adapter accepts `fill` with `element`/`ref` plus `value`/`text`,
`type` with `input`/`text`, and `eval` with `expression`/`js`. A zero-argument
function passed to `eval` is invoked automatically. `wait` requires at least
one of `selector`, `text`, `url`, `load`, `fn`, `state`, or `timeout`.

The network node observes a browser only when it is also directly connected to
that browser. It acquires Orca's native browser capture automatically; traffic
generated after capture starts appears in the node. Notes, todos, and stopwatch
timers are durable Canvas state owned by the main process, so an agent can
update them even while the Canvas view is hidden or recovering after a restart.
Terminal nodes are manual user resources and are never agent-callable. Agents
run commands only through their own native terminal tool. The AgentNode mirrors
that native PTY without creating a second command executor.

`canvas ask` and `orchestrate` use the caller's native terminal as coordinator
and persist Orca Runs, Tasks, worker dispatches, lifecycle, and reports. They do
not type into or scrape another terminal. The renderer only creates visual
nodes requested by `*.spawn`.

Never infer a capability from a label or from an old prompt. Re-read
`connections --json` after the user changes a line. If there are multiple
matching nodes, pass `--node` rather than guessing.
