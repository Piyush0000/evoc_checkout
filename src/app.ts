import chalk from 'chalk';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import authRoutes from './routes/auth.routes.js';
import checkoutRoutes from './routes/checkout.routes.js';
import userRoutes from './routes/user.routes.js';

dotenv.config();

const app: Express = express();

app.use(helmet());
app.use(cors());
// Custom morgan token to log request body (sanitized)
morgan.token('body', (req: Request) => {
  if (Object.keys(req.body).length > 0) {
    const body = { ...req.body };
    if (body.code) body.code = '******';
    return chalk.gray(JSON.stringify(body));
  }
  return '';
});

// Custom token for colorized status
morgan.token('status-color', (_req: Request, res: Response) => {
  const status = res.statusCode;
  if (status >= 500) return chalk.red(status);
  if (status >= 400) return chalk.yellow(status);
  if (status >= 300) return chalk.cyan(status);
  if (status >= 200) return chalk.green(status);
  return status.toString();
});

// Custom token for bold method
morgan.token('method-bold', (req: Request) => {
  return chalk.bold(req.method);
});

app.use(morgan(':method-bold :url :status-color :res[content-length] - :response-time ms :body'));
app.use(express.json());

app.use('/api/v1/checkout', checkoutRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/user', userRoutes);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
