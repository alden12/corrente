import { describe, expect, it } from "vitest";
import { hostingFrom } from "../src/hosting";

describe("hostingFrom", () => {
  it("is standalone with no API, keeping nothing else either", () => {
    expect(hostingFrom({})).toEqual({ mode: "standalone", canSignIn: false, auth: undefined, links: {} });
  });

  it("counts blank settings as unset, as the test build blanks them", () => {
    const blank = { VITE_DAW_API_URL: "", VITE_SUPABASE_URL: " ", VITE_SUPABASE_ANON_KEY: "" };
    expect(hostingFrom(blank)).toMatchObject({ mode: "standalone", auth: undefined });
  });

  it("is hosted with an API, with sign-in only when both of its settings are there", () => {
    const hosted = hostingFrom({ VITE_DAW_API_URL: "http://localhost:5170", VITE_SUPABASE_URL: "https://auth.test" });
    expect(hosted).toMatchObject({ mode: "hosted", apiUrl: "http://localhost:5170", auth: undefined });

    const signedIn = hostingFrom({
      VITE_DAW_API_URL: "https://corrente.cloud",
      VITE_SUPABASE_URL: "https://auth.test",
      VITE_SUPABASE_ANON_KEY: "public-key",
    });
    expect(signedIn.auth).toEqual({ url: "https://auth.test", anonKey: "public-key" });
  });

  it("is standalone on a hosted build this device chose to continue signed out on, with sign-in a step away", () => {
    const site = {
      VITE_DAW_API_URL: "https://corrente.cloud",
      VITE_SUPABASE_URL: "https://auth.test",
      VITE_SUPABASE_ANON_KEY: "public-key",
      VITE_INTEREST_URL: "https://forms.test/join",
    };
    expect(hostingFrom(site, true)).toEqual({
      mode: "standalone",
      canSignIn: true,
      auth: undefined,
      links: { hostedApp: undefined, interest: "https://forms.test/join" },
    });
  });

  it("ignores the signed-out choice on a build with no server, where there's nothing to sign in to", () => {
    expect(hostingFrom({}, true)).toMatchObject({ mode: "standalone", canSignIn: false });
  });

  it("carries the links in either mode", () => {
    const links = { VITE_HOSTED_APP_URL: "https://corrente.cloud", VITE_INTEREST_URL: "https://forms.test/join" };
    expect(hostingFrom(links).links).toEqual({
      hostedApp: "https://corrente.cloud",
      interest: "https://forms.test/join",
    });
  });
});
