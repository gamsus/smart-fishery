import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './server.js';
import db from './db.js';
import crypto from 'crypto';

// Rejestrujemy 3 sensory bezpośrednio tworząc dla nich klucze zgodnie z mechanizmem API
const sensorsToCreate = [
  { name: 'Sonda Termiczna Zanurzeniowa', series_id: 1, type: 'temp' },
  { name: 'Barometr Stacja Brzegowa', series_id: 2, type: 'pressure' },
  { name: 'Oksymetr Sonda Pływająca', series_id: 3, type: 'oxygen' }
];

console.log('--- REJESTRACJA CZUJNIKÓW DLA ŁOWISKA ---');

for (const s of sensorsToCreate) {
  const existing = db.prepare('SELECT id FROM sensors WHERE name = ? AND is_active = 1').get(s.name);
  if (existing) {
    console.log(`Czujnik "${s.name}" już istnieje w bazie (ID: ${existing.id}).`);
    continue;
  }

  const rawApiKey = crypto.randomBytes(32).toString('hex');
  const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
  const createdAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO sensors (name, series_id, api_key_hash, is_active, created_at)
    VALUES (?, ?, ?, 1, ?)
  `);
  const res = stmt.run(s.name, s.series_id, apiKeyHash, createdAt);

  console.log(`\nZarejestrowano czujnik: "${s.name}" (ID: ${res.lastInsertRowid})`);
  console.log(`-> Typ pomiaru: ${s.type}`);
  console.log(`-> KLUCZ API: ${rawApiKey}`);
}