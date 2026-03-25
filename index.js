require("dotenv").config();
process.env.TZ = process.env.TZ || "Europe/Budapest";
const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");
const webpush = require("web-push");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || `mailto:${ADMIN_EMAIL}`;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const IS_POSTGRES = Boolean(process.env.DATABASE_URL);
let vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
};

if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
  vapidKeys = webpush.generateVAPIDKeys();
  console.warn(
    "VAPID keys missing. Generated temporary keys. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env for persistence.",
  );
}

webpush.setVapidDetails(
  VAPID_SUBJECT,
  vapidKeys.publicKey,
  vapidKeys.privateKey,
);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store");
    },
  }),
);

const normalizeSql = (sql) => {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
};

let db = null;
let pgPool = null;

if (IS_POSTGRES) {
  const sslEnabled =
    String(process.env.DB_SSL || "true").toLowerCase() === "true";
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
  });

  const runPg = (sql, params, cb) => {
    let callback = cb;
    let values = [];
    if (typeof params === "function") {
      callback = params;
    } else if (Array.isArray(params)) {
      values = params;
    }
    let normalized = normalizeSql(sql);
    if (
      /^\s*insert\s+/i.test(normalized) &&
      !/\sreturning\s/i.test(normalized)
    ) {
      normalized = `${normalized} RETURNING id`;
    }
    pgPool
      .query(normalized, values)
      .then((result) => {
        const ctx = {
          lastID: result.rows[0] ? result.rows[0].id : null,
          changes: result.rowCount,
        };
        if (callback) {
          callback.call(ctx, null);
        }
      })
      .catch((err) => {
        if (callback) {
          callback(err);
        }
      });
  };

  const selectPg = (sql, params, cb, many) => {
    let callback = cb;
    let values = [];
    if (typeof params === "function") {
      callback = params;
    } else if (Array.isArray(params)) {
      values = params;
    }
    pgPool
      .query(normalizeSql(sql), values)
      .then((result) => {
        if (callback) {
          callback(null, many ? result.rows : result.rows[0]);
        }
      })
      .catch((err) => {
        if (callback) {
          callback(err);
        }
      });
  };

  db = {
    run: runPg,
    get: (sql, params, cb) => selectPg(sql, params, cb, false),
    all: (sql, params, cb) => selectPg(sql, params, cb, true),
    serialize: (fn) => fn(),
    prepare: (sql) => ({
      run: (...params) => runPg(sql, params),
      finalize: () => {},
    }),
  };
} else {
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data.db");
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  db = new sqlite3.Database(DB_PATH);
}

const sessionOptions = {
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    sameSite: "lax",
  },
};

if (IS_POSTGRES && pgPool) {
  sessionOptions.store = new PgSession({
    pool: pgPool,
    tableName: "user_sessions",
    createTableIfMissing: true,
  });
}

app.use(session(sessionOptions));

