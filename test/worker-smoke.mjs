import { parentPort } from "node:worker_threads";
import { readFileSync } from "node:fs";

try {
  const wasmBinary = new Uint8Array(readFileSync(new URL("../dist/freetype.wasm", import.meta.url)));
  // Force the generated glue down its browser Worker branch rather than Node's.
  globalThis.WorkerGlobalScope = class WorkerGlobalScope {};
  globalThis.self = { location: { href: new URL("../dist/freetype.mjs", import.meta.url).href } };
  globalThis.process = undefined;
  const { default: initFreeType } = await import("../dist/index.mjs");
  const ft = await initFreeType({ wasmBinary });
  parentPort.postMessage({ version: ft.version() });
  ft.destroy();
} catch (error) {
  parentPort.postMessage({ error: error.stack || error.message });
}
