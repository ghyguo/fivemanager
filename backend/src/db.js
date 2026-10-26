import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? 'fourhigh_survey',
  user: process.env.DB_USER ?? 'survey',
  password: process.env.DB_PASSWORD ?? '',
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 100,
  connectTimeout: 10_000,
  timezone: '+08:00',
  charset: 'utf8mb4',
  dateStrings: true,
  decimalNumbers: true,
  enableKeepAlive: true
});