const initDb = async () => {
  if (IS_POSTGRES && pgPool) {
    await pgPool.query(
      `CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        coach TEXT,
        starts_at TEXT NOT NULL,
        capacity INTEGER NOT NULL,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1
      )`,
    );
    await pgPool.query(
      "ALTER TABLE classes ADD COLUMN IF NOT EXISTS is_active INTEGER DEFAULT 1",
    );
    await pgPool.query(
      `CREATE TABLE IF NOT EXISTS signups (
        id SERIAL PRIMARY KEY,
        class_id INTEGER NOT NULL REFERENCES classes(id),
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      )`,
    );
    await pgPool.query(
      `CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    );
    await pgPool.query(
      `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        birth_date TEXT NOT NULL,
        phone TEXT NOT NULL,
        password_hash TEXT,
        password_salt TEXT,
        consent_text TEXT NOT NULL,
        consent_accepted_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    );
    await pgPool.query(
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        endpoint TEXT NOT NULL UNIQUE,
        subscription TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    );
    await pgPool.query(
      `CREATE TABLE IF NOT EXISTS passes (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL,
        total INTEGER NOT NULL,
        remaining INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )`,
    );
    await pgPool.query(
      `CREATE TABLE IF NOT EXISTS pass_uses (
        id SERIAL PRIMARY KEY,
        pass_id INTEGER NOT NULL REFERENCES passes(id),
        class_id INTEGER NOT NULL REFERENCES classes(id),
        used_at TEXT NOT NULL
      )`,
    );
    return;
  }

  return new Promise((resolve) => {
    db.serialize(() => {
      db.run(
        `CREATE TABLE IF NOT EXISTS classes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          coach TEXT,
          starts_at TEXT NOT NULL,
          capacity INTEGER NOT NULL,
          notes TEXT,
          is_active INTEGER NOT NULL DEFAULT 1
        )`,
      );
      db.run(
        `CREATE TABLE IF NOT EXISTS signups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          class_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          created_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          FOREIGN KEY(class_id) REFERENCES classes(id)
        )`,
      );
      db.run(
        `CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
      );
      db.run(
        `CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          birth_date TEXT NOT NULL,
          phone TEXT NOT NULL,
          password_hash TEXT,
          password_salt TEXT,
          consent_text TEXT NOT NULL,
          consent_accepted_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
      );
      db.run(
        `CREATE TABLE IF NOT EXISTS push_subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          endpoint TEXT NOT NULL UNIQUE,
          subscription TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
      );
      db.run(
        `CREATE TABLE IF NOT EXISTS passes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          total INTEGER NOT NULL,
          remaining INTEGER NOT NULL,
          created_at TEXT NOT NULL
        )`,
      );
      db.run(
        `CREATE TABLE IF NOT EXISTS pass_uses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pass_id INTEGER NOT NULL,
          class_id INTEGER NOT NULL,
          used_at TEXT NOT NULL,
          FOREIGN KEY(pass_id) REFERENCES passes(id),
          FOREIGN KEY(class_id) REFERENCES classes(id)
        )`,
      );
      db.run("ALTER TABLE users ADD COLUMN phone TEXT", () => {});
      db.run("ALTER TABLE users ADD COLUMN password_hash TEXT", () => {});
      db.run("ALTER TABLE users ADD COLUMN password_salt TEXT", () => {});
      db.run(
        "ALTER TABLE classes ADD COLUMN is_active INTEGER DEFAULT 1",
        () => {},
      );
      db.run("SELECT 1", () => resolve());
    });
  });
};

const hashPassword = (password, salt = null) => {
  const usedSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, usedSalt, 100000, 64, "sha512")
    .toString("hex");
  return { hash, salt: usedSalt };
};

const verifyPassword = (password, salt, hash) => {
  if (!salt || !hash) {
    return false;
  }
  const candidate = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");
  return candidate === hash;
};

const requireAdmin = (req, res, next) => {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
};

const requireUser = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  return res.status(401).json({ error: "Login required" });
};

const mapClassRow = (row) => ({
  id: row.id,
  title: row.title,
  coach: row.coach,
  startsAt: row.starts_at,
  capacity: row.capacity,
  notes: row.notes,
  isActive: row.is_active === 1 || row.is_active === true,
});

const createNotification = (type, message) => {
  const createdAt = new Date().toISOString();
  db.run(
    "INSERT INTO notifications (type, message, created_at) VALUES (?, ?, ?)",
    [type, message, createdAt],
  );
};

const storePushSubscription = (subscription, callback) => {
  const createdAt = new Date().toISOString();
  const endpoint = subscription.endpoint;
  const sql = IS_POSTGRES
    ? "INSERT INTO push_subscriptions (endpoint, subscription, created_at) VALUES (?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET subscription = EXCLUDED.subscription, created_at = EXCLUDED.created_at"
    : "INSERT OR REPLACE INTO push_subscriptions (endpoint, subscription, created_at) VALUES (?, ?, ?)";
  db.run(sql, [endpoint, JSON.stringify(subscription), createdAt], callback);
};

const sendPushToAll = (title, body) => {
  db.all("SELECT id, subscription FROM push_subscriptions", [], (err, rows) => {
    if (err) {
      return;
    }
    rows.forEach((row) => {
      let subscription;
      try {
        subscription = JSON.parse(row.subscription);
      } catch (parseErr) {
        db.run("DELETE FROM push_subscriptions WHERE id = ?", [row.id]);
        return;
      }
      webpush
        .sendNotification(subscription, JSON.stringify({ title, body }))
        .catch((sendErr) => {
          const status = sendErr.statusCode || 0;
          if (status === 404 || status === 410) {
            db.run("DELETE FROM push_subscriptions WHERE id = ?", [row.id]);
          }
        });
    });
  });
};

const sendTelegramMessage = async (message) => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return;
  }
  try {
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
        }),
      },
    );
  } catch (err) {
    console.warn("Telegram send failed", err.message || err);
  }
};

const WEEK_DAYS = [
  { key: 1, label: "Monday" },
  { key: 2, label: "Tuesday" },
  { key: 3, label: "Wednesday" },
  { key: 4, label: "Thursday" },
  { key: 5, label: "Friday" },
];

const TIME_SLOTS = [
  "06:00",
  "07:00",
  "08:00",
  "09:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
];

const MAX_SIGNUPS = 6;

const CLASS_DURATION_MINUTES = 60;
const PASS_USE_BACKDATE_DAYS = 7;
const PASS_USE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const FRIDAY_AFTERNOON = new Set(["16:00", "17:00", "18:00"]);

const getDisplayWeekStart = () => {
  const now = new Date();
  const day = now.getDay();
  const weekStart = new Date(now);
  const diffToMonday = day === 0 ? -6 : 1 - day;
  weekStart.setDate(now.getDate() + diffToMonday);
  weekStart.setHours(0, 0, 0, 0);

  const isFridayAfterTen = day === 5 && now.getHours() >= 10;
  const isWeekend = day === 6 || day === 0;
  if (isFridayAfterTen || isWeekend) {
    weekStart.setDate(weekStart.getDate() + 7);
  }
  return weekStart;
};

const seedWeeklyClasses = () => {
  const weekStart = getDisplayWeekStart();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  db.get(
    "SELECT COUNT(*) AS count FROM classes WHERE starts_at >= ? AND starts_at < ?",
    [weekStart.toISOString(), weekEnd.toISOString()],
    (err, row) => {
      if (err) {
        return;
      }
      if (row.count > 0) {
        return;
      }

      const stmt = db.prepare(
        "INSERT INTO classes (title, coach, starts_at, capacity, notes) VALUES (?, ?, ?, ?, ?)",
      );

      WEEK_DAYS.forEach((day) => {
        TIME_SLOTS.forEach((time) => {
          if (day.key === 5 && FRIDAY_AFTERNOON.has(time)) {
            return;
          }
          const [hour, minute] = time.split(":").map(Number);
          const startsAt = new Date(weekStart);
          startsAt.setDate(weekStart.getDate() + (day.key - 1));
          startsAt.setHours(hour, minute, 0, 0);
          stmt.run("Edzes", "Zoltan", startsAt.toISOString(), MAX_SIGNUPS, "");
        });
      });

      stmt.finalize();
    },
  );
};

const processDuePassUses = () => {
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - CLASS_DURATION_MINUTES * 60 * 1000,
  ).toISOString();

  db.all(
    `SELECT s.id AS signup_id, s.email, s.class_id, c.starts_at
     FROM signups s
     JOIN classes c ON s.class_id = c.id
     WHERE s.status = 'confirmed' AND c.starts_at <= ?`,
    [cutoff],
    (err, rows) => {
      if (err || !rows || rows.length === 0) {
        return;
      }

      const processNext = (index) => {
        if (index >= rows.length) {
          return;
        }
        const row = rows[index];
        const email = row.email;
        const classId = row.class_id;

        db.get(
          "SELECT id, remaining FROM passes WHERE user_email = ? ORDER BY created_at DESC LIMIT 1",
          [email],
          (passErr, passRow) => {
            if (passErr || !passRow || passRow.remaining <= 0) {
              return processNext(index + 1);
            }
            db.get(
              `SELECT pu.id
               FROM pass_uses pu
               JOIN passes p ON pu.pass_id = p.id
               WHERE p.user_email = ? AND pu.class_id = ?
               LIMIT 1`,
              [email, classId],
              (useErr, useRow) => {
                if (useErr || useRow) {
                  return processNext(index + 1);
                }
                const usedAt = new Date().toISOString();
                db.run(
                  "UPDATE passes SET remaining = remaining - 1 WHERE id = ? AND remaining > 0",
                  [passRow.id],
                  function onUpdate(updateErr) {
                    if (updateErr || this.changes === 0) {
                      return processNext(index + 1);
                    }
                    db.run(
                      "INSERT INTO pass_uses (pass_id, class_id, used_at) VALUES (?, ?, ?)",
                      [passRow.id, classId, usedAt],
                      () => processNext(index + 1),
                    );
                  },
                );
              },
            );
          },
        );
      };

      processNext(0);
    },
  );
};

app.get("/api/classes", (req, res) => {
  db.all(
    `SELECT c.*, (
      SELECT COUNT(*) FROM signups s WHERE s.class_id = c.id AND s.status = 'confirmed'
    ) AS confirmed_count
    FROM classes c
    ORDER BY c.starts_at ASC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      if (!rows || rows.length === 0) {
        return res.json([]);
      }
      const classIds = rows.map((row) => row.id);
      const placeholders = classIds.map(() => "?").join(",");
      db.all(
        `SELECT class_id, name
         FROM signups
         WHERE status = 'confirmed' AND class_id IN (${placeholders})
         ORDER BY created_at ASC`,
        classIds,
        (signErr, signRows) => {
          if (signErr) {
            return res.status(500).json({ error: "Database error" });
          }
          const namesByClass = new Map();
          signRows.forEach((row) => {
            if (!namesByClass.has(row.class_id)) {
              namesByClass.set(row.class_id, []);
            }
            namesByClass.get(row.class_id).push(row.name);
          });
          const payload = rows.map((row) => {
            const names = namesByClass.get(row.id) || [];
            return {
              ...mapClassRow(row),
              confirmedCount: row.confirmed_count,
              confirmedNames: names,
              spotsLeft: Math.max(0, row.capacity - row.confirmed_count),
            };
          });
          return res.json(payload);
        },
      );
    },
  );
});

