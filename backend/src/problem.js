export function sendProblem(res, status, title, detail = null, errors = null) {
  res.setHeader('Content-Type', 'application/problem+json');
  return res.status(status).json({
    type: 'about:blank',
    title,
    status,
    ...(detail && { detail }),
    ...(errors && { errors })
  });
}