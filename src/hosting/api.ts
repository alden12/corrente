/**
 * The sync API, as the signed-in account reaches it: one client for everything that syncs (sharing,
 * the library, favourites), or null when standalone. The token is read per request, so a refreshed
 * session takes effect without rebuilding it.
 */
import { createApiClient, type ApiClient } from "../contract/client";
import { getAccessToken, onUnauthorized } from "../auth/session";
import { hosting } from ".";

export const apiClient: ApiClient | null =
  hosting.mode === "hosted"
    ? createApiClient({ baseUrl: hosting.apiUrl, token: getAccessToken, onUnauthorized })
    : null;