app.post("/api/auth/register", (req, res) => {
  const {
    fullName,
    email,
    birthDate,
    phone,
    password,
    consentText,
    consentAccepted,
  } = req.body;
  if (!fullName || !email || !birthDate || !phone || !password) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (!consentAccepted || !consentText) {
    return res.status(400).json({ error: "Consent required" });
  }

  const createdAt = new Date().toISOString();
  const { hash, salt } = hashPassword(password);
  db.run(
    "INSERT INTO users (full_name, email, birth_date, phone, password_hash, password_salt, consent_text, consent_accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      fullName,
      email,
      birthDate,
      phone,
      hash,
      salt,
      consentText,
      createdAt,
      createdAt,
    ],
    function onInsert(err) {
      if (err) {
        if (String(err.message || "").includes("UNIQUE")) {
          return res.status(409).json({ error: "Email already registered" });
        }
        return res.status(500).json({ error: "Database error" });
      }
      req.session.user = { fullName, email, birthDate, phone };
      return res.json({ ok: true, user: req.session.user });
    },
  );
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  db.get(
    "SELECT full_name, email, birth_date, phone, password_hash, password_salt FROM users WHERE email = ?",
    [email],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      if (!row) {
        return res.status(404).json({ error: "User not found" });
      }
      if (!row.password_hash || !row.password_salt) {
        const { hash, salt } = hashPassword(password);
        db.run(
          "UPDATE users SET password_hash = ?, password_salt = ? WHERE email = ?",
          [hash, salt, email],
          (updateErr) => {
            if (updateErr) {
              return res.status(500).json({ error: "Database error" });
            }
            req.session.user = {
              fullName: row.full_name,
              email: row.email,
              birthDate: row.birth_date,
              phone: row.phone,
            };
            return res.json({ ok: true, user: req.session.user });
          },
        );
        return;
      }
      if (!verifyPassword(password, row.password_salt, row.password_hash)) {
        return res.status(401).json({ error: "Invalid password" });
      }
      req.session.user = {
        fullName: row.full_name,
        email: row.email,
        birthDate: row.birth_date,
        phone: row.phone,
      };
      return res.json({ ok: true, user: req.session.user });
    },
  );
});

app.post("/api/auth/logout", (req, res) => {
  req.session.user = null;
  return res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ user: req.session.user });
  }
  return res.status(401).json({ error: "Not logged in" });
});

app.get("/api/push/vapid-public-key", requireAdmin, (req, res) => {
  return res.json({ publicKey: vapidKeys.publicKey });
});

app.post("/api/push/subscribe", requireAdmin, (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "Invalid subscription" });
  }
  storePushSubscription(subscription, (err) => {
    if (err) {
      return res.status(500).json({ error: "Database error" });
    }
    return res.json({ ok: true });
  });
});

app.post("/api/admin/telegram/test", requireAdmin, async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(400).json({ error: "Telegram not configured" });
  }
  await sendTelegramMessage("Telegram teszt üzenet: működik az értesítés.");
  return res.json({ ok: true });
});

app.get("/api/passes/me", requireUser, (req, res) => {
  const { email } = req.session.user;
  db.get(
    "SELECT * FROM passes WHERE user_email = ? ORDER BY created_at DESC LIMIT 1",
    [email],
    (err, passRow) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      if (!passRow) {
        return res.json({ pass: null, uses: [] });
      }
      db.all(
        `SELECT pu.id, pu.used_at, c.title, c.starts_at
         FROM pass_uses pu
         JOIN classes c ON pu.class_id = c.id
         WHERE pu.pass_id = ?
         ORDER BY pu.used_at DESC`,
        [passRow.id],
        (useErr, useRows) => {
          if (useErr) {
            return res.status(500).json({ error: "Database error" });
          }
          return res.json({
            pass: {
              id: passRow.id,
              total: passRow.total,
              remaining: passRow.remaining,
              createdAt: passRow.created_at,
            },
            uses: useRows.map((row) => ({
              id: row.id,
              usedAt: row.used_at,
              title: row.title,
              startsAt: row.starts_at,
            })),
          });
        },
      );
    },
  );
});

app.post("/api/classes/:id/signup", requireUser, (req, res) => {
  const classId = Number(req.params.id);
  const { fullName, email } = req.session.user;

  db.get("SELECT * FROM classes WHERE id = ?", [classId], (err, classRow) => {
    if (err) {
      return res.status(500).json({ error: "Database error" });
    }
    if (!classRow) {
      return res.status(404).json({ error: "Class not found" });
    }
    if (classRow.is_active === 0 || classRow.is_active === false) {
      return res
        .status(400)
        .json({ error: "Ez az óra jelenleg nem elérhető." });
    }

    const now = new Date();
    const classStart = new Date(classRow.starts_at);
    if (now >= classStart) {
      return res
        .status(400)
        .json({ error: "A feliratkozás az óra kezdete után nem lehetséges." });
    }

    db.get(
      "SELECT id, status FROM signups WHERE class_id = ? AND email = ? AND status IN ('confirmed', 'pending')",
      [classId, email],
      (dupeErr, dupeRow) => {
        if (dupeErr) {
          return res.status(500).json({ error: "Database error" });
        }
        if (dupeRow) {
          return res
            .status(400)
            .json({ error: "Erre az órára már fel vagy iratkozva." });
        }
        db.get(
          "SELECT COUNT(*) AS confirmed_count FROM signups WHERE class_id = ? AND status = 'confirmed'",
          [classId],
          (countErr, countRow) => {
            if (countErr) {
              return res.status(500).json({ error: "Database error" });
            }
            if (countRow.confirmed_count >= MAX_SIGNUPS) {
              return res.status(400).json({ error: "Class is full" });
            }
            const createdAt = new Date().toISOString();
            db.run(
              "INSERT INTO signups (class_id, name, email, created_at, status) VALUES (?, ?, ?, ?, 'confirmed')",
              [classId, fullName, email, createdAt],
              function onInsert(insertErr) {
                if (insertErr) {
                  return res.status(500).json({ error: "Database error" });
                }
                createNotification(
                  "signup",
                  `Uj feliratkozas: ${fullName} (${email}) - ${classRow.title} (${classRow.starts_at})`,
                );
                sendPushToAll(
                  "Uj feliratkozas",
                  `${fullName} (${email}) - ${classRow.title}`,
                );
                sendTelegramMessage(
                  `Új feliratkozás: ${fullName} (${email}) - ${classRow.title} (${classRow.starts_at})`,
                );
                return res.json({
                  id: this.lastID,
                  classId,
                  name: fullName,
                  email,
                  createdAt,
                  status: "confirmed",
                });
              },
            );
          },
        );
      },
    );
  });
});

