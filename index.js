require("dotenv").config();
process.env.TZ = process.env.TZ || "Europe/Budapest";
const path = require("path");
const express = require("express");
const session = require("express-session");
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
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
  }),
);
app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store");
    },
  }),
);

const db = new sqlite3.Database(path.join(__dirname, "data.db"));

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      coach TEXT,
      starts_at TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      notes TEXT
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
});

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
  db.run(
    "INSERT OR REPLACE INTO push_subscriptions (endpoint, subscription, created_at) VALUES (?, ?, ?)",
    [endpoint, JSON.stringify(subscription), createdAt],
    callback,
  );
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

const FRIDAY_AFTERNOON = new Set(["16:00", "17:00", "18:00", "19:00"]);

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
          stmt.run("Edzes", "Zoltan", startsAt.toISOString(), 9999, "");
        });
      });

      stmt.finalize();
    },
  );
};

app.get("/api/classes", (req, res) => {
  db.all(
    `SELECT c.*, (
      SELECT COUNT(*) FROM signups s WHERE s.class_id = c.id AND s.status = 'confirmed'
    ) AS confirmed_count
    FROM classes c
    ORDER BY datetime(c.starts_at) ASC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      const payload = rows.map((row) => ({
        ...mapClassRow(row),
        confirmedCount: row.confirmed_count,
        spotsLeft: Math.max(0, row.capacity - row.confirmed_count),
      }));
      return res.json(payload);
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
  await sendTelegramMessage("Telegram teszt uzenet: mukodik az ertesites.");
  return res.json({ ok: true });
});

app.get("/api/passes/me", requireUser, (req, res) => {
  const { email } = req.session.user;
  db.get(
    "SELECT * FROM passes WHERE user_email = ? ORDER BY datetime(created_at) DESC LIMIT 1",
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
         ORDER BY datetime(pu.used_at) DESC`,
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

    const now = new Date();
    const classStart = new Date(classRow.starts_at);
    if (now >= classStart) {
      return res
        .status(400)
        .json({ error: "A feliratkozás az óra kezdete után nem lehetséges." });
    }

    const createdAt = new Date().toISOString();
    db.run(
      "INSERT INTO signups (class_id, name, email, created_at, status) VALUES (?, ?, ?, ?, 'confirmed')",
      [classId, fullName, email, createdAt],
      function onInsert(insertErr) {
        if (insertErr) {
          return res.status(500).json({ error: "Database error" });
        }
        db.get(
          "SELECT * FROM passes WHERE user_email = ? AND remaining > 0 ORDER BY datetime(created_at) DESC LIMIT 1",
          [email],
          (passErr, passRow) => {
            if (!passErr && passRow) {
              db.run(
                "UPDATE passes SET remaining = remaining - 1 WHERE id = ?",
                [passRow.id],
              );
              db.run(
                "INSERT INTO pass_uses (pass_id, class_id, used_at) VALUES (?, ?, ?)",
                [passRow.id, classId, createdAt],
              );
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
              `Uj feliratkozas: ${fullName} (${email}) - ${classRow.title} (${classRow.starts_at})`,
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
             ORDER BY datetime(pu.used_at) DESC
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
     ORDER BY datetime(c.starts_at) DESC`,
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
  db.serialize(() => {
    db.run("DELETE FROM signups");
    db.run("DELETE FROM pass_uses");
    db.run("DELETE FROM classes", (err) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      seedWeeklyClasses();
      return res.json({ ok: true });
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
    "SELECT * FROM passes WHERE user_email = ? ORDER BY datetime(created_at) DESC LIMIT 1",
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
         ORDER BY datetime(pu.used_at) DESC`,
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
      "SELECT id FROM passes WHERE user_email = ? ORDER BY datetime(created_at) DESC LIMIT 1",
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
    "SELECT * FROM passes WHERE user_email = ? AND remaining > 0 ORDER BY datetime(created_at) DESC LIMIT 1",
    [email],
    (err, passRow) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      if (!passRow) {
        return res.status(400).json({ error: "No active pass" });
      }
      db.get(
        "SELECT id FROM classes WHERE id = ?",
        [classId],
        (classErr, classRow) => {
          if (classErr) {
            return res.status(500).json({ error: "Database error" });
          }
          if (!classRow) {
            return res.status(404).json({ error: "Class not found" });
          }
          const usedAt = new Date().toISOString();
          db.run(
            "UPDATE passes SET remaining = remaining - 1 WHERE id = ?",
            [passRow.id],
            (updateErr) => {
              if (updateErr) {
                return res.status(500).json({ error: "Database error" });
              }
              db.run(
                "INSERT INTO pass_uses (pass_id, class_id, used_at) VALUES (?, ?, ?)",
                [passRow.id, classId, usedAt],
                function onInsert(insertErr) {
                  if (insertErr) {
                    return res.status(500).json({ error: "Database error" });
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
  db.all(
    "SELECT * FROM classes ORDER BY datetime(starts_at) ASC",
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      return res.json(rows.map(mapClassRow));
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
  db.run("DELETE FROM classes WHERE id = ?", [classId], function onDelete(err) {
    if (err) {
      return res.status(500).json({ error: "Database error" });
    }
    return res.json({ deleted: this.changes });
  });
});

app.get("/api/admin/signups", requireAdmin, (req, res) => {
  db.all(
    `SELECT s.*, c.title AS class_title, c.starts_at AS class_starts
     FROM signups s
     JOIN classes c ON s.class_id = c.id
     ORDER BY datetime(s.created_at) DESC`,
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

app.get("/api/admin/notifications", requireAdmin, (req, res) => {
  db.all(
    "SELECT * FROM notifications ORDER BY datetime(created_at) DESC LIMIT 20",
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

app.listen(PORT, () => {
  seedWeeklyClasses();
  console.log(`Server running on http://localhost:${PORT}`);
});
