// index.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getData, refreshData, startScheduler } from './lib/sheets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.static(path.join(__dirname, 'public')));

// Отдаёт закэшированные данные, при необходимости фоново обновляясь.
app.get('/api/data', async (req, res) => {
  try {
    const data = await getData();
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'failed', message: e.message });
  }
});

// Кнопка "Обновить сейчас" на фронтенде — форсирует свежую загрузку из Google Sheets.
app.post('/api/refresh', async (req, res) => {
  try {
    const data = await refreshData();
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'refresh_failed', message: e.message });
  }
});

// Путь проверки состояния — можно указать в настройках App Platform.
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`ЭР и АКК дашборд слушает порт ${PORT}`);
  startScheduler();
});
