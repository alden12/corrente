# Playing Corrente with an AI agent

Corrente can be driven by an AI agent over [MCP](https://modelcontextprotocol.io) (the Model Context
Protocol). An agent such as Claude can make tracks, write and edit notes, build instruments and
effects, set parameters, mix, listen back, and save versions, all in the app open in your browser,
while you watch and play along.

Today that means running Corrente from its source on your own computer. A package you can run
without cloning anything is planned, and this page will show it when it lands.

## What you need

- [Node.js](https://nodejs.org) 24 and [Yarn Classic](https://classic.yarnpkg.com/) (v1)
- [Claude Code](https://claude.com/claude-code), or another MCP client that can start a local server

## Set it up

1. **Get the source and install it.**

   ```bash
   git clone https://github.com/alden12/corrente.git
   cd corrente
   yarn
   ```

2. **Start the app** with `yarn dev`, open [http://localhost:5155](http://localhost:5155), and press
   **Start audio**.

3. **Start Claude Code in the same folder** (`claude`). The repository's `.mcp.json` names the
   `corrente` MCP server, so Claude Code offers to start it: allow it. `/mcp` should then list
   `corrente` as connected, and on a desktop window the app's status bar shows **MCP** once the tab
   and the server have found each other.

4. **Ask for something.** For example:
   - "Make a four-bar drum loop at 120 BPM with a kick on every beat."
   - "Add a bass track and write a line that follows the chords in the keys clip."
   - "Build a plucky synth with a filter envelope, then save it as a patch."
   - "Listen to the mix and tell me what's muddy."

### Another MCP client

Run the server from the repository folder, over stdio:

```bash
npx tsx server/index.ts
```

(`yarn mcp-server` does the same, but Yarn prints a banner on stdout that an MCP client would read as
a broken message, so point the client at the command above.)

## How it fits together

```
Claude Code  --stdio-->  the corrente MCP server  --ws://localhost:8765-->  the Corrente tab
```

- The server only talks to pages served from your own machine (`localhost`), so the app has to be
  the one `yarn dev` serves, not a copy on the web.
- With several Corrente tabs open, the agent drives the one you used last.
- If another session already holds the server's port, the newest session takes it over.

## When it doesn't connect

- **It edits but nothing plays.** Press **Start audio**: browsers won't play sound until the page has
  been clicked, though the agent can edit before that.
- **The server isn't running.** Reconnect it from Claude Code's `/mcp` menu.
- **Port 8765 is taken** by something other than Corrente. Close it and reconnect.
- **The page isn't on localhost.** Open the app from `http://localhost:5155`.

## Online

Corrente online, which is in preview, has its own MCP server for signed-in accounts, which connects
to Claude as a connector, with nothing to install.
