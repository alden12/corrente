/**
 * Portraits of what the user made (COMM-1.9.6): a custom instrument's portrait is drawn on the
 * browser's render worker when a card asks for it, kept in IndexedDB by its content's hash, and read
 * back from there after a reload rather than drawn again.
 */
import { test, expect, type Page } from "@playwright/test";

type Cache = typeof import("../src/audio/portraits/portraitCache");
/** What `prepare` leaves on the page's `window` (types only: they vanish before the page sees them). */
type Prepared = { portraitTest: { cache: Cache; job: Parameters<Cache["wantPortrait"]>[1] } };

/** In the page: a custom instrument's portrait job and its cache key, the cache kept on `window` for later steps. */
const prepare = (page: Page, type: string) =>
  page.evaluate(async (type) => {
    const cache = await import(/* @vite-ignore */ "/src/audio/portraits/portraitCache.ts");
    const job = {
      kind: "instrument" as const,
      type,
      devices: {
        instruments: [
          {
            type,
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
          },
        ],
      },
    };
    Object.assign(window, { portraitTest: { cache, job } });
    return cache.portraitKey(job);
  }, type);

test("a portrait that couldn't be drawn offline is drawn once back online, without a reload", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const key = await prepare(page, "ci-e2e-offline");
  await context.setOffline(true);
  const offline = await page.evaluate(async (key) => {
    const { cache, job } = (window as unknown as Prepared).portraitTest;
    cache.wantPortrait(key, job); // stays wanted, as a card on screen does
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return cache.knownPortrait(key);
  }, key);
  expect(offline).toBeUndefined();

  await context.setOffline(false);
  await expect
    .poll(() =>
      page.evaluate((key) => (window as unknown as Prepared).portraitTest.cache.knownPortrait(key) !== undefined, key),
    )
    .toBe(true);
});

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
