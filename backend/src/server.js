import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { sendProblem } from './problem.js';
import { requireAdmin } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
export const JWT_SECRET = process.env.JWT_SECRET || 'super-sekretny-klucz-jwt-zai-2026';

app.use(cors());

// Nagłówki bezpieczeństwa wymagane w etapie E2 (A4)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://smart-fishery-api.onrender.com"
  );
  next();
});

// 1. Obsługa 415 Unsupported Media Type przy nieobsługiwanym Content-Type dla żądań z ciałem
app.use((req, res, next) => {
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method) && 
                  req.headers['content-length'] && 
                  req.headers['content-length'] !== '0';

  if (hasBody) {
    const ct = req.headers['content-type'];
    if (ct && !ct.includes('application/json')) {
      return sendProblem(res, 415, 'Unsupported Media Type', 'Oczekiwano Content-Type: application/json');
    }
  }
  next();
});

// Parsowanie JSON z wyłapaniem błędu składni (400 Bad Request w RFC 9457)
app.use(express.json({
  verify: (req, res, buf) => {
    try {
      if (buf.length) JSON.parse(buf.toString());
    } catch {
      sendProblem(res, 400, 'Bad Request', 'Niepoprawny format JSON');
      throw new Error('Invalid JSON');
    }
  }
}));

// Obsługa błędów parsowania
app.use((err, req, res, next) => {
  if (err.message === 'Invalid JSON') return;
  next(err);
});

// 2. Weryfikacja nagłówka Accept (kod 406 tylko dla endpointów API)
app.use('/api', (req, res, next) => {
  if (req.headers.accept && !req.accepts(['application/json', 'json', '*/*'])) {
    return res.status(406).end();
  }
  next();
});

// 3. Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 4. Logowanie administratora
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return sendProblem(res, 400, 'Bad Request', 'Brakujący login lub hasło');
  }

  const user = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return sendProblem(res, 401, 'Unauthorized', 'Nieprawidłowy login lub hasło');
  }

  const expiresIn = 3600;
  const accessToken = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn });

  return res.json({
    accessToken,
    tokenType: 'Bearer',
    expiresIn
  });
});

// 5. Wylogowanie administratora (unieważnienie tokenu)
app.post('/api/auth/logout', requireAdmin, (req, res) => {
  try {
    db.prepare('INSERT OR IGNORE INTO revoked_tokens (token, revoked_at) VALUES (?, ?)')
      .run(req.rawToken, new Date().toISOString());
  } catch (e) {
    // ignoruj błąd duplikatu
  }
  return res.status(204).end();
});

// 6. Zmiana hasła administratora
app.put('/api/auth/password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return sendProblem(res, 400, 'Bad Request', 'Wymagane obecne i nowe hasło');
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return sendProblem(res, 422, 'Unprocessable Content', 'Nowe hasło musi mieć min. 8 znaków');
  }

  const user = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return sendProblem(res, 403, 'Forbidden', 'Podane bieżące hasło jest niepoprawne');
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(newHash, user.id);

  return res.status(204).end();
});

function formatSeries(row) {
  return {
    id: row.id,
    name: row.name,
    minValue: row.min_value,
    maxValue: row.max_value,
    color: row.color,
    icon: row.icon || null,
    unit: row.unit || null
  };
}

// 7. Lista serii
app.get('/api/series', (req, res) => {
  const rows = db.prepare('SELECT * FROM series ORDER BY id ASC').all();
  res.json(rows.map(formatSeries));
});

