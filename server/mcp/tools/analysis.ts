/** MCP tools: listening to the mix and to one sound (AGENT-4.9, AGENT-4.6), rendered on the engine render core and measured. */
import { z } from "zod";
import { ok, fail, type ToolResult } from "../shared";
import type { ToolContext } from "../context";
import { PHRASE_NAMES, PHRASES } from "../../../src/audio/analysis/phrases";
import type { DeviceAnalysis } from "../../../src/audio/analysis/analyzeDevice";

const phraseList = PHRASE_NAMES.map((name) => `"${name}" (${PHRASES[name].says})`).join(", ");

export function registerAnalysisTools({ server, target, trackArg, resolveTrack }: ToolContext): void {
  server.registerTool(
    "analyze_mix",
    {
      title: "Analyze mix",
      description:
        "Render the whole arrangement (the audio the user would hear) and measure it, naming the project it heard: peak level and headroom (dBFS) " +
        "going into the master, whether it clips, and overall loudness (RMS dBFS), with a plain-language note. " +
        "Anything the render couldn't play is listed under `omitted`. Use it to check your work - that the mix " +
        "isn't clipping, too quiet or too hot - before telling the user you're done.",
      inputSchema: {},
    },
    async () => {
      try {
        const reply = await target.analyzeMix();
        if (!reply.ok) return fail(reply.error ?? "Couldn't analyze the mix.");
        // Named, so it's clear which project was heard: the local server hears whatever the tab has open.
        return ok(JSON.stringify({ project: target.project.name, ...(reply.result as object) }, null, 2));
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "analyze_device",
    {
      title: "Analyze a track's sound",
      description:
        "Render one track's sound on its own - its MIDI devices, instrument and effects, without the rest of the mix, " +
        "its groups' effects or its fader - and measure it: levels (as analyze_mix), octave-band balance (dBFS RMS by " +
        "band centre), spectral centroid (low is dark, high is bright) and stereo correlation (1 mono, 0 wide). " +
        "`picture: true` adds a spectrogram image with labelled axes, where filter sweeps, envelopes, vibrato, detune, " +
        "noise and mud show; read it for mechanics (what changes where), and use it to check a sound you're designing " +
        "does what you meant. It costs more tokens, so ask for it when the numbers aren't enough. " +
        `\`play\`: its own notes ("track", the default when it has any, up to 32 beats), or a phrase that suits its ` +
        `role, at the project's tempo: ${phraseList}. Pick the phrase for its role: chords make a lead read like a pad. ` +
        '`through`: an effect id to hear the chain only up to and including it, or "instrument" for the instrument alone.',
      inputSchema: {
        ...trackArg,
        play: z.enum(["track", ...PHRASE_NAMES]).optional(),
        through: z.string().optional(),
        picture: z.boolean().optional(),
      },
    },
    async ({ track, play, through, picture }): Promise<ToolResult> => {
      const resolved = resolveTrack(track);
      if ("error" in resolved) return fail(resolved.error);
      try {
        const reply = await target.analyzeDevice({ track: resolved.id, play, through, picture });
        if (!reply.ok) return fail(reply.error ?? "Couldn't analyze the sound.");
        const { summary, picture: png } = reply.result as DeviceAnalysis;
        const text = JSON.stringify({ track: resolved.track.name, ...summary }, null, 2);
        return {
          content: [
            { type: "text", text },
            ...(png ? [{ type: "image" as const, data: png, mimeType: "image/png" }] : []),
          ],
        };
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
