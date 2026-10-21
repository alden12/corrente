/**
 * Whether this client is too old to keep going (HOST-23.1): the server refused its protocol version,
 * or a stored project was saved by a newer app. Either way the fix is the same, a reload onto the new
 * build, so the app shows one required update notice for both. Once set it stays set for the session.
 *
 * Client-side state, so not in the contract's barrel the server imports.
 */
import { createValueStore } from "../listeners";

const outdated = createValueStore(false);

export const markOutdated = (): void => outdated.set(true);
export const isOutdated = outdated.read;
export const subscribeOutdated = outdated.subscribe;
