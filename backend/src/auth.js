import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './server.js';
import { sendProblem } from './problem.js';

export function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendProblem(res, 401, 'Unauthorized', 'Brak lub nieprawidłowy token Bearer');
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return sendProblem(res, 401, 'Unauthorized', 'Token jest nieważny lub wygasł');
  }
}