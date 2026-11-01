# Corrente as a plugin

Corrente's instruments and effects can play inside your DAW (digital audio workstation) as a VST3
plugin. It's in beta: things move, and some will break.

You need a DAW that loads VST3 plugins, such as Ableton Live, Bitwig Studio, Reaper, Cubase, Studio One
or FL Studio. Logic Pro and GarageBand only load Audio Units, so they can't run it yet.

## Download it

Get the zip for your computer from the [releases page](https://github.com/alden12/corrente/releases):
`macOS` for any Mac (Apple silicon and Intel), `Windows` for 64-bit Windows 10 or 11.

## Install it on a Mac

1. **Unzip it**, and move `Corrente.vst3` into `~/Library/Audio/Plug-Ins/VST3/`. In Finder, press
   Cmd+Shift+G and paste that path to get there. Make the `VST3` folder if it isn't there yet.
2. **Let macOS open it.** The plugin isn't signed yet, so macOS blocks it as a download from the
   internet. Unblock it in Terminal:

   ```bash
   xattr -dr com.apple.quarantine ~/Library/Audio/Plug-Ins/VST3/Corrente.vst3
   ```

   Or let your DAW try to load it first, then open System Settings, Privacy & Security, and choose
   **Open Anyway**.

3. **Restart your DAW**, or rescan its plugins (in Ableton Live: Settings, Plug-Ins, Rescan).

## Install it on Windows

1. **Unblock the download.** Windows can mark a downloaded zip as blocked: right-click it, choose
   Properties, and tick **Unblock** if it's there.
2. **Unzip it**, and move `Corrente.vst3` into `C:\Program Files\Common Files\VST3\`. Windows asks
   for permission to put it there.
3. **Restart your DAW**, or rescan its plugins.

## Updating

The plugin's window updates itself from corrente.cloud, so most changes reach you without doing
anything. When an update needs a new version of the plugin itself, its window says so: download the
new zip and replace `Corrente.vst3` the same way, with your DAW closed.

## If it doesn't show up

- Check the folder: it should hold `Corrente.vst3` itself, not a folder that has it inside.
- Check your DAW scans that folder and has VST3 plugins turned on (Ableton Live: Settings, Plug-Ins,
  "Use VST3 Plug-In System Folders").
- On a Mac, run the `xattr` line above again, then rescan.