app.post("/api/signups/:id/cancel", requireUser, (req, res) => {
  const signupId = Number(req.params.id);
  const { email } = req.session.user;

  db.get(
    `SELECT s.*, c.title AS class_title, c.starts_at AS class_starts
     FROM signups s
     JOIN classes c ON s.class_id = c.id
     WHERE s.id = ? AND s.email = ?`,
    [signupId, email],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      if (!row) {
        return res.status(404).json({ error: "Signup not found" });
      }
      const now = new Date().toISOString();
      if (row.status !== "confirmed" || row.class_starts <= now) {
        return res
          .status(400)
          .json({ error: "A lemondás már nem lehetséges." });
      }

      db.run(
        "UPDATE signups SET status = 'cancelled' WHERE id = ?",
        [signupId],
        (updateErr) => {
          if (updateErr) {
            return res.status(500).json({ error: "Database error" });
          }
          db.get(
            `SELECT pu.id, pu.pass_id
             FROM pass_uses pu
             JOIN passes p ON pu.pass_id = p.id
             WHERE p.user_email = ? AND pu.class_id = ?
             ORDER BY pu.used_at DESC
             LIMIT 1`,
            [email, row.class_id],
            (passErr, passUseRow) => {
              if (passErr) {
                return res.status(500).json({ error: "Database error" });
              }
              if (passUseRow) {
                db.run(
                  "UPDATE passes SET remaining = remaining + 1 WHERE id = ?",
                  [passUseRow.pass_id],
                  (refundErr) => {
                    if (refundErr) {
                      return res.status(500).json({ error: "Database error" });
                    }
                    db.run(
                      "DELETE FROM pass_uses WHERE id = ?",
                      [passUseRow.id],
                      (deleteErr) => {
                        if (deleteErr) {
                          return res
                            .status(500)
                            .json({ error: "Database error" });
                        }
                        createNotification(
                          "cancel",
                          `Lemondas: ${row.name} (${row.email}) - ${row.class_title} (${row.class_starts})`,
                        );
                        sendTelegramMessage(
                          `Lemondás: ${row.name} (${row.email}) - ${row.class_title} (${row.class_starts})`,
                        );
                        return res.json({ status: "cancelled" });
                      },
                    );
                  },
                );
                return;
              }
              createNotification(
                "cancel",
                `Lemondas: ${row.name} (${row.email}) - ${row.class_title} (${row.class_starts})`,
              );
              sendTelegramMessage(
                `Lemondás: ${row.name} (${row.email}) - ${row.class_title} (${row.class_starts})`,
              );
              return res.json({ status: "cancelled" });
            },
          );
        },
      );
    },
  );
});

app.get("/api/signups/me", requireUser, (req, res) => {
  const { email } = req.session.user;
  const now = new Date().toISOString();
  db.all(
    `SELECT s.id, s.class_id, s.status, c.title, c.starts_at
     FROM signups s
     JOIN classes c ON s.class_id = c.id
     WHERE s.email = ?
    ORDER BY c.starts_at DESC`,
    [email],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      return res.json(
        rows.map((row) => ({
          id: row.id,
          classId: row.class_id,
          title: row.title,
          startsAt: row.starts_at,
          status: row.status,
          canCancel: row.status === "confirmed" && row.starts_at > now,
        })),
      );
    },
  );
});

app.post("/api/admin/login", (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Invalid credentials" });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.post("/api/admin/classes/regenerate", requireAdmin, (req, res) => {
  db.run("DELETE FROM signups", (signupsErr) => {
    if (signupsErr) {
      return res.status(500).json({ error: "Database error" });
    }
    db.run("DELETE FROM pass_uses", (usesErr) => {
      if (usesErr) {
        return res.status(500).json({ error: "Database error" });
      }
      db.run("DELETE FROM classes", (classesErr) => {
        if (classesErr) {
          return res.status(500).json({ error: "Database error" });
        }
        seedWeeklyClasses();
        return res.json({ ok: true });
      });
    });
  });
});

app.post("/api/admin/passes/assign", requireAdmin, (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }
  db.get("SELECT email FROM users WHERE email = ?", [email], (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Database error" });
    }
    if (!row) {
      return res.status(404).json({ error: "User not found" });
    }
    const createdAt = new Date().toISOString();
    db.run(
      "INSERT INTO passes (user_email, total, remaining, created_at) VALUES (?, ?, ?, ?)",
      [email, 10, 10, createdAt],
      function onInsert(insertErr) {
        if (insertErr) {
          return res.status(500).json({ error: "Database error" });
        }
        return res.json({ id: this.lastID, total: 10, remaining: 10 });
      },
    );
  });
});

app.get("/api/admin/passes/:email", requireAdmin, (req, res) => {
  const email = req.params.email;
  db.get(
    "SELECT * FROM passes WHERE user_email = ? ORDER BY created_at DESC LIMIT 1",
    [email],
    (err, passRow) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      if (!passRow) {
        return res.json({ pass: null, uses: [] });
      }
      db.all(
        `SELECT pu.id, pu.used_at, c.title, c.starts_at
         FROM pass_uses pu
         JOIN classes c ON pu.class_id = c.id
         WHERE pu.pass_id = ?
         ORDER BY pu.used_at DESC`,
        [passRow.id],
        (useErr, useRows) => {
          if (useErr) {
            return res.status(500).json({ error: "Database error" });
          }
          return res.json({
            pass: {
              id: passRow.id,
              total: passRow.total,
              remaining: passRow.remaining,
              createdAt: passRow.created_at,
            },
            uses: useRows.map((row) => ({
              id: row.id,
              usedAt: row.used_at,
              title: row.title,
              startsAt: row.starts_at,
            })),
          });
        },
      );
    },
  );
});

app.post("/api/admin/passes/set", requireAdmin, (req, res) => {
  const { email, total, remaining } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }
  const totalValue = Number(total);
  const remainingValue = Number(remaining);
  if (!Number.isFinite(totalValue) || totalValue < 0) {
    return res.status(400).json({ error: "Invalid total" });
  }
  if (!Number.isFinite(remainingValue) || remainingValue < 0) {
    return res.status(400).json({ error: "Invalid remaining" });
  }
  db.get("SELECT email FROM users WHERE email = ?", [email], (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Database error" });
    }
    if (!row) {
      return res.status(404).json({ error: "User not found" });
    }
    db.get(
      "SELECT id FROM passes WHERE user_email = ? ORDER BY created_at DESC LIMIT 1",
      [email],
      (findErr, passRow) => {
        if (findErr) {
          return res.status(500).json({ error: "Database error" });
        }
        if (!passRow) {
          const createdAt = new Date().toISOString();
          db.run(
            "INSERT INTO passes (user_email, total, remaining, created_at) VALUES (?, ?, ?, ?)",
            [email, totalValue, remainingValue, createdAt],
            function onInsert(insertErr) {
              if (insertErr) {
                return res.status(500).json({ error: "Database error" });
              }
              return res.json({
                id: this.lastID,
                total: totalValue,
                remaining: remainingValue,
              });
            },
          );
          return;
        }
        db.run(
          "UPDATE passes SET total = ?, remaining = ? WHERE id = ?",
          [totalValue, remainingValue, passRow.id],
          (updateErr) => {
            if (updateErr) {
              return res.status(500).json({ error: "Database error" });
            }
            return res.json({
              id: passRow.id,
              total: totalValue,
              remaining: remainingValue,
            });
          },
        );
      },
    );
  });
});

