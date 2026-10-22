// Injected into every page the spike's webview loads (editor.rs): reports errors, and once the page
// has loaded, what it can use, through the plugin's log.
(() => {
  const log = (text) => window.ipc.postMessage(JSON.stringify({ type: "log", text }));
  addEventListener("error", (event) => log(`error: ${event.message} (${event.filename}:${event.lineno})`));
  addEventListener("unhandledrejection", (event) => log(`unhandled rejection: ${event.reason}`));
  addEventListener("load", () =>
    setTimeout(async () => {
      let opfs = "no";
      try {
        await navigator.storage.getDirectory();
        opfs = "yes";
      } catch (error) {
        opfs = `no (${error})`;
      }
      log(
        [
          `report for ${location.href}: title "${document.title}"`,
          `${document.querySelectorAll("button").length} buttons`,
          `AudioContext ${"AudioContext" in window}`,
          `AudioWorklet ${"AudioWorkletNode" in window}`,
          `OPFS ${opfs}`,
          `service worker ${"serviceWorker" in navigator}`,
          `secure context ${isSecureContext}`,
        ].join(", "),
      );
    }, 2500),
  );
})();
