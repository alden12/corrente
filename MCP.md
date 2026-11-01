# Playing Corrente with an AI agent

Corrente can be driven by an AI agent over [MCP](https://modelcontextprotocol.io) (the Model Context
Protocol). An agent such as Claude can make tracks, write and edit notes, build instruments and
effects, set parameters, mix, listen back, and save versions, all in the app open in your browser,
while you watch and play along. The same server drives the [plugin](PLUGIN.md) in your DAW: see
[In the plugin](#in-the-plugin).

Today that means running Corrente from its source on your own computer. A package you can run
without cloning anything is planned, and this page will show it when it lands.

## What you need

- [Node.js](https://nodejs.org) 24 and [Yarn Classic](https://classic.yarnpkg.com/) (v1)
- [Claude Code](https://claude.com/claude-code), [Claude Desktop](https://claude.ai/download), or
  another MCP client that can start a local server

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

### Claude Desktop

Claude Desktop starts the server itself, from a config file, rather than from the repository's
`.mcp.json`. Do steps 1 and 2 above, then:

1. **Find two paths.** In Terminal, from the repository folder, `pwd` prints where it is (say
   `/Users/you/corrente`), and `which node` prints where Node is (say `/opt/homebrew/bin/node`). On
   Windows, use `cd` and `where node` in a Command Prompt.
2. **Open the config.** In Claude Desktop, go to Settings, Developer, and press **Edit Config**. It
   opens the folder holding `claude_desktop_config.json`: open that file in a text editor.
3. **Add Corrente**, with your two paths in place of the examples:

   ```json
   {
     "mcpServers": {
       "corrente": {
         "command": "/opt/homebrew/bin/node",
         "args": ["/Users/you/corrente/node_modules/tsx/dist/cli.mjs", "/Users/you/corrente/server/index.ts"]
       }
     }
   }
   ```

   If the file already has an `mcpServers` section, add the `corrente` entry inside it. On Windows,
   write each `\` in a path as `\\` (`"C:\\Users\\you\\corrente\\server\\index.ts"`).

4. **Quit Claude Desktop fully and open it again** (on a Mac, Cmd+Q, not just closing the window). The
   tools menu in a new chat should list `corrente`, and the app's status bar shows **MCP**.

Every path is spelled out because Claude Desktop doesn't start the server from the repository folder,
and may not see the same `PATH` as your Terminal, so `npx` or a bare `node` can fail to start.

### Another MCP client

Run the server from the repository folder, over stdio:

```bash
npx tsx server/index.ts
```

(`yarn mcp-server` does the same, but Yarn prints a banner on stdout that an MCP client would read as
a broken message, so point the client at the command above.)

## In the plugin

The plugin's window talks to the same server, so an agent can build and tweak the device on a track
in your DAW. Set up the server as above, with Claude Code or Claude Desktop, but skip starting the app
(`yarn dev`): the plugin's window stands in for the tab. Then open the plugin's window in your DAW and
ask away. For example:

- "Make this a warm pad with a slow filter sweep."
- "Add a delay and a reverb after the synth, and keep the reverb short."

It drives the window while it's open, and the one you used last if several are. A browser tab of the
app counts too, so close it if you want the plugin to be the one driven.

## How it fits together

```
Claude Code or Desktop  --stdio-->  the corrente MCP server  --ws://localhost:8765-->  the Corrente tab, or the plugin's window
```

- The server only talks to pages served from your own machine (`localhost`), so the app has to be
  the one `yarn dev` serves, not a copy on the web. The plugin's window counts as one of those.
- With several Corrente tabs open, the agent drives the one you used last.
- If another session already holds the server's port, the newest session takes it over.

## When it doesn't connect

- **It edits but nothing plays.** Press **Start audio**: browsers won't play sound until the page has
  been clicked, though the agent can edit before that.
- **The server isn't running.** Reconnect it from Claude Code's `/mcp` menu. In Claude Desktop,
  Settings, Developer shows whether it started, and its log says why not.
- **Port 8765 is taken** by something other than Corrente. Close it and reconnect.
- **The page isn't on localhost.** Open the app from `http://localhost:5155`.

## Online

Corrente online, which is in preview, has its own MCP server for signed-in accounts, which connects
to Claude as a connector, with nothing to install.
