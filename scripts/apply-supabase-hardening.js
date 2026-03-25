const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is missing. Set it in .env before running this script.",
  );
  process.exit(1);
}

const sqlPath = path.join(
  __dirname,
  "..",
  "sql",
  "supabase-security-hardening.sql",
);
const sql = fs.readFileSync(sqlPath, "utf8");

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
});

(async () => {
  try {
    await pool.query(sql);
    console.log("Supabase hardening SQL applied successfully.");
  } catch (error) {
    console.error("Failed to apply Supabase hardening SQL:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
