import bcrypt from 'bcryptjs';
import db from './db.js';

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASS || 'Admin123!';

const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(ADMIN_USER);

if (!existing) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(ADMIN_USER, hash);
  console.log(`[SEED] Utworzono domyślnego admina: login: ${ADMIN_USER}, hasło: ${ADMIN_PASSWORD}`);
} else {
  console.log(`[SEED] Konto admina "${ADMIN_USER}" już istnieje.`);
}