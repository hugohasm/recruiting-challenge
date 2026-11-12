import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
};
