import { app } from './app.js';
import { ENV } from './config/env.js';
import { prisma } from './config/prisma.js';
import { startInstagramTokenRefreshJob } from './jobs/instagram-token-refresh.job.js';

const PORT = ENV.PORT;

const server = app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 Fess n Curious Backend API Server`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🔗 API Base: http://localhost:${PORT}${ENV.API_PREFIX}`);
  console.log(`🌍 Environment: ${ENV.NODE_ENV}`);
  console.log(`=================================================`);
});

// Pemeliharaan token Instagram (refresh 60-harian) — boot + tiap 24 jam.
startInstagramTokenRefreshJob();

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    try {
      await prisma.$disconnect();
      console.log('Database connection closed.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
