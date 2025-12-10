import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // Server
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // CORS
  FRONTEND_URL: z.string().url().default('http://localhost:5000'),

  // Cloudflare R2
  R2_ACCOUNT_ID: z.string(),
  R2_ACCESS_KEY_ID: z.string(),
  R2_SECRET_ACCESS_KEY: z.string(),
  R2_BUCKET_NAME: z.string(),
  R2_PUBLIC_URL: z.string().url(),

  // BeSign
  BESIGN_API_URL: z.string().url().optional(),
  BESIGN_API_KEY: z.string().optional(),

  // PlugSign
  PLUGSIGN_API_URL: z.string().url().optional(),
  PLUGSIGN_API_KEY: z.string().optional(),

  // Webhook
  WEBHOOK_SECRET: z.string().optional(),

  // Rate Limiting
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
