import dotenv from "dotenv";
dotenv.config(); // Load env variables at the very top

import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import path from "path";
import pg from "pg";

import productRoutes from "./routes/productRoutes.js";
import { aj } from "./lib/arcjet.js";

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.resolve();

// Initialize Postgres Pool with SSL for RDS
const { Pool } = pg;
export const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD?.toString(), // ensure string
  port: parseInt(process.env.PGPORT, 10),
  ssl: {
    rejectUnauthorized: false, // allow RDS SSL connection
  },
});

// Test DB connection
async function testDBConnection() {
  try {
    await pool.query("SELECT NOW()");
    console.log("Postgres connected successfully");
  } catch (err) {
    console.error("Postgres connection error:", err);
    process.exit(1); // stop server if DB is unreachable
  }
}
testDBConnection();

// Middleware
app.use(express.json());
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan("dev"));

// Arcjet rate-limiting
app.use(async (req, res, next) => {
  try {
    const decision = await aj.protect(req, { requested: 1 });
    if (decision.isDenied()) {
      if (decision.reason.isRateLimit()) return res.status(429).json({ error: "Too Many Requests" });
      if (decision.reason.isBot()) return res.status(403).json({ error: "Bot access denied" });
      return res.status(403).json({ error: "Forbidden" });
    }
    if (decision.results.some((result) => result.reason.isBot() && result.reason.isSpoofed()))
      return res.status(403).json({ error: "Spoofed bot detected" });
    next();
  } catch (error) {
    console.log("Arcjet error", error);
    next(error);
  }
});

// Routes
app.use("/products", productRoutes);

// Serve React frontend in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "/frontend/dist")));
  app.get("*", (req, res) => {
    res.sendFile(path.resolve(__dirname, "frontend", "dist", "index.html"));
  });
}

// Initialize DB table
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        image VARCHAR(255) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Database initialized successfully");
  } catch (error) {
    console.log("Error initDB", error);
  }
}

initDB().then(() => {
  app.listen(PORT, () => {
    console.log("Server is running on port " + PORT);
  });
});
