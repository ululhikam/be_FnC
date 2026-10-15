import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.js';

export interface JwtPayload {
  sub: string;
  role: string;
  handle?: string;
  email?: string;
  [key: string]: any;
}

export function generateToken(payload: JwtPayload, expiresIn = ENV.JWT_EXPIRES_IN): string {
  return jwt.sign(payload, ENV.JWT_SECRET, {
    expiresIn: expiresIn as any,
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, ENV.JWT_SECRET) as JwtPayload;
}
