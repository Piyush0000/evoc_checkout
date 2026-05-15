import chalk from 'chalk';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.routes.js';
import checkoutRoutes from './routes/checkout.routes.js';
import userRoutes from './routes/user.routes.js';

dotenv.config({ override: true });

// Fix N: Startup credential validation — fail fast with clear errors
const requiredEnvVars = ['DATABASE_URL'];
const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  console.error(`[STARTUP] ❌ Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

// PayU credentials: at least one set (test or prod) must be present
const hasPayUKey = process.env.PAYU_KEY || process.env.TEST_PAYU_KEY;
const hasPayUSalt = process.env.PAYU_SALT || process.env.TEST_PAYU_SALT;
if (!hasPayUKey || !hasPayUSalt) {
  console.warn(
    '[STARTUP] ⚠️  PayU credentials not configured. Set PAYU_KEY/PAYU_SALT or TEST_PAYU_KEY/TEST_PAYU_SALT. ' +
      'Payment hash generation will produce invalid results.'
  );
}

const app: Express = express();

// Security Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // Limit each IP to 100 requests per `window`
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

// Apply rate limiter to all API routes
app.use('/api', limiter);

// Stricter Rate Limiting for OTP
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5, // Limit each IP to 5 OTP requests per `window`
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many OTP requests, please try again later.' },
});

app.use('/api/v1/auth/otp/send', otpLimiter);

// Custom morgan token to log request body (sanitized)
morgan.token('body', (req: Request) => {
  // In production, we avoid logging the body entirely for security and performance
  if (process.env.NODE_ENV === 'production') {
    return '';
  }

  if (req.body && Object.keys(req.body).length > 0) {
    const body = { ...req.body };
    // Redact sensitive PII fields
    const sensitiveFields = [
      'code',
      'phone',
      'email',
      'address',
      'firstName',
      'lastName',
      'pincode',
    ];
    sensitiveFields.forEach((field) => {
      if (body[field]) body[field] = '******';
    });
    return chalk.gray(JSON.stringify(body));
  }
  return '';
});

// Custom token for colorized status
morgan.token('status-color', (_req: Request, res: Response) => {
  const status = res.statusCode;
  if (status >= 500) return chalk.red(String(status));
  if (status >= 400) return chalk.yellow(String(status));
  if (status >= 300) return chalk.cyan(String(status));
  if (status >= 200) return chalk.green(String(status));
  return String(status);
});

// Custom token for bold method
morgan.token('method-bold', (req: Request) => {
  return chalk.bold(req.method);
});

app.use(morgan(':method-bold :url :status-color :res[content-length] - :response-time ms :body'));

app.use('/api/v1/checkout', checkoutRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/user', userRoutes);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
