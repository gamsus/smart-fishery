import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from './db.js';
import { sendProblem } from './problem.js';
import { requireAdmin } from './auth.js';

const app = express();
const PORT = process.env.PORT || 3000;
export const JWT_SECRET = process.env.JWT_SECRET || 'super-sekretny-klucz-jwt-zai-2026';

app.use(cors());
app.use(express.json());

// 1. Weryfikacja nagłówka Accept (kod 406)
app.use((req, res, next) => {
  if (req.headers.accept && !req.accepts(['application/json', 'json', '*/*'])) {
    return res.status(406).end();
  }
  next();
});

// 2. Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 3. Logowanie administratora
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

// 4. Wylogowanie administratora
app.post('/api/auth/logout', requireAdmin, (req, res) => {
  return res.status(204).end();
});

// 5. Zmiana hasła administratora
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

// 6. Lista serii
app.get('/api/series', (req, res) => {
  const rows = db.prepare('SELECT * FROM series ORDER BY id ASC').all();
  res.json(rows.map(formatSeries));
});

// 7. Tworzenie serii
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

// 8. Odczyt serii
app.get('/api/series/:seriesId', (req, res) => {
  const row = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.seriesId);
  if (!row) {
    return sendProblem(res, 404, 'Not Found', 'Seria nie istnieje');
  }
  return res.json(formatSeries(row));
});

// 9. Aktualizacja serii
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

// 10. Usunięcie serii
app.delete('/api/series/:seriesId', requireAdmin, (req, res) => {
  const seriesId = req.params.seriesId;
  const existing = db.prepare('SELECT * FROM series WHERE id = ?').get(seriesId);
  if (!existing) {
    return sendProblem(res, 404, 'Not Found', 'Seria nie istnieje');
  }

  db.prepare('DELETE FROM series WHERE id = ?').run(seriesId);
  return res.status(204).end();
});

// ==========================================
// OBSŁUGA CZUJNIKÓW (/api/sensors)
// ==========================================

function formatSensor(row) {
  // Pobieramy czas ostatniego pomiaru dla danego czujnika
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

// 11. Lista czujników (admin)
app.get('/api/sensors', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM sensors WHERE is_active = 1 ORDER BY id ASC').all();
  res.json(rows.map(formatSensor));
});

// 12. Rejestracja nowego czujnika (admin)
app.post('/api/sensors', requireAdmin, (req, res) => {
  const { name, seriesId } = req.body || {};
  if (!name || seriesId === undefined) {
    return sendProblem(res, 400, 'Bad Request', 'Wymagane pola: name, seriesId');
  }

  const series = db.prepare('SELECT id FROM series WHERE id = ?').get(seriesId);
  if (!series) {
    return sendProblem(res, 422, 'Unprocessable Content', 'Wskazana seria nie istnieje');
  }

  // Generujemy losowy klucz o długości 64 znaków hex (spełnia min. 32 znaki)
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

// 13. Odczyt czujnika (admin)
app.get('/api/sensors/:sensorId', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM sensors WHERE id = ? AND is_active = 1').get(req.params.sensorId);
  if (!row) {
    return sendProblem(res, 404, 'Not Found', 'Czujnik nie istnieje lub został wyrejestrowany');
  }
  return res.json(formatSensor(row));
});

// 14. Wyrejestrowanie czujnika (admin)
app.delete('/api/sensors/:sensorId', requireAdmin, (req, res) => {
  const sensorId = req.params.sensorId;
  const existing = db.prepare('SELECT * FROM sensors WHERE id = ? AND is_active = 1').get(sensorId);
  if (!existing) {
    return sendProblem(res, 404, 'Not Found', 'Czujnik nie istnieje');
  }

  // Deaktywacja czujnika: klucz natychmiast przestaje działać, pomiary zostają
  db.prepare('UPDATE sensors SET is_active = 0 WHERE id = ?').run(sensorId);
  return res.status(204).end();
});

// ==========================================
// OBSŁUGA POMIARÓW (/api/measurements)
// ==========================================

function formatMeasurement(row) {
  return {
    id: row.id,
    seriesId: row.series_id,
    sensorId: row.sensor_id,
    value: row.value,
    timestamp: row.timestamp
  };
}

// 15. Pobieranie pomiarów (publiczne z filtrowaniem)
app.get('/api/measurements', (req, res) => {
  const { series, from, to, sort = 'timestamp', limit = 1000 } = req.query;

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

// 16. Przesłanie wyniku przez czujnik (POST z X-API-Key)
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
    return sendProblem(res, 422, 'Unprocessable Content', 'Przypisana seria nie istnieje');
  }

  // Walidacja zakresu min/max serii
  if (value < targetSeries.min_value || value > targetSeries.max_value) {
    return sendProblem(
      res,
      422,
      'Unprocessable Content',
      `Wartość ${value} wykracza poza dopuszczalny przedział serii [${targetSeries.min_value}, ${targetSeries.max_value}]`
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
    // Wymóg: znacznik czasu nie późniejszy niż 5 minut od bieżącego czasu serwera
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

// 17. Odczyt pojedynczego pomiaru
app.get('/api/measurements/:measurementId', (req, res) => {
  const row = db.prepare('SELECT * FROM measurements WHERE id = ?').get(req.params.measurementId);
  if (!row) {
    return sendProblem(res, 404, 'Not Found', 'Pomiar nie istnieje');
  }
  return res.json(formatMeasurement(row));
});

// Blokada modyfikacji i usuwania wyników (wymóg kontraktu: PUT, PATCH, DELETE -> 405)
app.all('/api/measurements/:measurementId', (req, res) => {
  if (['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return sendProblem(res, 405, 'Method Not Allowed', 'Wyniki pomiarów nie podlegają edycji ani usuwaniu');
  }
});

app.listen(PORT, () => {
  console.log(`Serwer ZAI działa pod adresem: http://localhost:${PORT}`);
});