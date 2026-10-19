/**
 * The few WebAssembly types the engine's code names (bank/exports.ts, bank.ts), for the Node side.
 * Node runs WebAssembly, but its types live in TypeScript's DOM library, which the server leaves out
 * to stay DOM-free; the app's own config has the real ones.
 */
type BufferSource = ArrayBufferView | ArrayBuffer;

declare namespace WebAssembly {
  class Memory {
    readonly buffer: ArrayBuffer;
  }
  class Module {
    constructor(bytes: BufferSource);
  }
  class Instance {
    constructor(module: Module, imports?: Record<string, unknown>);
    readonly exports: Record<string, unknown>;
  }
}
