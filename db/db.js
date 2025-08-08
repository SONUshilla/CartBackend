import pg from 'pg';
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;

const connectionString = process.env.CONNECTIONSTRING;
console.log(connectionString);

const db = new Pool({
  connectionString,
});

// Optional: Handle errors on idle clients
db.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export default db;
