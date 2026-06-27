import mysql from 'mysql2/promise';
import { config } from '../config.js';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  decimalNumbers: true,
  dateStrings: true,
});

export async function query<T = unknown>(sql: string, params?: Record<string, unknown> | unknown[]): Promise<T[]> {
  const [rows] = await pool.execute(sql, params as never);
  return rows as T[];
}

export async function queryOne<T = unknown>(sql: string, params?: Record<string, unknown> | unknown[]): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function insert(sql: string, params?: Record<string, unknown> | unknown[]): Promise<number> {
  const [result] = await pool.execute(sql, params as never);
  return (result as { insertId: number }).insertId;
}
