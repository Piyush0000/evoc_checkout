import { beforeAll, afterAll } from 'vitest';
import { prisma, pool } from '../config/prisma.js';

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end(); // Shut down the pool to let Vitest exit
});
