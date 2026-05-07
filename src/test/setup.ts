import { beforeAll, afterAll } from 'vitest';
import { prisma } from '../config/prisma.js';

beforeAll(async () => {
  // We could run migrations here if we wanted to ensure a clean DB
  // But for the MVP, we'll just connect
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});
