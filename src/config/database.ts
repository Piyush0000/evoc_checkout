export const safePrisma = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    console.error('[DATABASE_CRITICAL] Error executing Prisma operation:', error);
    throw error;
  }
};
