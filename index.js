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
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_DEFAULT_CALENDAR_ID = "primary";
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
  console.warn(`DATABASE_URL missing. Using SQLite fallback at ${DB_PATH}.`);
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
        location TEXT,
        is_active INTEGER NOT NULL DEFAULT 1
      )`,
    );
    await pgPool.query(
      "ALTER TABLE classes ADD COLUMN IF NOT EXISTS is_active INTEGER DEFAULT 1",
    );
    await pgPool.query(
      "ALTER TABLE classes ADD COLUMN IF NOT EXISTS location TEXT",
    );
    await pgPool.query(
      `CREATE TABLE IF NOT EXISTS signups (
        id SERIAL PRIMARY KEY,
        class_id INTEGER NOT NULL REFERENCES classes(id),
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        calendar_provider TEXT,
        calendar_event_id TEXT
      )`,
    );
    await pgPool.query(
      "ALTER TABLE signups ADD COLUMN IF NOT EXISTS calendar_provider TEXT",
    );
    await pgPool.query(
      "ALTER TABLE signups ADD COLUMN IF NOT EXISTS calendar_event_id TEXT",
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
        class_id INTEGER,
        used_at TEXT NOT NULL
      )`,
    );
    // Remove pass_used column if it exists (cleanup from old schema)
    await pgPool.query(`ALTER TABLE pass_uses DROP COLUMN IF EXISTS pass_used`);
    // Ensure class_id is nullable (migration from old schema)
    await pgPool
      .query(`ALTER TABLE pass_uses ALTER COLUMN class_id DROP NOT NULL`)
      .catch(() => {
        // Ignore if column doesn't have NOT NULL constraint
      });
    await pgPool.query(
      `CREATE TABLE IF NOT EXISTS user_calendar_connections (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_expiry TEXT,
        calendar_id TEXT NOT NULL DEFAULT 'primary',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
          location TEXT,
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
          calendar_provider TEXT,
          calendar_event_id TEXT,
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
          class_id INTEGER,
          used_at TEXT NOT NULL,
          FOREIGN KEY(pass_id) REFERENCES passes(id),
          FOREIGN KEY(class_id) REFERENCES classes(id)
        )`,
      );
      db.run(
        `CREATE TABLE IF NOT EXISTS user_calendar_connections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL UNIQUE,
          provider TEXT NOT NULL,
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          token_expiry TEXT,
          calendar_id TEXT NOT NULL DEFAULT 'primary',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
      );
      db.run("ALTER TABLE users ADD COLUMN phone TEXT", () => {});
      db.run("ALTER TABLE users ADD COLUMN password_hash TEXT", () => {});
      db.run("ALTER TABLE users ADD COLUMN password_salt TEXT", () => {});
      db.run("ALTER TABLE signups ADD COLUMN calendar_provider TEXT", () => {});
      db.run("ALTER TABLE signups ADD COLUMN calendar_event_id TEXT", () => {});
      db.run(
        "ALTER TABLE classes ADD COLUMN is_active INTEGER DEFAULT 1",
        () => {},
      );
      db.run("ALTER TABLE classes ADD COLUMN location TEXT", () => {});
      // Migration: Safe migration of pass_uses table to make class_id nullable
      db.run(`PRAGMA table_info(pass_uses)`, (infoErr, cols) => {
        if (infoErr || !cols) {
          console.log("pass_uses table info check passed");
          return;
        }

        // Check if class_id column has NOT NULL constraint (value 1 means NOT NULL)
        const classIdColumn = cols.find((col) => col.name === "class_id");
        if (!classIdColumn || classIdColumn.notnull === 0) {
          console.log("pass_uses.class_id is already nullable");
          return;
        }

        console.log(
          "Migrating pass_uses table to make class_id nullable (preserving data)...",
        );

        // Safe migration: rename old table, create new one with correct schema, copy data
        db.run("ALTER TABLE pass_uses RENAME TO pass_uses_old", (renameErr) => {
          if (renameErr) {
            console.warn(
              "Migration: Could not rename old table:",
              renameErr.message,
            );
            return;
          }

          db.run(
            `CREATE TABLE pass_uses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pass_id INTEGER NOT NULL,
                class_id INTEGER,
                used_at TEXT NOT NULL,
                FOREIGN KEY(pass_id) REFERENCES passes(id),
                FOREIGN KEY(class_id) REFERENCES classes(id)
              )`,
            (createErr) => {
              if (createErr) {
                console.warn(
                  "Migration: Could not create new table:",
                  createErr.message,
                );
                // Rollback
                db.run(
                  "ALTER TABLE pass_uses_old RENAME TO pass_uses",
                  () => {},
                );
                return;
              }

              // Copy data from old table
              db.run(
                `INSERT INTO pass_uses (id, pass_id, class_id, used_at) 
                   SELECT id, pass_id, class_id, used_at FROM pass_uses_old`,
                (insertErr) => {
                  if (insertErr) {
                    console.warn(
                      "Migration: Could not copy data:",
                      insertErr.message,
                    );
                    // Rollback
                    db.run("DROP TABLE pass_uses", () => {});
                    db.run(
                      "ALTER TABLE pass_uses_old RENAME TO pass_uses",
                      () => {},
                    );
                    return;
                  }

                  // Drop old table
                  db.run("DROP TABLE pass_uses_old", (dropErr) => {
                    if (dropErr) {
                      console.warn(
                        "Migration: Could not drop old table:",
                        dropErr.message,
                      );
                    } else {
                      console.log(
                        "Migration complete! pass_uses table migrated successfully.",
                      );
                    }
                  });
                },
              );
            },
          );
        });
      });
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

const dbRunAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

const dbGetAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row || null);
    });
  });

const isGoogleCalendarConfigured = () =>
  Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);

const buildGoogleAuthUrl = (state) => {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

const saveGoogleConnection = async ({
  userEmail,
  accessToken,
  refreshToken,
  tokenExpiry,
}) => {
  const now = new Date().toISOString();
  const sql =
    "INSERT INTO user_calendar_connections (user_email, provider, access_token, refresh_token, token_expiry, calendar_id, created_at, updated_at) VALUES (?, 'google', ?, ?, ?, ?, ?, ?) ON CONFLICT (user_email) DO UPDATE SET provider = 'google', access_token = excluded.access_token, refresh_token = COALESCE(excluded.refresh_token, user_calendar_connections.refresh_token), token_expiry = excluded.token_expiry, calendar_id = excluded.calendar_id, updated_at = excluded.updated_at";
  await dbRunAsync(sql, [
    userEmail,
    accessToken,
    refreshToken || null,
    tokenExpiry || null,
    GOOGLE_DEFAULT_CALENDAR_ID,
    now,
    now,
  ]);
};

const getGoogleConnectionByEmail = async (email) => {
  return dbGetAsync(
    "SELECT * FROM user_calendar_connections WHERE user_email = ? AND provider = 'google'",
    [email],
  );
};

const refreshGoogleAccessTokenIfNeeded = async (connection) => {
  if (!connection) {
    return null;
  }
  const expiryMs = connection.token_expiry
    ? new Date(connection.token_expiry).getTime()
    : 0;
  const nowMs = Date.now();
  if (expiryMs && expiryMs - nowMs > 60 * 1000) {
    return connection;
  }
  if (!connection.refresh_token) {
    return connection;
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: connection.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!tokenResponse.ok) {
    return connection;
  }
  const tokenData = await tokenResponse.json();
  const tokenExpiry = tokenData.expires_in
    ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
    : connection.token_expiry;
  await saveGoogleConnection({
    userEmail: connection.user_email,
    accessToken: tokenData.access_token,
    refreshToken: connection.refresh_token,
    tokenExpiry,
  });
  return {
    ...connection,
    access_token: tokenData.access_token,
    token_expiry: tokenExpiry,
  };
};

const createGoogleCalendarEventForSignup = async ({
  signupId,
  email,
  classRow,
  fullName,
}) => {
  if (!isGoogleCalendarConfigured()) {
    return;
  }
  const connection = await getGoogleConnectionByEmail(email);
  if (!connection) {
    return;
  }
  const activeConnection = await refreshGoogleAccessTokenIfNeeded(connection);
  const startDate = new Date(classRow.starts_at);
  const endDate = new Date(
    startDate.getTime() + CLASS_DURATION_MINUTES * 60000,
  );

  const eventPayload = {
    summary: classRow.title || "Edzés MuscleFit",
    description: [
      classRow.coach ? `Edzo: ${classRow.coach}` : null,
      fullName ? `Resztvevo: ${fullName}` : null,
      classRow.notes ? `Megjegyzes: ${classRow.notes}` : null,
    ]
      .filter(Boolean)
      .join("\\n"),
    start: {
      dateTime: startDate.toISOString(),
      timeZone: "Europe/Budapest",
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: "Europe/Budapest",
    },
  };

  if (classRow.location) {
    eventPayload.location = classRow.location;
  }

  const calendarId = encodeURIComponent(
    activeConnection.calendar_id || GOOGLE_DEFAULT_CALENDAR_ID,
  );
  const createResponse = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${activeConnection.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventPayload),
    },
  );
  if (!createResponse.ok) {
    return;
  }
  const eventData = await createResponse.json();
  if (!eventData.id) {
    return;
  }
  await dbRunAsync(
    "UPDATE signups SET calendar_provider = 'google', calendar_event_id = ? WHERE id = ?",
    [eventData.id, signupId],
  );
};

const deleteGoogleCalendarEventForSignup = async ({
  signupId,
  email,
  eventId,
}) => {
  if (!isGoogleCalendarConfigured() || !eventId) {
    return;
  }
  const connection = await getGoogleConnectionByEmail(email);
  if (!connection) {
    await dbRunAsync(
      "UPDATE signups SET calendar_provider = NULL, calendar_event_id = NULL WHERE id = ?",
      [signupId],
    );
    return;
  }
  const activeConnection = await refreshGoogleAccessTokenIfNeeded(connection);
  const calendarId = encodeURIComponent(
    activeConnection.calendar_id || GOOGLE_DEFAULT_CALENDAR_ID,
  );
  const deleteResponse = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${activeConnection.access_token}`,
      },
    },
  );
  if (deleteResponse.ok || deleteResponse.status === 404) {
    await dbRunAsync(
      "UPDATE signups SET calendar_provider = NULL, calendar_event_id = NULL WHERE id = ?",
      [signupId],
    );
  }
};

