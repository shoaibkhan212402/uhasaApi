import 'dotenv/config';

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'https://uasatraining.ahwuae.com',
  'https://uhasha.vercel.app',
  'https://uhasa.vercel.app',

];

function parseCorsOrigins(value: string | undefined): string[] {
  const fromEnv = (value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_CORS_ORIGINS, ...fromEnv])];
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGIN),
  corsAllowAll: process.env.CORS_ALLOW_ALL !== 'false',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'uasa_training',
  },
  ftp: {
    host: process.env.FTP_HOST || '',
    port: parseInt(process.env.FTP_PORT || '21', 10),
    user: process.env.FTP_USER || '',
    password: process.env.FTP_PASSWORD || '',
    secure: process.env.FTP_SECURE === 'true',
    basePath: process.env.FTP_BASE_PATH || '/uploads',
    publicUrl: process.env.FTP_PUBLIC_URL || '',
  },
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@uasatraining.com',
    password: process.env.ADMIN_PASSWORD || 'Admin@123',
  },
  certificateAssetsBaseUrl:
    process.env.CERTIFICATE_ASSETS_BASE_URL ||
    process.env.API_PUBLIC_URL ||
    'http://localhost:3001/api/certificate-assets',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    fromName: process.env.SMTP_FROM_NAME || 'UASA Training',
    fromEmail: process.env.SMTP_FROM_EMAIL || 'info@uasatraining.com',
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  apiPublicUrl:
    process.env.API_PUBLIC_URL ||
    `http://localhost:${process.env.PORT || '3001'}`,
  telr: {
    storeId: process.env.TELR_STORE_ID || '',
    authKey: process.env.TELR_AUTH_KEY || '',
    webhookSecret: process.env.TELR_WEBHOOK_SECRET || process.env.TELR_AUTH_KEY || '',
    testMode:
      process.env.TELR_TEST_MODE === '1' ||
      (process.env.TELR_TEST_MODE !== '0' && process.env.NODE_ENV !== 'production'),
  },
};
