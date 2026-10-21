import { parentPort } from 'node:worker_threads';

// Loaded from the physical package, so each operation owns its Photon/WASM heap.
try {
  const { resizeImageOnMainThread } = await import('./chunks/chunk-GMLXHJYG.js');
  parentPort.once('message', async message => {
    try {
      if (!(message?.inputBytes instanceof Uint8Array) || typeof message.mimeType !== 'string') throw Error('Invalid image resize worker input');
      const result = await resizeImageOnMainThread(message.inputBytes, message.mimeType, message.options);
      parentPort.postMessage({ result });
    } catch (error) {
      parentPort.postMessage({ error: error.message, name: error.name });
    }
  });
  parentPort.postMessage({ ready: true });
} catch (error) {
  parentPort.postMessage({ startup: true, error: error.message, name: error.name });
}
