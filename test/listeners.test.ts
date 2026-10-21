import { describe, expect, it, vi } from "vitest";
import { createListeners, createValueStore } from "../src/listeners";

describe("createListeners", () => {
  it("calls every listener with the arguments, until it unsubscribes", () => {
    const listeners = createListeners<[string, number]>();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = listeners.subscribe(first);
    listeners.subscribe(second);
    listeners.emit("gain", 0.5);
    stopFirst();
    listeners.emit("pan", -1);
    expect(first.mock.calls).toEqual([["gain", 0.5]]);
    expect(second.mock.calls).toEqual([
      ["gain", 0.5],
      ["pan", -1],
    ]);
  });

  it("lets a listener unsubscribe itself while being called", () => {
    const listeners = createListeners();
    const later = vi.fn();
    const stop = listeners.subscribe(() => stop());
    listeners.subscribe(later);
    listeners.emit();
    listeners.emit();
    expect(later).toHaveBeenCalledTimes(2);
  });
});

describe("createValueStore", () => {
  it("reads the value it was last set to", () => {
    const store = createValueStore(1);
    store.set(2);
    expect(store.read()).toBe(2);
  });

  it("notifies only when the value changes", () => {
    const store = createValueStore("idle");
    const listener = vi.fn();
    store.subscribe(listener);
    store.set("idle");
    store.set("playing");
    store.set("playing");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("works with its members passed on their own, as useSyncExternalStore takes them", () => {
    const { read, set, subscribe } = createValueStore(false);
    const listener = vi.fn();
    subscribe(listener);
    set(true);
    expect([read(), listener.mock.calls.length]).toEqual([true, 1]);
  });
});