const escapeIcsText = (value) =>
  String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const toIcsUtc = (date) => {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
};

const buildSignupIcs = ({
  uid,
  title,
  description,
  startsAt,
  endsAt,
  location,
}) => {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//idopont_foglalas//edzes//HU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(startsAt)}`,
    `DTEND:${toIcsUtc(endsAt)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
  ];
  if (location) {
    lines.push(`LOCATION:${escapeIcsText(location)}`);
  }
  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
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

const FRIDAY_DISABLED_SLOTS = new Set(["16:00", "17:00", "18:00", "19:00"]);

const isFridayDisabledClass = (startsAtIso) => {
  const startsAt = new Date(startsAtIso);
  const weekday = startsAt.getDay();
  const time = `${String(startsAt.getHours()).padStart(2, "0")}:${String(
    startsAt.getMinutes(),
  ).padStart(2, "0")}`;
  return weekday === 5 && FRIDAY_DISABLED_SLOTS.has(time);
};

const removeEmptyDisabledFridayClasses = () => {
  const nowIso = new Date().toISOString();
  db.all(
    "SELECT id, starts_at FROM classes WHERE starts_at >= ?",
    [nowIso],
    (err, rows) => {
      if (err || !rows || rows.length === 0) {
        return;
      }

      const candidates = rows.filter((row) =>
        isFridayDisabledClass(row.starts_at),
      );
      const processNext = (index) => {
        if (index >= candidates.length) {
          return;
        }
        const row = candidates[index];
        db.get(
          `SELECT COUNT(*) AS count
           FROM signups
           WHERE class_id = ?
             AND (status IS NULL OR status NOT IN ('cancelled', 'rejected'))`,
          [row.id],
          (countErr, countRow) => {
            if (countErr) {
              return processNext(index + 1);
            }
            if ((countRow && Number(countRow.count)) > 0) {
              return processNext(index + 1);
            }
            db.run("DELETE FROM classes WHERE id = ?", [row.id], () =>
              processNext(index + 1),
            );
          },
        );
      };

      processNext(0);
    },
  );
};

const getDisplayWeekStart = () => {
  const now = new Date();
  const day = now.getDay();
  const weekStart = new Date(now);
  const diffToMonday = day === 0 ? -6 : 1 - day;
  weekStart.setDate(now.getDate() + diffToMonday);
  weekStart.setHours(0, 0, 0, 0);

  const isFridayAfterNoon = day === 5 && now.getHours() >= 12;
  const isWeekend = day === 6 || day === 0;
  if (isFridayAfterNoon || isWeekend) {
    weekStart.setDate(weekStart.getDate() + 7);
  }
  return weekStart;
};

const seedWeeklyClasses = () => {
  const weekStart = getDisplayWeekStart();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  db.all(
    "SELECT starts_at FROM classes WHERE starts_at >= ? AND starts_at < ?",
    [weekStart.toISOString(), weekEnd.toISOString()],
    (err, rows) => {
      if (err) {
        return;
      }

      const existingSlots = new Set();
      (rows || []).forEach((row) => {
        const startsAt = new Date(row.starts_at);
        const weekday = startsAt.getDay();
        const time = `${String(startsAt.getHours()).padStart(2, "0")}:${String(
          startsAt.getMinutes(),
        ).padStart(2, "0")}`;
        if (weekday >= 1 && weekday <= 5) {
          existingSlots.add(`${weekday}-${time}`);
        }
      });

      const stmt = db.prepare(
        "INSERT INTO classes (title, coach, starts_at, capacity, notes, location) VALUES (?, ?, ?, ?, ?, ?)",
      );

      WEEK_DAYS.forEach((day) => {
        TIME_SLOTS.forEach((time) => {
          if (day.key === 5 && FRIDAY_DISABLED_SLOTS.has(time)) {
            return;
          }
          if (existingSlots.has(`${day.key}-${time}`)) {
            return;
          }
          const [hour, minute] = time.split(":").map(Number);
          const startsAt = new Date(weekStart);
          startsAt.setDate(weekStart.getDate() + (day.key - 1));
          startsAt.setHours(hour, minute, 0, 0);
          stmt.run(
            "Edzés MuscleFit",
            "Zoltan",
            startsAt.toISOString(),
            MAX_SIGNUPS,
            "",
            "5700 Gyula, Csabai út 3.",
          );
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

app.get("/api/admin/all-classes", requireAdmin, (req, res) => {
  db.all("SELECT * FROM classes ORDER BY starts_at ASC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: "Database error" });
    }
    const payload = (rows || []).map((row) => mapClassRow(row));
    return res.json(payload);
  });
});

// ÚJ: Admin - elmúlt 7 nap összes órája (signuptól függetlenül)
app.get("/api/admin/classes/last7days", requireAdmin, (req, res) => {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - 7);
  db.all(
    `SELECT c.*, (
        SELECT COUNT(*) FROM signups s WHERE s.class_id = c.id AND s.status = 'confirmed'
      ) AS confirmed_count
      FROM classes c
      WHERE c.starts_at >= ? AND c.starts_at <= ?
      ORDER BY c.starts_at DESC`,
    [from.toISOString(), now.toISOString()],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      return res.json(rows || []);
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

app.get("/api/calendar/google/status", requireUser, async (req, res) => {
  if (!isGoogleCalendarConfigured()) {
    return res.json({ configured: false, connected: false });
  }
  try {
    const connection = await getGoogleConnectionByEmail(req.session.user.email);
    return res.json({
      configured: true,
      connected: Boolean(connection),
      provider: connection ? "google" : null,
    });
  } catch (err) {
    return res.status(500).json({ error: "Calendar status error" });
  }
});

app.get("/api/calendar/google/connect", requireUser, (req, res) => {
  if (!isGoogleCalendarConfigured()) {
    return res
      .status(503)
      .json({ error: "Google Calendar nincs konfigurálva." });
  }
  const state = crypto.randomBytes(16).toString("hex");
  req.session.googleCalendarState = state;
  req.session.googleCalendarStateEmail = req.session.user.email;
  req.session.googleCalendarStateExpires = Date.now() + 10 * 60 * 1000;
  return res.json({ url: buildGoogleAuthUrl(state) });
});

app.get("/api/calendar/google/callback", async (req, res) => {
  const { code, state } = req.query;
  const stateValid =
    state &&
    req.session &&
    req.session.user &&
    req.session.googleCalendarState === state &&
    req.session.googleCalendarStateEmail === req.session.user.email &&
    Number(req.session.googleCalendarStateExpires || 0) > Date.now();

  req.session.googleCalendarState = null;
  req.session.googleCalendarStateEmail = null;
  req.session.googleCalendarStateExpires = null;

  if (!stateValid || !code) {
    return res.redirect("/?calendar=error");
  }
  if (!isGoogleCalendarConfigured()) {
    return res.redirect("/?calendar=not-configured");
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) {
      return res.redirect("/?calendar=token-error");
    }
    const tokenData = await tokenResponse.json();
    const tokenExpiry = tokenData.expires_in
      ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
      : null;
    await saveGoogleConnection({
      userEmail: req.session.user.email,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      tokenExpiry,
    });
    return res.redirect("/?calendar=connected");
  } catch (err) {
    return res.redirect("/?calendar=error");
  }
});

app.post("/api/calendar/google/disconnect", requireUser, async (req, res) => {
  try {
    await dbRunAsync(
      "DELETE FROM user_calendar_connections WHERE user_email = ? AND provider = 'google'",
      [req.session.user.email],
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Disconnect failed" });
  }
});

app.get("/api/signups/:id/calendar.ics", requireUser, (req, res) => {
  const signupId = Number(req.params.id);
  const email = req.session.user.email;
  db.get(
    `SELECT s.id, s.status, s.email, c.id AS class_id, c.title, c.coach, c.starts_at, c.location
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
      if (row.status !== "confirmed") {
        return res.status(400).json({
          error: "Csak megerositett feliratkozashoz toltheto le naptar.",
        });
      }

      const startsAt = new Date(row.starts_at);
      const endsAt = new Date(
        startsAt.getTime() + CLASS_DURATION_MINUTES * 60000,
      );
      const host = req.get("host") || "idopont-foglalas.local";
      const uid = `signup-${row.id}@${host}`;
      const description = [
        row.coach ? `Edzo: ${row.coach}` : null,
        `Feliratkozo: ${email}`,
      ]
        .filter(Boolean)
        .join("\\n");
      const ics = buildSignupIcs({
        uid,
        title: row.title || "Edzés MuscleFit",
        description,
        startsAt,
        endsAt,
        location: row.location,
      });

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=\"edzes-${row.class_id}-${row.id}.ics\"`,
      );
      return res.send(ics);
    },
  );
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
         LEFT JOIN classes c ON pu.class_id = c.id
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
              title: row.title || "Alkalom",
              startsAt: row.starts_at || row.used_at,
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
                createGoogleCalendarEventForSignup({
                  signupId: this.lastID,
                  email,
                  classRow,
                  fullName,
                }).catch((syncErr) => {
                  console.warn(
                    "Google Calendar sync (create) failed",
                    syncErr.message || syncErr,
                  );
                });
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
                        deleteGoogleCalendarEventForSignup({
                          signupId,
                          email,
                          eventId: row.calendar_event_id,
                        }).catch((syncErr) => {
                          console.warn(
                            "Google Calendar sync (delete) failed",
                            syncErr.message || syncErr,
                          );
                        });
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
              deleteGoogleCalendarEventForSignup({
                signupId,
                email,
                eventId: row.calendar_event_id,
              }).catch((syncErr) => {
                console.warn(
                  "Google Calendar sync (delete) failed",
                  syncErr.message || syncErr,
                );
              });
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
  const now = new Date();
  const weekStart = getDisplayWeekStart();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const deleteFrom = now > weekStart ? now : weekStart;
  const deleteFromIso = deleteFrom.toISOString();
  const weekEndIso = weekEnd.toISOString();

  db.run(
    `DELETE FROM classes
     WHERE starts_at >= ?
       AND starts_at < ?
       AND id NOT IN (
         SELECT DISTINCT class_id
         FROM signups
         WHERE class_id IS NOT NULL
       )`,
    [deleteFromIso, weekEndIso],
    (classesErr) => {
      if (classesErr) {
        return res.status(500).json({ error: "Database error" });
      }
      removeEmptyDisabledFridayClasses();
      seedWeeklyClasses();
      return res.json({ ok: true });
    },
  );
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
         LEFT JOIN classes c ON pu.class_id = c.id
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
              title: row.title || "Alkalom",
              startsAt: row.starts_at || row.used_at,
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

        // Helper function to set or create pass
        const setPassValue = (passId, shouldInsert) => {
          const query = shouldInsert
            ? "INSERT INTO passes (user_email, total, remaining, created_at) VALUES (?, ?, ?, ?)"
            : "UPDATE passes SET total = ?, remaining = ? WHERE id = ?";

          const params = shouldInsert
            ? [email, totalValue, remainingValue, new Date().toISOString()]
            : [totalValue, remainingValue, passId];

          db.run(query, params, function onUpdate(updateErr) {
            if (updateErr) {
              return res.status(500).json({ error: "Database error" });
            }
            return res.json({
              id: shouldInsert ? this.lastID : passId,
              total: totalValue,
              remaining: remainingValue,
            });
          });
        };

        if (!passRow) {
          setPassValue(null, true);
        } else {
          setPassValue(passRow.id, false);
        }
      },
    );
  });
});

