import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './server.js';
import { sendProblem } from './problem.js';
import db from './db.js';

export function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendProblem(res, 401, 'Unauthorized', 'Brak lub nieprawidłowy token Bearer');
  }

  const token = authHeader.split(' ')[1];

  // Sprawdzamy czy token został unieważniony przy wylogowaniu
  const isRevoked = db.prepare('SELECT 1 FROM revoked_tokens WHERE token = ?').get(token);
  if (isRevoked) {
    return sendProblem(res, 401, 'Unauthorized', 'Token został unieważniony po wylogowaniu');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    req.rawToken = token;
    next();
  } catch (err) {
    return sendProblem(res, 401, 'Unauthorized', 'Token jest nieważny lub wygasł');
  }
}