import express from 'express';
import { initSchema } from './db.js';
import { authMiddleware } from './auth.js';
import { ordersRouter } from './routes/orders.js';
import { revenueRouter } from './routes/revenue.js';
import { metricsRouter } from './routes/metrics.js';
import { seedIfEmpty } from './scripts/seed.js';
import { errorHandler } from './error-handler.js';

initSchema();
seedIfEmpty();

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(express.json());
app.use(express.static('public'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/orders', authMiddleware, ordersRouter);
app.use('/api/revenue', authMiddleware, revenueRouter);
app.use('/api/metrics', authMiddleware, metricsRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`dashboard server listening on http://localhost:${PORT}`);
});
