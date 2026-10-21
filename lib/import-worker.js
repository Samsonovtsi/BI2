import { parentPort, workerData } from 'node:worker_threads';
import { parseWorkbook } from './workbook-loader.js';
try {
  parentPort.postMessage({ ok: true, result: parseWorkbook(Buffer.from(workerData.buffer), workerData.options) });
} catch (e) { parentPort.postMessage({ ok: false, error: e.message }); }
