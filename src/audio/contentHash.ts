/**
 * Content hashes: what makes "the same" checkable rather than assumed. A sample's bytes, and a
 * library version's document (COMM-1.11), each named by the SHA-256 of their content, the same in
 * the browser and on the server (both have `crypto.subtle`).
 */

/** The hex SHA-256 of some bytes. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A value with its objects' keys in order, so two copies compare equal however they were built. */
const ordered = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(ordered)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, entry]) => [key, ordered(entry)]),
        )
      : value;

/** JSON with its keys in order: one text for one value, wherever it was made. */
export const canonicalJson = (value: unknown): string => JSON.stringify(ordered(value));

/** The hash of a JSON document, independent of key order: a library version's identity. */
export const documentHash = (value: unknown): Promise<string> =>
  sha256Hex(new TextEncoder().encode(canonicalJson(value)));
