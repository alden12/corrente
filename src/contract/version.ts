/**
 * The protocol version client and server agree on (HOST-23.1). Bump `PROTOCOL_VERSION` on any change
 * an older client or server would misread: the HTTP contract, the socket messages, or the edit command
 * set (the server replays the client's commands through `applyEdit`, so a new command kind counts).
 * Additive changes that both sides tolerate don't bump it, which is what keeps forced reloads rare.
 * When a bump is a breaking one for older clients, raise `MIN_PROTOCOL_VERSION` to the oldest the
 * server still understands.
 *
 * The client sends its version on the socket's upgrade (`?protocol=`) and on every HTTP call (a
 * header). A client older than the server's range is told to reload; one newer than the server is a
 * deploy in progress (the static site can land before the API), so it waits and tries again.
 *
 * Pure data, DOM/Node-free - the server imports this.
 */
export const PROTOCOL_VERSION = 1;
/** The oldest client this build's server still serves. */
export const MIN_PROTOCOL_VERSION = 1;

export const PROTOCOL_PARAM = "protocol";
export const PROTOCOL_HEADER = "X-Corrente-Protocol";

/** Socket close codes (application range 4000-4999), echoing HTTP's 426 and 503. */
export const CLOSE_CLIENT_OUTDATED = 4426;
export const CLOSE_SERVER_BEHIND = 4503;

export type ProtocolFit = "ok" | "client-outdated" | "server-behind";

/**
 * How a client's stated version fits this server. A client that states none predates the handshake,
 * which is version 1, so tabs left open across the deploy that added it keep working.
 */
export function protocolFit(
  stated: string | null | undefined,
  current = PROTOCOL_VERSION,
  oldest = MIN_PROTOCOL_VERSION,
): ProtocolFit {
  const version = stated == null || stated === "" ? 1 : Number(stated);
  if (!Number.isInteger(version) || version < oldest) return "client-outdated";
  return version > current ? "server-behind" : "ok";
}