// 8. Tworzenie serii
app.post('/api/series', requireAdmin, (req, res) => {
  const { name, minValue, maxValue, color, icon, unit } = req.body || {};

  if (!name || minValue === undefined || maxValue === undefined || !color) {
    return sendProblem(res, 400, 'Bad Request', 'Brakujące wymagane pola serii');
  }

  const hexRegex = /^#[0-9A-Fa-f]{6}$/;
  if (!hexRegex.test(color)) {
    return sendProblem(res, 422, 'Unprocessable Content', 'Kolor musi być w formacie #RRGGBB');
  }

  if (Number(minValue) >= Number(maxValue)) {
    return sendProblem(res, 422, 'Unprocessable Content', 'minValue musi być mniejsze od maxValue');
  }

  const stmt = db.prepare(`
    INSERT INTO series (name, min_value, max_value, color, icon, unit)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(name, Number(minValue), Number(maxValue), color, icon || null, unit || null);
  const created = db.prepare('SELECT * FROM series WHERE id = ?').get(result.lastInsertRowid);

  res.setHeader('Location', `/api/series/${created.id}`);
  return res.status(201).json(formatSeries(created));
});

// 9. Odczyt pojedynczej serii
app.get('/api/series/:seriesId', (req, res) => {
  const row = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.seriesId);
  if (!row) {
    return sendProblem(res, 404, 'Not Found', 'Seria nie istnieje');
  }
  return res.json(formatSeries(row));
});

// 10. Aktualizacja serii
app.put('/api/series/:seriesId', requireAdmin, (req, res) => {
  const seriesId = req.params.seriesId;
  const existing = db.prepare('SELECT * FROM series WHERE id = ?').get(seriesId);
  if (!existing) {
    return sendProblem(res, 404, 'Not Found', 'Seria nie istnieje');
  }

  const { name, minValue, maxValue, color, icon, unit } = req.body || {};
  if (!name || minValue === undefined || maxValue === undefined || !color) {
    return sendProblem(res, 400, 'Bad Request', 'Brakujące wymagane pola serii');
  }

  const hexRegex = /^#[0-9A-Fa-f]{6}$/;
  if (!hexRegex.test(color)) {
    return sendProblem(res, 422, 'Unprocessable Content', 'Kolor musi być w formacie #RRGGBB');
  }

  const minNum = Number(minValue);
  const maxNum = Number(maxValue);
  if (minNum >= maxNum) {
    return sendProblem(res, 422, 'Unprocessable Content', 'minValue musi być mniejsze od maxValue');
  }

  const outOfRange = db.prepare(`
    SELECT id FROM measurements 
    WHERE series_id = ? AND (value < ? OR value > ?) 
    LIMIT 1
  `).get(seriesId, minNum, maxNum);

  if (outOfRange) {
    return sendProblem(res, 409, 'Conflict', 'Nowy przedział wyklucza istniejące wyniki');
  }

  db.prepare(`
    UPDATE series 
    SET name = ?, min_value = ?, max_value = ?, color = ?, icon = ?, unit = ?
    WHERE id = ?
  `).run(name, minNum, maxNum, color, icon || null, unit || null, seriesId);

  const updated = db.prepare('SELECT * FROM series WHERE id = ?').get(seriesId);
  return res.json(formatSeries(updated));
});

// 11. Usunięcie serii
app.delete('/api/series/:seriesId', requireAdmin, (req, res) => {
  const seriesId = req.params.seriesId;
  const existing = db.prepare('SELECT * FROM series WHERE id = ?').get(seriesId);
  if (!existing) {
    return sendProblem(res, 404, 'Not Found', 'Seria nie istnieje');
  }

  db.prepare('DELETE FROM sensors WHERE series_id = ?').run(seriesId);
  db.prepare('DELETE FROM measurements WHERE series_id = ?').run(seriesId);
  db.prepare('DELETE FROM series WHERE id = ?').run(seriesId);

  return res.status(204).end();
});

// 12. Lista czujników
function formatSensor(row) {
  const lastM = db.prepare(`
    SELECT timestamp FROM measurements 
    WHERE sensor_id = ? 
    ORDER BY timestamp DESC LIMIT 1
  `).get(row.id);

  return {
    id: row.id,
    name: row.name,
    seriesId: row.series_id,
    createdAt: row.created_at,
    lastMeasurementAt: lastM ? lastM.timestamp : null
  };
}

app.get('/api/sensors', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM sensors WHERE is_active = 1 ORDER BY id ASC').all();
  res.json(rows.map(formatSensor));
});

// 13. Rejestracja czujnika
app.post('/api/sensors', requireAdmin, (req, res) => {
  const { name, seriesId } = req.body || {};
  if (!name || seriesId === undefined) {
    return sendProblem(res, 400, 'Bad Request', 'Wymagane pola: name, seriesId');
  }

  const series = db.prepare('SELECT id FROM series WHERE id = ?').get(seriesId);
  if (!series) {
    return sendProblem(res, 422, 'Unprocessable Content', 'Wskazana seria nie istnieje');
  }

  const rawApiKey = crypto.randomBytes(32).toString('hex');
  const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
  const createdAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO sensors (name, series_id, api_key_hash, is_active, created_at)
    VALUES (?, ?, ?, 1, ?)
  `);
  const result = stmt.run(name, seriesId, apiKeyHash, createdAt);
  const created = db.prepare('SELECT * FROM sensors WHERE id = ?').get(result.lastInsertRowid);

  res.setHeader('Location', `/api/sensors/${created.id}`);
  return res.status(201).json({
    ...formatSensor(created),
    apiKey: rawApiKey
  });
});

// 14. Odczyt czujnika
app.get('/api/sensors/:sensorId', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM sensors WHERE id = ? AND is_active = 1').get(req.params.sensorId);
  if (!row) {
    return sendProblem(res, 404, 'Not Found', 'Czujnik nie istnieje lub został wyrejestrowany');
  }
  return res.json(formatSensor(row));
});