app.post("/api/admin/passes/use", requireAdmin, (req, res) => {
  const { email, classId } = req.body;
  if (!email || !classId) {
    return res.status(400).json({ error: "Email and classId required" });
  }
  db.get(
    "SELECT * FROM passes WHERE user_email = ? AND remaining > 0 ORDER BY created_at DESC LIMIT 1",
    [email],
    (err, passRow) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      if (!passRow) {
        return res.status(400).json({ error: "No active pass" });
      }
      db.get(
        "SELECT id, starts_at FROM classes WHERE id = ?",
        [classId],
        (classErr, classRow) => {
          if (classErr) {
            return res.status(500).json({ error: "Database error" });
          }
          if (!classRow) {
            return res.status(404).json({ error: "Class not found" });
          }
          const classStart = new Date(classRow.starts_at);
          const now = new Date();
          const earliest = new Date(
            now.getTime() - PASS_USE_BACKDATE_DAYS * 24 * 60 * 60 * 1000,
          );
          if (classStart > now) {
            return res
              .status(400)
              .json({ error: "Csak lezajlott orara adhato alkalom." });
          }
          if (classStart < earliest) {
            return res.status(400).json({
              error: "Csak az elmult 7 nap oraihoz adhato alkalom.",
            });
          }
          db.get(
            `SELECT pu.id
             FROM pass_uses pu
             JOIN passes p ON pu.pass_id = p.id
             WHERE p.user_email = ? AND pu.class_id = ?
             LIMIT 1`,
            [email, classId],
            (useErr, useRow) => {
              if (useErr) {
                return res.status(500).json({ error: "Database error" });
              }
              if (useRow) {
                return res
                  .status(400)
                  .json({ error: "Ez az alkalom mar levonva." });
              }
              const usedAt = new Date().toISOString();
              db.run(
                "UPDATE passes SET remaining = remaining - 1 WHERE id = ? AND remaining > 0",
                [passRow.id],
                function onUpdate(updateErr) {
                  if (updateErr) {
                    return res.status(500).json({ error: "Database error" });
                  }
                  if (this.changes === 0) {
                    return res.status(400).json({ error: "No remaining" });
                  }
                  db.run(
                    "INSERT INTO pass_uses (pass_id, class_id, used_at) VALUES (?, ?, ?)",
                    [passRow.id, classId, usedAt],
                    function onInsert(insertErr) {
                      if (insertErr) {
                        return res
                          .status(500)
                          .json({ error: "Database error" });
                      }
                      return res.json({ id: this.lastID });
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
});

app.delete("/api/admin/passes/use/:id", requireAdmin, (req, res) => {
  const useId = Number(req.params.id);
  db.get("SELECT pass_id FROM pass_uses WHERE id = ?", [useId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Database error" });
    }
    if (!row) {
      return res.status(404).json({ error: "Use not found" });
    }
    db.run("DELETE FROM pass_uses WHERE id = ?", [useId], (delErr) => {
      if (delErr) {
        return res.status(500).json({ error: "Database error" });
      }
      db.run(
        "UPDATE passes SET remaining = CASE WHEN remaining < total THEN remaining + 1 ELSE remaining END WHERE id = ?",
        [row.pass_id],
        (updateErr) => {
          if (updateErr) {
            return res.status(500).json({ error: "Database error" });
          }
          return res.json({ ok: true });
        },
      );
    });
  });
});

app.get("/api/admin/classes", requireAdmin, (req, res) => {
  db.all("SELECT * FROM classes ORDER BY starts_at ASC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: "Database error" });
    }
    if (!rows || rows.length === 0) {
      return res.json([]);
    }
    const classIds = rows.map((row) => row.id);
    const placeholders = classIds.map(() => "?").join(",");
    db.all(
      `SELECT id, class_id, name, email, status
       FROM signups
       WHERE (status IS NULL OR status NOT IN ('cancelled', 'rejected'))
         AND class_id IN (${placeholders})
       ORDER BY created_at ASC`,
      classIds,
      (signErr, signRows) => {
        if (signErr) {
          return res.status(500).json({ error: "Database error" });
        }
        const signupsByClass = new Map();
        signRows.forEach((row) => {
          const classKey = String(row.class_id);
          if (!signupsByClass.has(classKey)) {
            signupsByClass.set(classKey, []);
          }
          signupsByClass.get(classKey).push({
            id: row.id,
            name: row.name,
            email: row.email,
            status: row.status,
          });
        });
        const payload = rows.map((row) => ({
          ...mapClassRow(row),
          signups: signupsByClass.get(String(row.id)) || [],
        }));
        return res.json(payload);
      },
    );
  });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  db.all(
    "SELECT full_name, email, birth_date, phone, created_at FROM users ORDER BY created_at DESC",
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      const payload = rows.map((row) => ({
        fullName: row.full_name,
        email: row.email,
        birthDate: row.birth_date,
        phone: row.phone,
        createdAt: row.created_at,
      }));
      return res.json(payload);
    },
  );
});

app.get("/api/admin/users/with-pass", requireAdmin, (req, res) => {
  db.all(
    `SELECT
       u.full_name,
       u.email,
       u.birth_date,
       u.phone,
       u.created_at,
       (SELECT p.total FROM passes p WHERE p.user_email = u.email ORDER BY p.created_at DESC LIMIT 1) AS pass_total,
       (SELECT p.remaining FROM passes p WHERE p.user_email = u.email ORDER BY p.created_at DESC LIMIT 1) AS pass_remaining,
       (
         SELECT COUNT(*)
         FROM pass_uses pu
         WHERE pu.pass_id = (
           SELECT p2.id
           FROM passes p2
           WHERE p2.user_email = u.email
           ORDER BY p2.created_at DESC
           LIMIT 1
         )
       ) AS pass_used
     FROM users u
     ORDER BY u.created_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      const payload = rows.map((row) => ({
        fullName: row.full_name,
        email: row.email,
        birthDate: row.birth_date,
        phone: row.phone,
        createdAt: row.created_at,
        passTotal: row.pass_total != null ? Number(row.pass_total) : null,
        passRemaining:
          row.pass_remaining != null ? Number(row.pass_remaining) : null,
        passUsed: row.pass_used != null ? Number(row.pass_used) : null,
      }));
      return res.json(payload);
    },
  );
});

app.put("/api/admin/users/:email", requireAdmin, (req, res) => {
  const currentEmail = String(req.params.email || "")
    .trim()
    .toLowerCase();
  const { fullName, email, birthDate, phone, password } = req.body || {};
  const nextEmail = String(email || "")
    .trim()
    .toLowerCase();
  const nextName = String(fullName || "").trim();
  const nextBirthDate = String(birthDate || "").trim();
  const nextPhone = String(phone || "").trim();
  const nextPassword = String(password || "").trim();

  if (
    !currentEmail ||
    !nextName ||
    !nextEmail ||
    !nextBirthDate ||
    !nextPhone
  ) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  db.get(
    "SELECT email FROM users WHERE email = ?",
    [currentEmail],
    (err, currentUserRow) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      if (!currentUserRow) {
        return res.status(404).json({ error: "User not found" });
      }

      const updateUser = () => {
        const values = [
          nextName,
          nextEmail,
          nextBirthDate,
          nextPhone,
          currentEmail,
        ];
        let sql =
          "UPDATE users SET full_name = ?, email = ?, birth_date = ?, phone = ? WHERE email = ?";
        if (nextPassword) {
          const { hash, salt } = hashPassword(nextPassword);
          sql =
            "UPDATE users SET full_name = ?, email = ?, birth_date = ?, phone = ?, password_hash = ?, password_salt = ? WHERE email = ?";
          values.splice(4, 0, hash, salt);
        }

        db.run(sql, values, function onUserUpdate(updateErr) {
          if (updateErr) {
            if (String(updateErr.message || "").includes("UNIQUE")) {
              return res
                .status(409)
                .json({ error: "Email already registered" });
            }
            return res.status(500).json({ error: "Database error" });
          }
          if (this.changes === 0) {
            return res.status(404).json({ error: "User not found" });
          }

          const updateSignups = () => {
            db.run(
              "UPDATE signups SET email = ?, name = ? WHERE email = ?",
              [nextEmail, nextName, currentEmail],
              (signupErr) => {
                if (signupErr) {
                  return res.status(500).json({ error: "Database error" });
                }
                return updatePasses();
              },
            );
          };

          const updatePasses = () => {
            db.run(
              "UPDATE passes SET user_email = ? WHERE user_email = ?",
              [nextEmail, currentEmail],
              (passErr) => {
                if (passErr) {
                  return res.status(500).json({ error: "Database error" });
                }
                return res.json({
                  ok: true,
                  user: {
                    fullName: nextName,
                    email: nextEmail,
                    birthDate: nextBirthDate,
                    phone: nextPhone,
                  },
                });
              },
            );
          };

          return updateSignups();
        });
      };

      if (nextEmail === currentEmail) {
        return updateUser();
      }

      db.get(
        "SELECT email FROM users WHERE email = ?",
        [nextEmail],
        (dupeErr, dupeRow) => {
          if (dupeErr) {
            return res.status(500).json({ error: "Database error" });
          }
          if (dupeRow) {
            return res.status(409).json({ error: "Email already registered" });
          }
          return updateUser();
        },
      );
    },
  );
});

app.post("/api/admin/users/create", requireAdmin, (req, res) => {
  const { fullName, email, password, birthDate, phone } = req.body || {};
  if (!fullName || !email || !password || !birthDate || !phone) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  const createdAt = new Date().toISOString();
  const { hash, salt } = hashPassword(password);
  const consentText = "Admin created user";
  db.run(
    "INSERT INTO users (full_name, email, birth_date, phone, password_hash, password_salt, consent_text, consent_accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      fullName,
      email,
      birthDate,
      phone,
      hash,
      salt,
      consentText,
      createdAt,
      createdAt,
    ],
    function onInsert(err) {
      if (err) {
        if (String(err.message || "").includes("UNIQUE")) {
          return res.status(409).json({ error: "Email already registered" });
        }
        return res.status(500).json({ error: "Database error" });
      }
      return res.json({ ok: true, id: this.lastID });
    },
  );
});

app.delete("/api/admin/users/:email", requireAdmin, (req, res) => {
  const email = req.params.email;
  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }
  db.get("SELECT email FROM users WHERE email = ?", [email], (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Database error" });
    }
    if (!row) {
      return res.status(404).json({ error: "User not found" });
    }
    db.all(
      "SELECT id FROM passes WHERE user_email = ?",
      [email],
      (passesErr, passRows) => {
        if (passesErr) {
          return res.status(500).json({ error: "Database error" });
        }
        const passIds = passRows.map((passRow) => passRow.id);
        const deletePassUses = (index) => {
          if (index >= passIds.length) {
            return deletePasses();
          }
          db.run(
            "DELETE FROM pass_uses WHERE pass_id = ?",
            [passIds[index]],
            (delErr) => {
              if (delErr) {
                return res.status(500).json({ error: "Database error" });
              }
              return deletePassUses(index + 1);
            },
          );
        };
        const deletePasses = () => {
          db.run(
            "DELETE FROM passes WHERE user_email = ?",
            [email],
            (passDelErr) => {
              if (passDelErr) {
                return res.status(500).json({ error: "Database error" });
              }
              return deleteSignups();
            },
          );
        };
        const deleteSignups = () => {
          db.run(
            "DELETE FROM signups WHERE email = ?",
            [email],
            (signupDelErr) => {
              if (signupDelErr) {
                return res.status(500).json({ error: "Database error" });
              }
              return deleteUser();
            },
          );
        };
        const deleteUser = () => {
          db.run("DELETE FROM users WHERE email = ?", [email], (userErr) => {
            if (userErr) {
              return res.status(500).json({ error: "Database error" });
            }
            return res.json({ ok: true });
          });
        };

        return deletePassUses(0);
      },
    );
  });
});

app.post("/api/admin/classes/:id/availability", requireAdmin, (req, res) => {
  const classId = Number(req.params.id);
  const { isActive } = req.body || {};
  const isActiveValue = isActive ? 1 : 0;
  db.run(
    "UPDATE classes SET is_active = ? WHERE id = ?",
    [isActiveValue, classId],
    function onUpdate(err) {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: "Class not found" });
      }
      return res.json({ ok: true, isActive: Boolean(isActiveValue) });
    },
  );
});

app.post("/api/admin/classes/:id/signups", requireAdmin, (req, res) => {
  const classId = Number(req.params.id);
  const { name, email, userEmail } = req.body || {};
  const resolvedUserEmail = String(userEmail || "")
    .trim()
    .toLowerCase();
  const addSignup = (signupName, signupEmail) => {
    if (!signupName || !signupEmail) {
      return res.status(400).json({ error: "Name and email required" });
    }
    db.get(
      "SELECT title, starts_at, capacity FROM classes WHERE id = ?",
      [classId],
      (classErr, classRow) => {
        if (classErr) {
          return res.status(500).json({ error: "Database error" });
        }
        if (!classRow) {
          return res.status(404).json({ error: "Class not found" });
        }
        db.get(
          "SELECT id, status FROM signups WHERE class_id = ? AND email = ? AND status IN ('confirmed', 'pending')",
          [classId, signupEmail],
          (dupeErr, dupeRow) => {
            if (dupeErr) {
              return res.status(500).json({ error: "Database error" });
            }
            if (dupeRow) {
              return res
                .status(400)
                .json({ error: "Erre az órára már fel van iratkozva." });
            }
            db.get(
              "SELECT COUNT(*) AS confirmed_count FROM signups WHERE class_id = ? AND status = 'confirmed'",
              [classId],
              (countErr, countRow) => {
                if (countErr) {
                  return res.status(500).json({ error: "Database error" });
                }
                if (countRow.confirmed_count >= MAX_SIGNUPS) {
                  return res.status(400).json({ error: "Class is full" });
                }
                const createdAt = new Date().toISOString();
                db.run(
                  "INSERT INTO signups (class_id, name, email, created_at, status) VALUES (?, ?, ?, ?, 'confirmed')",
                  [classId, signupName, signupEmail, createdAt],
                  function onInsert(err) {
                    if (err) {
                      return res.status(500).json({ error: "Database error" });
                    }
                    createNotification(
                      "signup",
                      `Uj feliratkozas: ${signupName} (${signupEmail}) - ${classRow.title} (${classRow.starts_at})`,
                    );
                    sendTelegramMessage(
                      `Új feliratkozás: ${signupName} (${signupEmail}) - ${classRow.title} (${classRow.starts_at})`,
                    );
                    return res.json({ id: this.lastID });
                  },
                );
              },
            );
          },
        );
      },
    );
  };

  if (resolvedUserEmail) {
    db.get(
      "SELECT full_name, email FROM users WHERE email = ?",
      [resolvedUserEmail],
      (userErr, userRow) => {
        if (userErr) {
          return res.status(500).json({ error: "Database error" });
        }
        if (!userRow) {
          return res.status(404).json({ error: "User not found" });
        }
        return addSignup(userRow.full_name, userRow.email);
      },
    );
    return;
  }

  return addSignup(String(name || "").trim(), String(email || "").trim());
});

app.post("/api/admin/classes/:id/signups/cancel", requireAdmin, (req, res) => {
  const classId = Number(req.params.id);
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }
  db.get(
    `SELECT s.*, c.title AS class_title, c.starts_at AS class_starts
     FROM signups s
     JOIN classes c ON s.class_id = c.id
     WHERE s.class_id = ? AND s.email = ?
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [classId, email],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      if (!row) {
        return res.status(404).json({ error: "Signup not found" });
      }
      if (row.status === "cancelled" || row.status === "rejected") {
        return res.status(400).json({ error: "Signup already closed" });
      }
      db.run(
        "UPDATE signups SET status = 'cancelled' WHERE id = ?",
        [row.id],
        (updateErr) => {
          if (updateErr) {
            return res.status(500).json({ error: "Database error" });
          }
          db.get(
            `SELECT pu.id, pu.pass_id
             FROM pass_uses pu
             JOIN passes p ON pu.pass_id = p.id
             WHERE p.user_email = ? AND pu.class_id = ?
             ORDER BY pu.used_at DESC
             LIMIT 1`,
            [email, row.class_id],
            (passErr, passUseRow) => {
              if (passErr) {
                return res.status(500).json({ error: "Database error" });
              }
              const finalize = () => {
                createNotification(
                  "cancel",
                  `Lemondas: ${row.name} (${row.email}) - ${row.class_title} (${row.class_starts})`,
                );
                sendTelegramMessage(
                  `Lemondás: ${row.name} (${row.email}) - ${row.class_title} (${row.class_starts})`,
                );
                return res.json({ status: "cancelled" });
              };
              if (!passUseRow) {
                return finalize();
              }
              db.run(
                "UPDATE passes SET remaining = remaining + 1 WHERE id = ?",
                [passUseRow.pass_id],
                (refundErr) => {
                  if (refundErr) {
                    return res.status(500).json({ error: "Database error" });
                  }
                  db.run(
                    "DELETE FROM pass_uses WHERE id = ?",
                    [passUseRow.id],
                    (deleteErr) => {
                      if (deleteErr) {
                        return res
                          .status(500)
                          .json({ error: "Database error" });
                      }
                      return finalize();
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
});

app.post("/api/admin/classes", requireAdmin, (req, res) => {
  const { title, coach, startsAt, capacity, notes } = req.body;
  if (!title || !startsAt) {
    return res.status(400).json({ error: "Title and startsAt required" });
  }
  const capacityValue = Number.isFinite(Number(capacity))
    ? Number(capacity)
    : 9999;
  db.run(
    "INSERT INTO classes (title, coach, starts_at, capacity, notes) VALUES (?, ?, ?, ?, ?)",
    [title, coach || "", startsAt, capacityValue, notes || ""],
    function onInsert(err) {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      return res.json({ id: this.lastID });
    },
  );
});

app.put("/api/admin/classes/:id", requireAdmin, (req, res) => {
  const classId = Number(req.params.id);
  const { title, coach, startsAt, capacity, notes } = req.body;
  if (!title || !startsAt) {
    return res.status(400).json({ error: "Title and startsAt required" });
  }
  const capacityValue = Number.isFinite(Number(capacity))
    ? Number(capacity)
    : 9999;
  db.run(
    "UPDATE classes SET title = ?, coach = ?, starts_at = ?, capacity = ?, notes = ? WHERE id = ?",
    [title, coach || "", startsAt, capacityValue, notes || "", classId],
    function onUpdate(err) {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      return res.json({ changed: this.changes });
    },
  );
});

app.delete("/api/admin/classes/:id", requireAdmin, (req, res) => {
  const classId = Number(req.params.id);
  db.get(
    "SELECT title, starts_at FROM classes WHERE id = ?",
    [classId],
    (classErr, classRow) => {
      if (classErr) {
        return res.status(500).json({ error: "Database error" });
      }
      if (!classRow) {
        return res.status(404).json({ error: "Class not found" });
      }
      db.all(
        "SELECT id FROM signups WHERE class_id = ?",
        [classId],
        (signupsErr, signupRows) => {
          if (signupsErr) {
            return res.status(500).json({ error: "Database error" });
          }
          db.all(
            "SELECT pass_id FROM pass_uses WHERE class_id = ?",
            [classId],
            (usesErr, useRows) => {
              if (usesErr) {
                return res.status(500).json({ error: "Database error" });
              }
              const refundNext = (index) => {
                if (index >= useRows.length) {
                  return cleanupAfterRefunds();
                }
                const passId = useRows[index].pass_id;
                db.run(
                  "UPDATE passes SET remaining = remaining + 1 WHERE id = ?",
                  [passId],
                  (refundErr) => {
                    if (refundErr) {
                      return res.status(500).json({ error: "Database error" });
                    }
                    return refundNext(index + 1);
                  },
                );
              };

              const cleanupAfterRefunds = () => {
                db.run(
                  "DELETE FROM pass_uses WHERE class_id = ?",
                  [classId],
                  (delUsesErr) => {
                    if (delUsesErr) {
                      return res.status(500).json({ error: "Database error" });
                    }
                    db.run(
                      "DELETE FROM signups WHERE class_id = ?",
                      [classId],
                      (delSignupsErr) => {
                        if (delSignupsErr) {
                          return res
                            .status(500)
                            .json({ error: "Database error" });
                        }
                        db.run(
                          "DELETE FROM classes WHERE id = ?",
                          [classId],
                          function onDelete(err) {
                            if (err) {
                              return res
                                .status(500)
                                .json({ error: "Database error" });
                            }
                            if (signupRows.length > 0) {
                              const message = `Lemondás: Óra törölve - ${classRow.title} (${classRow.starts_at}) - ${signupRows.length} feliratkozás`;
                              createNotification("cancel", message);
                              sendTelegramMessage(message);
                            }
                            return res.json({ deleted: this.changes });
                          },
                        );
                      },
                    );
                  },
                );
              };

              return refundNext(0);
            },
          );
        },
      );
    },
  );
});

app.get("/api/admin/signups", requireAdmin, (req, res) => {
  db.all(
    `SELECT s.*, c.title AS class_title, c.starts_at AS class_starts
     FROM signups s
     JOIN classes c ON s.class_id = c.id
    ORDER BY s.created_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      const payload = rows.map((row) => ({
        id: row.id,
        classId: row.class_id,
        classTitle: row.class_title,
        classStartsAt: row.class_starts,
        name: row.name,
        email: row.email,
        createdAt: row.created_at,
        status: row.status,
      }));
      return res.json(payload);
    },
  );
});

app.post("/api/admin/signups/:id/approve", requireAdmin, (req, res) => {
  const signupId = Number(req.params.id);
  db.get(
    `SELECT s.*, c.capacity, c.title AS class_title, c.starts_at AS class_starts
     FROM signups s
     JOIN classes c ON s.class_id = c.id
     WHERE s.id = ?`,
    [signupId],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      if (!row) {
        return res.status(404).json({ error: "Signup not found" });
      }
      if (row.status !== "pending") {
        return res.status(400).json({ error: "Signup is not pending" });
      }
      db.get(
        "SELECT COUNT(*) AS confirmed_count FROM signups WHERE class_id = ? AND status = 'confirmed'",
        [row.class_id],
        (countErr, countRow) => {
          if (countErr) {
            return res.status(500).json({ error: "Database error" });
          }
          if (countRow.confirmed_count >= row.capacity) {
            return res.status(400).json({ error: "Class is full" });
          }
          db.run(
            "UPDATE signups SET status = 'confirmed' WHERE id = ?",
            [signupId],
            (updateErr) => {
              if (updateErr) {
                return res.status(500).json({ error: "Database error" });
              }
              createNotification(
                "approve",
                `Jovahagyva: ${row.name} (${row.email}) - ${row.class_title} (${row.class_starts})`,
              );
              return res.json({ status: "confirmed" });
            },
          );
        },
      );
    },
  );
});

app.post("/api/admin/signups/:id/reject", requireAdmin, (req, res) => {
  const signupId = Number(req.params.id);
  db.get(
    `SELECT s.*, c.title AS class_title, c.starts_at AS class_starts
     FROM signups s
     JOIN classes c ON s.class_id = c.id
     WHERE s.id = ?`,
    [signupId],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      if (!row) {
        return res.status(404).json({ error: "Signup not found" });
      }
      if (row.status !== "pending") {
        return res.status(400).json({ error: "Signup is not pending" });
      }
      db.run(
        "UPDATE signups SET status = 'rejected' WHERE id = ?",
        [signupId],
        (updateErr) => {
          if (updateErr) {
            return res.status(500).json({ error: "Database error" });
          }
          createNotification(
            "reject",
            `Elutasitva: ${row.name} (${row.email}) - ${row.class_title} (${row.class_starts})`,
          );
          return res.json({ status: "rejected" });
        },
      );
    },
  );
});

app.post("/api/admin/signups/:id/cancel", requireAdmin, (req, res) => {
  const signupId = Number(req.params.id);
  db.get(
    `SELECT s.*, c.title AS class_title, c.starts_at AS class_starts
     FROM signups s
     JOIN classes c ON s.class_id = c.id
     WHERE s.id = ?`,
    [signupId],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      if (!row) {
        return res.status(404).json({ error: "Signup not found" });
      }
      if (row.status === "cancelled" || row.status === "rejected") {
        return res.status(400).json({ error: "Signup already closed" });
      }
      db.run(
        "UPDATE signups SET status = 'cancelled' WHERE id = ?",
        [signupId],
        (updateErr) => {
          if (updateErr) {
            return res.status(500).json({ error: "Database error" });
          }
          db.get(
            `SELECT pu.id, pu.pass_id
             FROM pass_uses pu
             JOIN passes p ON pu.pass_id = p.id
             WHERE p.user_email = ? AND pu.class_id = ?
             ORDER BY pu.used_at DESC
             LIMIT 1`,
            [row.email, row.class_id],
            (passErr, passUseRow) => {
              if (passErr) {
                return res.status(500).json({ error: "Database error" });
              }
              const finalize = () => {
                createNotification(
                  "cancel",
                  `Lemondas: ${row.name} (${row.email}) - ${row.class_title} (${row.class_starts})`,
                );
                sendTelegramMessage(
                  `Lemondás: ${row.name} (${row.email}) - ${row.class_title} (${row.class_starts})`,
                );
                return res.json({ status: "cancelled" });
              };
              if (!passUseRow) {
                return finalize();
              }
              db.run(
                "UPDATE passes SET remaining = remaining + 1 WHERE id = ?",
                [passUseRow.pass_id],
                (refundErr) => {
                  if (refundErr) {
                    return res.status(500).json({ error: "Database error" });
                  }
                  db.run(
                    "DELETE FROM pass_uses WHERE id = ?",
                    [passUseRow.id],
                    (deleteErr) => {
                      if (deleteErr) {
                        return res
                          .status(500)
                          .json({ error: "Database error" });
                      }
                      return finalize();
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
});

app.get("/api/admin/notifications", requireAdmin, (req, res) => {
  db.all(
    "SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20",
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      return res.json(rows);
    },
  );
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

initDb()
  .then(() => {
    seedWeeklyClasses();
    processDuePassUses();
    setInterval(processDuePassUses, PASS_USE_SWEEP_INTERVAL_MS);
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database init failed", err);
    process.exit(1);
  });
