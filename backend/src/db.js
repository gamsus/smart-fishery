import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, '../data/fishery.db'));
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    min_value REAL NOT NULL,
    max_value REAL NOT NULL,
    color TEXT NOT NULL,
    icon TEXT,
    unit TEXT,
    CHECK (min_value < max_value)
  );

  CREATE TABLE IF NOT EXISTS sensors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    series_id INTEGER NOT NULL,
    api_key_hash TEXT UNIQUE NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id INTEGER NOT NULL,
    sensor_id INTEGER,
    value REAL NOT NULL,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE CASCADE,
    FOREIGN KEY (sensor_id) REFERENCES sensors (id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_measurements_series_time 
  ON measurements (series_id, timestamp);
`);

export default db;