import pg from 'pg';
import dotenv from "dotenv";
dotenv.config();
const { Client } = pg;

// ✅ Replace this with your actual Supabase database password
const connectionString =process.env.CONNECTIONSTRING;
console.log(connectionString);
const db = new Client({
  connectionString,
});

db.connect()
  .then(() => console.log("✅ Connected to Supabase PostgreSQL"))
  .catch(err => console.error("❌ Connection error:", err.stack));

export default db;