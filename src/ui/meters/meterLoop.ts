/**
 * One animation-frame loop for every level meter on screen (DAW-8.5), rather than one each: a mix
 * with forty faders would otherwise schedule forty callbacks a frame. A meter subscribes while it is
 * mounted and is handed the frame's time; the loop runs only while something listens.
 */
type Tick = (now: number) => void;

const ticks = new Set<Tick>();
let frame = 0;

const loop = (now: number) => {
  ticks.forEach((tick) => tick(now));
  frame = ticks.size > 0 ? requestAnimationFrame(loop) : 0;
};

/** Call `tick` every frame until the returned function is called. */
export function onMeterFrame(tick: Tick): () => void {
  ticks.add(tick);
  if (!frame) frame = requestAnimationFrame(loop);
  return () => {
    ticks.delete(tick);
    if (ticks.size === 0 && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}