app.post("/api/admin/passes/use", requireAdmin, (req, res) => {
  const { email, used_at } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }

  // Get the pass first
  db.get(
    "SELECT id, total FROM passes WHERE user_email = ? ORDER BY created_at DESC LIMIT 1",
    [email],
    (err, passRow) => {
      if (err) {
        return res
          .status(500)
          .json({ error: "Database error: " + err.message });
      }
      if (!passRow) {
        return res.status(400).json({ error: "No active pass" });
      }

      // Check current usage count
      db.get(
        "SELECT COUNT(*) as count FROM pass_uses WHERE pass_id = ?",
        [passRow.id],
        (countErr, countRow) => {
          if (countErr) {
            return res
              .status(500)
              .json({ error: "Database error: " + countErr.message });
          }

          const currentUsed = countRow ? countRow.count : 0;
          if (currentUsed >= passRow.total) {
            return res.status(400).json({ error: "No remaining uses" });
          }

          const usedAt = used_at || new Date().toISOString();

          // Insert the pass use
          db.run(
            "INSERT INTO pass_uses (pass_id, used_at) VALUES (?, ?)",
            [passRow.id, usedAt],
            function onInsert(insertErr) {
              if (insertErr) {
                return res
                  .status(500)
                  .json({ error: "Database error: " + insertErr.message });
              }

              const insertedId = this.lastID;

              // Update remaining to keep it in sync with actual uses
              const remaining = Math.max(0, passRow.total - (currentUsed + 1));
              db.run(
                "UPDATE passes SET remaining = ? WHERE id = ?",
                [remaining, passRow.id],
                (syncErr) => {
                  // Return success regardless of sync error (INSERT already succeeded)
                  if (syncErr) {
                    console.warn(
                      "Warning: Failed to sync remaining:",
                      syncErr.message,
                    );
                  }
                  return res.json({ id: insertedId, success: true });
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
    removeEmptyDisabledFridayClasses();
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