// 15. Wyrejestrowanie czujnika
app.delete('/api/sensors/:sensorId', requireAdmin, (req, res) => {
  const sensorId = req.params.sensorId;
  const existing = db.prepare('SELECT * FROM sensors WHERE id = ? AND is_active = 1').get(sensorId);
  if (!existing) {
    return sendProblem(res, 404, 'Not Found', 'Czujnik nie istnieje');
  }

  db.prepare('UPDATE sensors SET is_active = 0 WHERE id = ?').run(sensorId);
  return res.status(204).end();
});

// 16. Pobieranie pomiarów
function formatMeasurement(row) {
  return {
    id: row.id,
    seriesId: row.series_id,
    sensorId: row.sensor_id,
    value: row.value,
    timestamp: row.timestamp
  };
}

app.get('/api/measurements', (req, res) => {
  const { series, from, to, sort = 'timestamp', limit = 1000 } = req.query;

  if (from && isNaN(Date.parse(from))) {
    return sendProblem(res, 400, 'Bad Request', 'Parametr "from" zawiera niepoprawną datę ISO 8601');
  }
  if (to && isNaN(Date.parse(to))) {
    return sendProblem(res, 400, 'Bad Request', 'Parametr "to" zawiera niepoprawną datę ISO 8601');
  }

  let query = 'SELECT * FROM measurements WHERE 1=1';
  const params = [];

  if (series) {
    const seriesIds = series.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    if (seriesIds.length > 0) {
      query += ` AND series_id IN (${seriesIds.map(() => '?').join(',')})`;
      params.push(...seriesIds);
    }
  }

  if (from) {
    query += ' AND timestamp >= ?';
    params.push(from);
  }

  if (to) {
    query += ' AND timestamp <= ?';
    params.push(to);
  }

  const orderDir = sort === '-timestamp' ? 'DESC' : 'ASC';
  query += ` ORDER BY timestamp ${orderDir} LIMIT ?`;
  params.push(Math.min(Number(limit) || 1000, 10000));

  const rows = db.prepare(query).all(...params);
  return res.json(rows.map(formatMeasurement));
});

// 17. Zapis pomiaru
app.post('/api/measurements', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return sendProblem(res, 401, 'Unauthorized', 'Brak nagłówka X-API-Key');
  }

  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const sensor = db.prepare('SELECT * FROM sensors WHERE api_key_hash = ? AND is_active = 1').get(keyHash);

  if (!sensor) {
    return sendProblem(res, 401, 'Unauthorized', 'Nieprawidłowy lub unieważniony klucz API');
  }

  const { value, timestamp } = req.body || {};
  if (value === undefined || typeof value !== 'number') {
    return sendProblem(res, 400, 'Bad Request', 'Brak lub niepoprawna wartość pomiaru (value)');
  }

  const targetSeries = db.prepare('SELECT * FROM series WHERE id = ?').get(sensor.series_id);
  if (!targetSeries) {
    return sendProblem(res, 401, 'Unauthorized', 'Przypisana seria nie istnieje');
  }

  if (value < targetSeries.min_value || value > targetSeries.max_value) {
    return sendProblem(
      res,
      422,
      'Unprocessable Content',
      `Wartość ${value} wykracza poza zakres [${targetSeries.min_value}, ${targetSeries.max_value}]`
    );
  }

  let finalTimestamp = timestamp;
  if (!finalTimestamp) {
    finalTimestamp = new Date().toISOString();
  } else {
    const parsedTime = new Date(finalTimestamp).getTime();
    if (isNaN(parsedTime)) {
      return sendProblem(res, 400, 'Bad Request', 'Niepoprawny format daty ISO 8601');
    }
    const maxAllowedFuture = Date.now() + 5 * 60 * 1000;
    if (parsedTime > maxAllowedFuture) {
      return sendProblem(res, 422, 'Unprocessable Content', 'Znacznik czasu wybiega w przyszłość o ponad 5 minut');
    }
  }

  const stmt = db.prepare(`
    INSERT INTO measurements (series_id, sensor_id, value, timestamp)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(sensor.series_id, sensor.id, value, finalTimestamp);
  const created = db.prepare('SELECT * FROM measurements WHERE id = ?').get(result.lastInsertRowid);

  res.setHeader('Location', `/api/measurements/${created.id}`);
  return res.status(201).json(formatMeasurement(created));
});

// 18. Odczyt pojedynczego pomiaru
app.get('/api/measurements/:measurementId', (req, res) => {
  const row = db.prepare('SELECT * FROM measurements WHERE id = ?').get(req.params.measurementId);
  if (!row) {
    return sendProblem(res, 404, 'Not Found', 'Pomiar nie istnieje');
  }
  return res.json(formatMeasurement(row));
});

app.all('/api/measurements/:measurementId', (req, res) => {
  if (['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return sendProblem(res, 405, 'Method Not Allowed', 'Wyniki pomiarów nie podlegają edycji ani usuwaniu');
  }
});

// 19. Serwowanie zbudowanego frontendu SPA
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Serwer ZAI działa pod adresem: http://localhost:${PORT}`);
});