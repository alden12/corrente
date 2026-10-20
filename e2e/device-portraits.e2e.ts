/**
 * Portraits of what the user made (COMM-1.9.6): a custom instrument's portrait is drawn on the
 * browser's render worker when a card asks for it, kept in IndexedDB by its content's hash, and read
 * back from there after a reload rather than drawn again.
 */
import { test, expect } from "@playwright/test";

test("a custom instrument's portrait is drawn on the render worker and kept across a reload", async ({ page }) => {
  await page.goto("/");
  const portraitOf = () =>
    page.evaluate(async () => {
      const cache = await import(/* @vite-ignore */ "/src/audio/portraits/portraitCache.ts");
      const device = {
        type: "ci-e2e-portrait",
        label: "Portrait Me",
        schema: [{ id: "level", label: "Level", kind: "number" as const, min: 0, max: 1, default: 0.8 }],
        definition: {
          format: 1,
          nodes: {
            osc: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
            envelope: { block: "adsr", voice: true, inputs: { gate: "voice.gate" } },
            amp: { block: "mul", voice: true, inputs: { a: "osc", b: "envelope" } },
          },
          voice: "amp",
        },
      };
      const job = { kind: "instrument" as const, type: device.type, devices: { instruments: [device] } };
      const key = await cache.portraitKey(job);
      const portrait = await new Promise<{ line?: string; fill?: string }>((resolve) => {
        const arrived = () => {
          const known = cache.knownPortrait(key);
          if (!known) return;
          stop();
          resolve(known);
        };
        const stop = cache.subscribePortraits(arrived);
        cache.wantPortrait(key, job);
        arrived();
      });
      const kept = await new Promise<boolean>((resolve) => {
        const opened = indexedDB.open("corrente-portraits");
        opened.onsuccess = () => {
          const read = opened.result.transaction("portraits").objectStore("portraits").get(key);
          read.onsuccess = () => resolve(read.result !== undefined);
        };
      });
      return { drawn: (portrait.line ?? portrait.fill ?? "").length, kept };
    });

  const first = await portraitOf();
  expect(first.drawn).toBeGreaterThan(20);
  expect(first.kept).toBe(true);

  await page.reload();
  const second = await portraitOf();
  expect(second.drawn).toBe(first.drawn);
});
