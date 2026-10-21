/**
 * The one way to keep a set of listeners (ARCH-12), in place of a hand-written `Set` in every store.
 * DOM-free, so the audio code and the local MCP use it too. React reads either through
 * `useSyncExternalStore`, whose `subscribe` this matches; both hand back closures, so their members can
 * be passed around on their own.
 */

/** Listeners to notify, for something that keeps its own state and only says when it changed. */
export interface Listeners<Args extends unknown[] = []> {
  /** Add a listener. Returns the function that removes it. */
  subscribe: (listener: (...args: Args) => void) => () => void;
  /** Call every listener with `args`. */
  emit: (...args: Args) => void;
}

export function createListeners<Args extends unknown[] = []>(): Listeners<Args> {
  const listeners = new Set<(...args: Args) => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit: (...args) => listeners.forEach((listener) => listener(...args)),
  };
}

/** One value and the listeners to tell when it changes. */
export interface ValueStore<T> {
  read: () => T;
  /** Replace the value, notifying only if it differs (`Object.is`). */
  set: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const { subscribe, emit } = createListeners();
  return {
    read: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      emit();
    },
    subscribe,
  };
}
