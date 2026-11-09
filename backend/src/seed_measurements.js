import db from './db.js';
import crypto from 'crypto';

console.log('[SEED] Sprawdzanie danych przykładowych pomiarów...');

// Sprawdzamy czy w bazie są już pomiary
const countRow = db.prepare('SELECT COUNT(*) as count FROM measurements').get();
if (countRow.count >= 45) {
  console.log(`[SEED] Baza posiada już ${countRow.count} pomiarów. Pomijanie.`);
  process.exit(0);
}

// Czujniki powiązane z 3 seriami łowiska
const sensors = [
  { name: 'Sonda Termiczna Zanurzeniowa', series_id: 1, type: 'temp' },
  { name: 'Barometr Stacja Brzegowa', series_id: 2, type: 'pressure' },
  { name: 'Oksymetr Sonda Pływająca', series_id: 3, type: 'oxygen' }
];

const sensorIds = {};

for (const s of sensors) {
  let existing = db.prepare('SELECT id FROM sensors WHERE name = ? AND is_active = 1').get(s.name);
  if (!existing) {
    const rawApiKey = crypto.randomBytes(32).toString('hex');
    const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
    const createdAt = new Date().toISOString();
    const res = db.prepare(`
      INSERT INTO sensors (name, series_id, api_key_hash, is_active, created_at)
      VALUES (?, ?, ?, 1, ?)
    `).run(s.name, s.series_id, apiKeyHash, createdAt);
    sensorIds[s.type] = res.lastInsertRowid;
  } else {
    sensorIds[s.type] = existing.id;
  }
}

// Wstawianie 20 historycznych pomiarów na serię
const insertStmt = db.prepare(`
  INSERT INTO measurements (series_id, sensor_id, value, timestamp)
  VALUES (?, ?, ?, ?)
`);

const now = Date.now();
const POINTS = 20;

const insertTransaction = db.transaction(() => {
  for (let i = 0; i < POINTS; i++) {
    const timeIso = new Date(now - (POINTS - i) * 15 * 60 * 1000).toISOString();

    // 1. Temperatura wody (0 - 35 °C)
    const tempVal = Math.round((18.0 + 4.0 * Math.sin(i / 3.0) + (Math.random() * 0.6 - 0.3)) * 100) / 100;
    insertStmt.run(1, sensorIds['temp'], tempVal, timeIso);

    // 2. Ciśnienie atmosferyczne (950 - 1060 hPa)
    const pressVal = Math.round((1012.0 + 5.0 * Math.sin(i / 5.0) + (Math.random() * 1.0 - 0.5)) * 10) / 10;
    insertStmt.run(2, sensorIds['pressure'], pressVal, timeIso);

    // 3. Rozpuszczony tlen (0 - 15 mg/l)
    const oxyVal = Math.round((8.5 + 1.2 * Math.sin(i / 2.5) + (Math.random() * 0.4 - 0.2)) * 100) / 100;
    insertStmt.run(3, sensorIds['oxygen'], oxyVal, timeIso);
  }
});

insertTransaction();
console.log(`[SEED] Pomyślnie zasilono bazę 60 pomiarami historycznymi (po 20 na serię).`);