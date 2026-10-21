import { Worker } from 'node:worker_threads';
let pending = false;
export async function importWorkbook(buffer, options = {}) {
  if (pending) throw new Error('Другая книга уже обрабатывается. Дождитесь завершения импорта.');
  pending = true;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./import-worker.js', import.meta.url), {
        workerData: { buffer, options }, resourceLimits: { maxOldGenerationSizeMb: 1536 },
      });
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Обработка книги заняла больше 3 минут')); }, 180000);
      const done = () => { clearTimeout(timer); worker.terminate(); };
      worker.once('message', msg => { done(); msg.ok ? resolve(msg.result) : reject(new Error(msg.error)); });
      worker.once('error', err => { done(); reject(new Error(`Не удалось обработать книгу: ${err.message}`)); });
      worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Обработка книги прервана')); });
    });
  } finally { pending = false; }
}
