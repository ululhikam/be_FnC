import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import passport from './config/passport.js';
import { ENV } from './config/env.js';
import apiRoutes from './routes/index.js';
import internalRoutes from './routes/internal.routes.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { rateLimiter } from './middlewares/rateLimit.middleware.js';

export const app = express();

// Security and utility middlewares
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, postman) or matching frontends
      callback(null, true);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

if (ENV.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Passport initialization
app.use(passport.initialize());

// Apply rate limiting per IP
app.use(rateLimiter);

// Mount API routes under /api (matching api-contract server definition)
app.use(ENV.API_PREFIX, apiRoutes);

// Endpoint internal (worker finalize Instagram) — dipanggil oleh backend sendiri
app.use('/internal', internalRoutes);

// Also mount routes at root for convenience and contract compatibility
if (ENV.API_PREFIX !== '/') {
  app.use('/', apiRoutes);
}

// 404 and Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
