import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: ['query', 'error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
