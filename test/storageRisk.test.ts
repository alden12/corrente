import { describe, expect, it } from "vitest";
import { isSafari, storageRisk } from "../src/hosting/storageRisk";

describe("storageRisk", () => {
  it("is kept when the browser agreed to keep it", () => {
    expect(storageRisk({ persisted: true, installed: false, safari: false })).toBe("kept");
  });

  it("may be cleared without that", () => {
    expect(storageRisk({ persisted: false, installed: false, safari: false })).toBe("may-clear");
    expect(storageRisk({ persisted: false, installed: true, safari: false })).toBe("may-clear");
  });

  it("is Safari's week in a Safari tab, whatever else it says, but not once installed", () => {
    expect(storageRisk({ persisted: true, installed: false, safari: true })).toBe("week");
    expect(storageRisk({ persisted: true, installed: true, safari: true })).toBe("kept");
  });
});

describe("isSafari", () => {
  const agents = {
    macSafari:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    iphoneSafari:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    chrome:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    iphoneChrome:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
    firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
  };

  it("tells Safari from the browsers that also say Safari", () => {
    expect(
      Object.entries(agents)
        .filter(([, agent]) => isSafari(agent))
        .map(([name]) => name),
    ).toEqual(["macSafari", "iphoneSafari"]);
  });
});
