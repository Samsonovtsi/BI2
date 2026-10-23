// index.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { getData, refreshData, startScheduler, applyUploadedWorkbook } from './lib/sheets.js';
import { getPlans, savePlan, deletePlan, listSnapshots, getSnapshot } from './lib/operations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 МБ; обработка в отдельном worker
  fileFilter: (req, file, cb) => {
    const okExt = /\.(xlsx|xlsm)$/i.test(file.originalname || '');
    if (!okExt) return cb(new Error('Ожидается файл .xlsx или .xlsm'));
    cb(null, true);
  },
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({limit:'32kb'}));

app.get('/api/plans', (req,res) => { try { res.json(getPlans()); } catch(e) { res.status(500).json({message:e.message}); } });
app.put('/api/plans', async (req,res) => {
  try { res.json(savePlan(req.body)); } catch(e) { res.status(400).json({message:e.message}); }
});
app.delete('/api/plans/:id', (req,res) => { try { res.json(deletePlan(req.params.id)); } catch(e) { res.status(500).json({message:e.message}); } });
app.get('/api/snapshots', (req,res) => { try { res.json(listSnapshots()); } catch(e) { res.status(500).json({message:e.message}); } });
app.get('/api/snapshots/:id', (req,res) => {
  try { const snapshot=getSnapshot(req.params.id); if(!snapshot) return res.status(404).json({message:'Срез не найден'}); res.json(snapshot); }
  catch(e) { res.status(500).json({message:e.message}); }
});

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

// Загрузка Excel-файла (например, полной выгрузки "Карта онлайн (ЭР, Аккредитивы)").
// Разбирает известные листы, обновляет текущие данные дашборда и отвечает
// сводкой: какие сервисы (ЭР/Дом Клик/АКК/Калькулятор) и за какие месяцы найдены.
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: 'upload_failed', message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'no_file', message: 'Файл не передан (поле "file")' });
    }
    try {
      const result = await applyUploadedWorkbook(req.file.buffer, req.file.originalname);
      res.set('Cache-Control', 'no-store');
      res.json({
        ok: true,
        fileName: result.fileName,
        sheetsFound: result.sheetsFound,
        services: result.services,
        generatedAt: result.data.generatedAt,
      });
    } catch (e) {
      res.status(422).json({ error: 'parse_failed', message: e.message });
    }
  });
});

// Путь проверки состояния — можно указать в настройках App Platform.
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), schemaVersion: 3 });
});

app.listen(PORT, () => {
  console.log(`ЭР и АКК дашборд слушает порт ${PORT}`);
  startScheduler();
});

