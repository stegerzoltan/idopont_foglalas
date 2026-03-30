const classList = document.getElementById("class-list");
const signupModal = document.getElementById("signup-modal");
const signupForm = document.getElementById("signup-form");
const signupMessage = document.getElementById("signup-message");
const signupLoginState = document.getElementById("signup-login-state");
const signupClassId = document.getElementById("signup-class-id");
const signupName = document.getElementById("signup-name");
const signupEmail = document.getElementById("signup-email");
const signupLoginButton = document.getElementById("signup-login");
const mySignups = document.getElementById("my-signups");
const mySignupsList = document.getElementById("my-signups-list");
const userPill = document.getElementById("user-pill");
const openUser = document.getElementById("open-user");
const userModal = document.getElementById("user-modal");
const userLoginForm = document.getElementById("user-login-form");
const userLoginMessage = document.getElementById("user-login-message");

const authLoginButton = document.getElementById("auth-login");
const authRegisterButton = document.getElementById("auth-register");
const authSubmitButton = document.getElementById("auth-submit");
const userFullName = document.getElementById("user-full-name");
const userPassword = document.getElementById("user-password");
const userBirthDate = document.getElementById("user-birth-date");
const userPhone = document.getElementById("user-phone");
const userConsent = document.getElementById("user-consent");
const consentText = document.getElementById("consent-text");
const openAdmin = document.getElementById("open-admin");
const adminModal = document.getElementById("admin-modal");
const adminLoginForm = document.getElementById("admin-login-form");
const adminLoginMessage = document.getElementById("admin-login-message");
const adminPanel = document.getElementById("admin-panel");
const enablePushButton = document.getElementById("enable-push");
const pushStatus = document.getElementById("push-status");
const testTelegramButton = document.getElementById("test-telegram");
const telegramStatus = document.getElementById("telegram-status");
const closeSignup = document.getElementById("close-signup");
const closeUser = document.getElementById("close-user");
const closeAdmin = document.getElementById("close-admin");
const adminLogout = document.getElementById("admin-logout");
const regenerateClassesButton = document.getElementById("regenerate-classes");
const classMessage = document.getElementById("class-message");
const adminClassList = document.getElementById("admin-class-list");
const adminClassToggle = document.getElementById("admin-class-toggle");
const adminNotificationsToggle = document.getElementById(
  "admin-notifications-toggle",
);
const adminNotifications = document.getElementById("admin-notifications");
const adminUsersPass = document.getElementById("admin-users-pass");
const adminPill = document.getElementById("admin-pill");
const weekTitle = document.getElementById("week-title");
const openPass = document.getElementById("open-pass");
const openSignups = document.getElementById("open-signups");
const signupsModal = document.getElementById("signups-modal");
const passModal = document.getElementById("pass-modal");
const closePass = document.getElementById("close-pass");
const passSummary = document.getElementById("pass-summary");
const passUses = document.getElementById("pass-uses");
const closeSignups = document.getElementById("close-signups");
const signupsList = document.getElementById("signups-list");
const dayMenu = document.getElementById("day-menu");
const scrollTopButton = document.getElementById("scroll-top");
const passAdminEmail = document.getElementById("pass-admin-email");
const loadPassAdminButton = document.getElementById("load-pass-admin");
const assignPassButton = document.getElementById("assign-pass");
const passTotalInput = document.getElementById("pass-total");
const passRemainingInput = document.getElementById("pass-remaining");
const savePassAdminButton = document.getElementById("save-pass-admin");
const passUseDate = document.getElementById("pass-use-date");
const addPassUseButton = document.getElementById("add-pass-use");
const passUsesAdmin = document.getElementById("pass-uses-admin");
const passAdminStatus = document.getElementById("pass-admin-status");

let currentUser = null;
let lastClasses = [];
let pendingSignupItem = null;
let mySignupByClass = new Map();
let mySignupsCache = [];
let authMode = "login";
let lastViewportWidth = window.innerWidth;
let adminClassesCache = [];
let adminUsersCache = [];
let adminClassesOpen = false;
let adminNotificationsOpen = false;

const WEEK_DAYS = [
  { key: 1, label: "Hétfő" },
  { key: 2, label: "Kedd" },
  { key: 3, label: "Szerda" },
  { key: 4, label: "Csütörtök" },
  { key: 5, label: "Péntek" },
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

const FRIDAY_DISABLED_SLOTS = new Set(["16:00", "17:00", "18:00", "19:00"]);

// Helper function for API calls that maintains session cookies
const apiFetch = (url, options = {}) => {
  return fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
};

const isFridayDisabledClass = (startsAtIso) => {
  const startsAt = toBudapestDate(startsAtIso);
  const weekday = startsAt.getDay();
  const time = formatTimeKey(startsAtIso);
  return weekday === 5 && FRIDAY_DISABLED_SLOTS.has(time);
};

const formatDate = (iso) => {
  const date = new Date(iso);
  return date.toLocaleString("hu-HU", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Budapest",
  });
};

const formatTimeKey = (iso) => {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("hu-HU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Budapest",
  }).format(date);
};

const compactSignupName = (value) => {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length <= 1) {
    return parts[0] || "";
  }
  return `${parts[0]} ${parts[1].charAt(0)}.`;
};

const getBudapestNow = () =>
  new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Budapest" }));

const toBudapestDate = (iso) =>
  new Date(
    new Date(iso).toLocaleString("en-US", { timeZone: "Europe/Budapest" }),
  );

const openModal = (modal) => {
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
};

const closeModal = (modal) => {
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  const hasOpenModal = document.querySelector(".modal.show");
  if (!hasOpenModal) {
    document.body.classList.remove("modal-open");
  }
};

const openAdminLogin = () => {
  openModal(adminModal);
  loadAdminData();
};

const shouldOpenAdminFromUrl = () => {
  const hash = String(window.location.hash || "").toLowerCase();
  if (hash === "#admin") {
    return true;
  }
  const params = new URLSearchParams(window.location.search);
  return params.get("admin") === "1";
};

const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("36")) {
    return `+36${digits.slice(2)}`;
  }
  if (digits.length === 0) {
    return "+36";
  }
  return `+36${digits}`;
};

const normalizeBirthDate = (value) => {
  const digits = String(value || "")
    .replace(/\D/g, "")
    .slice(0, 8);
  if (digits.length <= 4) {
    return digits;
  }
  if (digits.length <= 6) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
};

const urlBase64ToUint8Array = (base64String) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

const subscribeToPush = async () => {
  if (!enablePushButton || !pushStatus) {
    return;
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    pushStatus.textContent = "A böngésződ nem támogatja a push értesítéseket.";
    return;
  }
  pushStatus.textContent = "Engedélykérés folyamatban...";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    pushStatus.textContent = "Az értesítés engedélyezése szükséges.";
    return;
  }
  const registration = await navigator.serviceWorker.register("/sw.js");
  const keyResponse = await apiFetch("/api/push/vapid-public-key", {
    credentials: "same-origin",
  });
  if (!keyResponse.ok) {
    pushStatus.textContent =
      keyResponse.status === 401
        ? "Admin belépés szükséges az értesítésekhez."
        : "Nem sikerült a kulcsot lekérni.";
    return;
  }
  const { publicKey } = await keyResponse.json();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const saveResponse = await apiFetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(subscription),
  });
  if (!saveResponse.ok) {
    pushStatus.textContent =
      saveResponse.status === 401
        ? "Admin belépés szükséges az értesítésekhez."
        : "Nem sikerült menteni az értesítést.";
    return;
  }
  pushStatus.textContent = "Értesítés bekapcsolva.";
};

const getDisplayWeekStart = () => {
  const now = getBudapestNow();
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

const filterClassesToDisplayWeek = (classes) => {
  const weekStart = getDisplayWeekStart();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  return (classes || []).filter((item) => {
    const startsAt = toBudapestDate(item.startsAt);
    return startsAt >= weekStart && startsAt < weekEnd;
  });
};

const getIsoWeekNumber = (date) => {
  const temp = new Date(date);
  temp.setHours(0, 0, 0, 0);
  const day = temp.getDay() || 7;
  temp.setDate(temp.getDate() + 4 - day);
  const yearStart = new Date(temp.getFullYear(), 0, 1);
  const diffDays = Math.floor((temp - yearStart) / 86400000) + 1;
  return Math.ceil(diffDays / 7);
};

const updateWeekTitle = () => {
  if (!weekTitle) {
    return;
  }
  const weekStart = getDisplayWeekStart();
  const weekNumber = getIsoWeekNumber(weekStart);
  weekTitle.textContent = `${weekNumber}. hét edzései`;
};

const buildWeekDaysWithDates = (weekStart) =>
  WEEK_DAYS.map((day) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + (day.key - 1));
    return {
      ...day,
      dateLabel: date.toLocaleDateString("hu-HU", {
        month: "short",
        day: "numeric",
        timeZone: "Europe/Budapest",
      }),
      date,
    };
  });

const isPastDay = (date) => {
  const today = getBudapestNow();
  const midnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return date < midnight;
};

const renderDayMenu = (weekDays) => {
  if (!dayMenu) {
    return;
  }
  dayMenu.innerHTML = "";
  weekDays.forEach((day) => {
    const button = document.createElement("button");
    button.textContent = day.label;
    button.dataset.dayKey = String(day.key);
    if (isPastDay(day.date)) {
      button.classList.add("is-past");
      button.disabled = true;
    }
    button.addEventListener("click", () => {
      const target = document.getElementById(`day-${day.key}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    dayMenu.appendChild(button);
  });
};

const buildClassMap = (classes, weekStart) => {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  const classMap = new Map();
  classes.forEach((item) => {
    const date = toBudapestDate(item.startsAt);
    if (date < weekStart || date >= weekEnd) {
      return;
    }
    if (isFridayDisabledClass(item.startsAt)) {
      return;
    }
    const weekday = date.getDay();
    if (weekday < 1 || weekday > 5) {
      return;
    }
    const time = formatTimeKey(item.startsAt);
    classMap.set(`${weekday}-${time}`, item);
  });
  return classMap;
};

const buildSlot = (day, time, item) => {
  if (!item) {
    return null;
  }

  const slot = document.createElement("div");
  slot.className = "calendar-slot active";
  slot.dataset.day = day.label;
  slot.dataset.time = time;
  const timeIndex = TIME_SLOTS.indexOf(time);
  const delay = (day.key - 1) * 0.06 + Math.max(timeIndex, 0) * 0.04;
  slot.style.setProperty("--slot-delay", `${delay}s`);

  if (day.key === 5 && FRIDAY_DISABLED_SLOTS.has(time)) {
    return null;
  }

  const mySignupId = mySignupByClass.get(item.id);
  const now = getBudapestNow();
  const startsAt = toBudapestDate(item.startsAt);
  const isPast = startsAt <= now;
  const diffHours = (startsAt - now) / 3600000;
  const badges = [];
  if (diffHours > 0 && diffHours <= 2) {
    badges.push('<span class="badge badge--soon">Hamarosan indul</span>');
  }
  const names = Array.isArray(item.confirmedNames) ? item.confirmedNames : [];
  const compactNames = names.map((name) => compactSignupName(name));
  const namesText = compactNames.length
    ? compactNames.join(" • ")
    : "Nincs feliratkozó";
  const namesClass =
    compactNames.length >= 5 ? "slot-names slot-names--compact" : "slot-names";
  slot.innerHTML = `
    <div class="slot-time">${time}</div>
    ${badges.length ? `<div class="slot-badges">${badges.join("")}</div>` : ""}
    <div class="slot-meta">Feliratkozott: ${item.confirmedCount} fő</div>
    <div class="${namesClass}">${namesText}</div>
  `;

  const button = document.createElement("button");
  if (isPast) {
    button.className = "ghost";
    button.textContent = "Lejárt";
    button.disabled = true;
    slot.classList.add("slot-closed");
  } else if (mySignupId) {
    button.className = "ghost";
    button.textContent = "Időpont törlése";
    button.addEventListener("click", () => cancelSignup(mySignupId));
  } else if (item.isActive === false) {
    button.className = "ghost";
    button.textContent = "Nem elérhető";
    button.disabled = true;
    slot.classList.add("slot-closed");
  } else {
    button.className = "primary signup-button";
    button.textContent = "Feliratkozom";
    button.addEventListener("click", () => openSignup(item));
  }
  slot.appendChild(button);
  return slot;
};

const renderCalendarGrid = (classes) => {
  classList.className = "calendar";
  classList.innerHTML = "";
  const weekStart = getDisplayWeekStart();
  const weekDays = buildWeekDaysWithDates(weekStart);
  const classMap = buildClassMap(classes, weekStart);
  renderDayMenu(weekDays);
  classList.style.gridTemplateColumns = `90px repeat(${weekDays.length}, minmax(160px, 1fr))`;

  const emptyHeader = document.createElement("div");
  emptyHeader.className = "calendar-header";
  classList.appendChild(emptyHeader);

  weekDays.forEach((day) => {
    const header = document.createElement("div");
    header.className = "calendar-header";
    header.id = `day-${day.key}`;
    header.textContent = `${day.label} · ${day.dateLabel}`;
    classList.appendChild(header);
  });

  TIME_SLOTS.forEach((time) => {
    const timeCell = document.createElement("div");
    timeCell.className = "calendar-time";
    timeCell.textContent = time;
    classList.appendChild(timeCell);

    weekDays.forEach((day) => {
      const slot = buildSlot(day, time, classMap.get(`${day.key}-${time}`));
      if (slot) {
        classList.appendChild(slot);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "calendar-slot slot-hidden";
        classList.appendChild(placeholder);
      }
    });
  });
};

const renderClasses = (classes) => {
  lastClasses = classes;
  updateWeekTitle();
  renderCalendarGrid(classes);
};

const setAdminClassVisibility = (isOpen) => {
  adminClassesOpen = isOpen;
  if (adminClassList) {
    adminClassList.hidden = !isOpen;
  }
  if (adminClassToggle) {
    adminClassToggle.setAttribute("aria-expanded", String(isOpen));
    adminClassToggle.textContent = isOpen
      ? "Kártyák elrejtése"
      : "Kártyák megnyitása";
  }
};

const setAdminNotificationsVisibility = (isOpen) => {
  adminNotificationsOpen = isOpen;
  if (adminNotifications) {
    adminNotifications.hidden = !isOpen;
  }
  if (adminNotificationsToggle) {
    adminNotificationsToggle.setAttribute("aria-expanded", String(isOpen));
    adminNotificationsToggle.textContent = isOpen
      ? "Értesítések elrejtése"
      : "Értesítések megnyitása";
  }
};

const renderAdminClasses = (classes) => {
  adminClassList.innerHTML = "";
  (classes || [])
    .filter((item) => !isFridayDisabledClass(item.startsAt))
    .forEach((item) => {
      const card = document.createElement("div");
      card.className = "card";
      const signups = Array.isArray(item.signups) ? item.signups : [];
      const isFull = signups.length >= MAX_SIGNUPS;
      const statusLabel = item.isActive === false ? "Nem elérhető" : "Elérhető";
      const availabilityAction =
        item.isActive === false ? "Elérhetővé teszem" : "Nem elérhetővé teszem";
      card.innerHTML = `
      <h4>${item.title}</h4>
      <div class="meta">
        <span>${item.coach ? `Edző: ${item.coach}` : ""}</span>
        <span>${formatDate(item.startsAt)}</span>
        <span>Max ${MAX_SIGNUPS} fő</span>
      </div>
      <div class="meta">
        <span>Státusz: ${statusLabel}</span>
        <span>${signups.length} / ${MAX_SIGNUPS} fő</span>
      </div>
      <div class="form-actions card-actions">
        <button class="ghost" data-action="toggle-availability">
          ${availabilityAction}
        </button>
      </div>
      <div class="stack">
        <strong>Feliratkozók</strong>
        <div class="stack" data-role="signup-list"></div>
      </div>
      <div class="form-actions card-actions">
        <input type="text" data-role="guest-name" placeholder="Vendég neve" />
        <input type="email" data-role="guest-email" placeholder="vendeg@email" />
        <button class="primary" data-action="add-guest">
          Vendég hozzáadása
        </button>
      </div>
      <div class="form-actions card-actions">
        <select data-role="registered-user">
          <option value="">Regisztrált tag kiválasztása</option>
        </select>
        <button class="ghost" data-action="add-registered">
          Regisztrált tag felírása
        </button>
      </div>
      <p class="helper" data-role="card-status"></p>
    `;
      const listContainer = card.querySelector('[data-role="signup-list"]');
      const statusText = card.querySelector('[data-role="card-status"]');
      const nameInput = card.querySelector('[data-role="guest-name"]');
      const emailInput = card.querySelector('[data-role="guest-email"]');
      const toggleButton = card.querySelector(
        '[data-action="toggle-availability"]',
      );
      const addGuestButton = card.querySelector('[data-action="add-guest"]');
      const registeredSelect = card.querySelector(
        '[data-role="registered-user"]',
      );
      const addRegisteredButton = card.querySelector(
        '[data-action="add-registered"]',
      );

      if (registeredSelect) {
        adminUsersCache.forEach((user) => {
          const option = document.createElement("option");
          option.value = user.email;
          option.textContent = `${user.fullName || "Nevtelen"} (${user.email})`;
          registeredSelect.appendChild(option);
        });
      }

      if (listContainer) {
        if (signups.length === 0) {
          const empty = document.createElement("div");
          empty.className = "notice";
          empty.textContent = "Még nincs feliratkozó.";
          listContainer.appendChild(empty);
        } else {
          signups.forEach((signup) => {
            const row = document.createElement("div");
            row.className = "notice";
            row.innerHTML = `
            <strong>${signup.name}</strong> (${signup.email})
          `;
            const removeButton = document.createElement("button");
            removeButton.className = "ghost";
            removeButton.textContent = "Törlés";
            removeButton.addEventListener("click", () =>
              cancelAdminSignup(signup.id, statusText),
            );
            row.appendChild(removeButton);
            listContainer.appendChild(row);
          });
        }
      }

      toggleButton?.addEventListener("click", () =>
        toggleClassAvailability(item.id, item.isActive === false, statusText),
      );

      addGuestButton?.addEventListener("click", () => {
        if (isFull) {
          setCardStatus(statusText, "Az óra betelt (max 6 fő).");
          return;
        }
        const name = nameInput ? nameInput.value.trim() : "";
        const email = emailInput ? emailInput.value.trim() : "";
        addGuestToClass(
          item.id,
          name,
          email,
          signups,
          statusText,
          nameInput,
          emailInput,
        );
      });

      addRegisteredButton?.addEventListener("click", () => {
        if (isFull) {
          setCardStatus(statusText, "Az óra betelt (max 6 fő).");
          return;
        }
        const userEmail = registeredSelect ? registeredSelect.value.trim() : "";
        addRegisteredUserToClass(item.id, userEmail, statusText);
      });

      if (addGuestButton) {
        addGuestButton.disabled = isFull;
      }
      if (addRegisteredButton) {
        addRegisteredButton.disabled = isFull;
      }
      adminClassList.appendChild(card);
    });
};

const setCardStatus = (element, message) => {
  if (element) {
    element.textContent = message;
  }
};

const cancelAdminSignup = async (id, statusElement) => {
  const confirmed = window.confirm("Biztosan törlöd ezt a feliratkozást?");
  if (!confirmed) {
    return;
  }
  const response = await apiFetch(`/api/admin/signups/${id}/cancel`, {
    method: "POST",
  });
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    setCardStatus(statusElement, err.error || "Nem sikerült törölni.");
    return;
  }
  setCardStatus(statusElement, "Feliratkozás törölve.");
  await loadAdminData();
  await loadClasses();
};

const addGuestToClass = async (
  classId,
  name,
  email,
  signups,
  statusElement,
  nameInput,
  emailInput,
) => {
  if (!name || !email) {
    setCardStatus(statusElement, "Név és email kötelező.");
    return;
  }
  const normalizedEmail = email.toLowerCase();
  if (
    Array.isArray(signups) &&
    signups.some(
      (signup) => String(signup.email).toLowerCase() === normalizedEmail,
    )
  ) {
    setCardStatus(statusElement, "Ez az email már fel van iratkozva.");
    return;
  }
  const response = await apiFetch(`/api/admin/classes/${classId}/signups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email }),
  });
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    setCardStatus(statusElement, err.error || "Nem sikerült menteni.");
    return;
  }
  if (nameInput) {
    nameInput.value = "";
  }
  if (emailInput) {
    emailInput.value = "";
  }
  setCardStatus(statusElement, "Vendég felírva.");
  await loadAdminData();
  await loadClasses();
};

const addRegisteredUserToClass = async (classId, userEmail, statusElement) => {
  if (!userEmail) {
    setCardStatus(statusElement, "Válassz regisztrált tagot.");
    return;
  }
  const response = await apiFetch(`/api/admin/classes/${classId}/signups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userEmail }),
  });
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    setCardStatus(statusElement, err.error || "Nem sikerült menteni.");
    return;
  }
  setCardStatus(statusElement, "Regisztrált tag felírva.");
  await loadAdminData();
  await loadClasses();
};

const toggleClassAvailability = async (classId, isActive, statusElement) => {
  const response = await apiFetch(
    `/api/admin/classes/${classId}/availability`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    },
  );
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    setCardStatus(statusElement, err.error || "Nem sikerült frissíteni.");
    return;
  }
  setCardStatus(
    statusElement,
    isActive ? "Óra elérhetővé téve." : "Óra nem elérhető.",
  );
  await loadAdminData();
  await loadClasses();
};

const renderNotifications = (notifications) => {
  adminNotifications.innerHTML = "";
  if (notifications.length === 0) {
    adminNotifications.innerHTML =
      '<div class="notice">Nincs új értesítés.</div>';
    return;
  }
  notifications.forEach((item) => {
    const row = document.createElement("div");
    row.className = "notice";
    row.textContent = `${formatDate(item.created_at)} - ${item.message}`;
    adminNotifications.appendChild(row);
  });
};

const renderPass = (data) => {
  if (!passSummary || !passUses) {
    return;
  }
  passSummary.innerHTML = "";
  passUses.innerHTML = "";
  if (!data || !data.pass) {
    passSummary.innerHTML = '<div class="notice">Nincs aktív bérleted.</div>';
    return;
  }
  const createdAt = new Date(data.pass.createdAt);
  const createdLabel = createdAt.toLocaleDateString("hu-HU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const purchased = Number(data.pass.total) || 0;
  const used = Array.isArray(data.uses) ? data.uses.length : 0;
  passSummary.innerHTML = `
    <div class="notice">
      <strong>Aktív bérlet</strong><br />
      Vásárlás dátuma: ${createdLabel}<br />
      Vásárolt: ${purchased} | Felhasznált: ${used}
    </div>
  `;
  if (!data.uses || data.uses.length === 0) {
    passUses.innerHTML = '<div class="notice">Még nincs levont alkalom.</div>';
    return;
  }
  const table = document.createElement("table");
  table.className = "pass-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Edzés</th>
        <th>Dátum</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  data.uses.forEach((use) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${use.title}</td>
      <td>${formatDate(use.startsAt)}</td>
    `;
    tbody.appendChild(row);
  });
  passUses.appendChild(table);
};

const loadPass = async () => {
  if (!currentUser) {
    renderPass(null);
    return;
  }
  const response = await apiFetch("/api/passes/me");
  if (!response.ok) {
    renderPass(null);
    return;
  }
  const data = await response.json();
  renderPass(data);
};

const renderMySignups = (signups) => {
  if (!mySignups || !mySignupsList) {
    return;
  }
  mySignupsList.innerHTML = "";
  mySignupByClass = new Map();
  mySignupsCache = signups;
  if (!currentUser || signups.length === 0) {
    mySignups.hidden = true;
    return;
  }
  mySignups.hidden = false;
  const now = new Date();
  signups.forEach((item) => {
    if (item.status === "confirmed") {
      mySignupByClass.set(item.classId, item.id);
    }
    const row = document.createElement("div");
    row.className = "notice signups-row";
    row.innerHTML = `
      <strong>${item.title}</strong><br />
      ${formatDate(item.startsAt)}
    `;
    if (item.canCancel) {
      const cancelButton = document.createElement("button");
      cancelButton.className = "ghost";
      cancelButton.textContent = "Időpont törlése";
      cancelButton.addEventListener("click", () => cancelSignup(item.id));
      row.appendChild(document.createElement("br"));
      row.appendChild(cancelButton);
    }
    if (item.status === "confirmed" && new Date(item.startsAt) > now) {
      const calendarButton = document.createElement("a");
      calendarButton.className = "ghost";
      calendarButton.href = `/api/signups/${item.id}/calendar.ics`;
      calendarButton.textContent = "Naptárba fájl letöltése";
      calendarButton.setAttribute("download", `edzes-${item.id}.ics`);
      row.appendChild(document.createElement("br"));
      row.appendChild(calendarButton);
    }
    mySignupsList.appendChild(row);
  });
};

const renderSignupsMenu = () => {
  if (!signupsList) {
    return;
  }
  signupsList.innerHTML = "";
  if (!currentUser) {
    signupsList.innerHTML =
      '<div class="notice">Jelentkezz be a feliratkozások megtekintéséhez.</div>';
    return;
  }
  if (mySignupsCache.length === 0) {
    signupsList.innerHTML = '<div class="notice">Nincs feliratkozásod.</div>';
    return;
  }
  const now = new Date();
  mySignupsCache.forEach((item) => {
    const row = document.createElement("div");
    row.className = "notice signups-row";
    row.innerHTML = `
      <strong>${item.title}</strong><br />
      ${formatDate(item.startsAt)}
    `;
    if (item.canCancel) {
      const cancelButton = document.createElement("button");
      cancelButton.className = "ghost";
      cancelButton.textContent = "Időpont törlése";
      cancelButton.addEventListener("click", () => cancelSignup(item.id));
      row.appendChild(document.createElement("br"));
      row.appendChild(cancelButton);
    }
    if (item.status === "confirmed" && new Date(item.startsAt) > now) {
      const calendarButton = document.createElement("a");
      calendarButton.className = "ghost";
      calendarButton.href = `/api/signups/${item.id}/calendar.ics`;
      calendarButton.textContent = "Naptárba fájl letöltése";
      calendarButton.setAttribute("download", `edzes-${item.id}.ics`);
      row.appendChild(document.createElement("br"));
      row.appendChild(calendarButton);
    }
    signupsList.appendChild(row);
  });
};

const openSignup = (item) => {
  pendingSignupItem = item;
  if (!currentUser) {
    signupMessage.textContent = "";
    if (mySignups) {
      mySignups.hidden = true;
    }
    setAuthMode("login");
    userLoginMessage.textContent = "Feliratkozáshoz jelentkezz be.";
    openModal(userModal);
    return;
  }
  signupClassId.value = item.id;
  signupMessage.textContent = "";
  if (currentUser) {
    signupName.value = currentUser.fullName || currentUser.name || "";
    signupEmail.value = currentUser.email;
    signupLoginState.textContent =
      "Bejelentkezve. A feliratkozás automatikusan elfogadott.";
  } else {
    signupName.value = "";
    signupEmail.value = "";
    signupLoginState.textContent = "Feliratkozáshoz be kell jelentkezned.";
    if (mySignups) {
      mySignups.hidden = true;
    }
  }
  openModal(signupModal);
  loadMySignups();
};

const loadClasses = async () => {
  const response = await apiFetch("/api/classes");
  const data = await response.json();
  renderClasses(data);
};

const loadMySignups = async () => {
  if (!currentUser) {
    renderMySignups([]);
    renderSignupsMenu();
    renderClasses(lastClasses);
    return;
  }
  const response = await apiFetch("/api/signups/me");
  if (!response.ok) {
    renderMySignups([]);
    renderSignupsMenu();
    renderClasses(lastClasses);
    return;
  }
  const data = await response.json();
  renderMySignups(data);
  renderSignupsMenu();
  renderClasses(lastClasses);
};

const loadAdminData = async () => {
  const [classesResponse, notificationsResponse, usersResponse] =
    await Promise.all([
      apiFetch("/api/admin/classes"),
      apiFetch("/api/admin/notifications"),
      apiFetch("/api/admin/users/with-pass"),
    ]);

  if (classesResponse.status === 401) {
    adminPanel.hidden = true;
    adminLoginForm.parentElement.hidden = false;
    if (adminPill) {
      adminPill.hidden = true;
    }
    return;
  }

  const classes = await classesResponse.json();
  const notifications = await notificationsResponse.json();
  const users = await usersResponse.json();
  adminClassesCache = classes;
  adminUsersCache = Array.isArray(users) ? users : [];
  renderAdminClasses(filterClassesToDisplayWeek(classes));
  setAdminClassVisibility(adminClassesOpen);
  renderNotifications(notifications);
  setAdminNotificationsVisibility(adminNotificationsOpen);
  renderAdminUsersPass(users);
  adminPanel.hidden = false;
  adminLoginForm.parentElement.hidden = true;
  if (adminPill) {
    adminPill.hidden = false;
  }
};

const updatePassClassOptions = () => {
  // No longer needed - using direct number input
};

const renderAdminPass = (data) => {
  if (!passUsesAdmin || !passTotalInput || !passRemainingInput) {
    return;
  }
  passUsesAdmin.innerHTML = "";
  if (!data || !data.pass) {
    passTotalInput.value = "";
    passRemainingInput.value = "";
    passUsesAdmin.innerHTML = '<div class="notice">Nincs aktív bérlet.</div>';
    return;
  }
  passTotalInput.value = String(data.pass.total);
  // Use actual pass_uses count instead of derived remaining to stay in sync
  const actualUsed = Array.isArray(data.uses) ? data.uses.length : 0;
  passRemainingInput.value = String(actualUsed);
  if (!data.uses || data.uses.length === 0) {
    passUsesAdmin.innerHTML =
      '<div class="notice">Nincs még levont alkalom.</div>';
    return;
  }
  data.uses.forEach((use) => {
    const row = document.createElement("div");
    row.className = "notice";
    row.innerHTML = `
      <strong>${use.title}</strong><br />
      ${formatDate(use.startsAt)}
    `;
    const removeButton = document.createElement("button");
    removeButton.className = "ghost";
    removeButton.textContent = "Alkalom törlése";
    removeButton.addEventListener("click", () => deletePassUse(use.id));
    row.appendChild(removeButton);
    passUsesAdmin.appendChild(row);
  });
};

const renderAdminUsersPass = (users) => {
  if (!adminUsersPass) {
    return;
  }
  adminUsersPass.innerHTML = "";
  if (!users || users.length === 0) {
    adminUsersPass.innerHTML =
      '<div class="notice">Még nincs regisztrált tag.</div>';
    return;
  }
  const table = document.createElement("table");
  table.className = "pass-table admin-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Név</th>
        <th>Email</th>
        <th>Születési dátum</th>
        <th>Telefonszám</th>
        <th>Bérlet</th>
        <th>Regisztráció</th>
        <th>Művelet</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  users.forEach((user) => {
    const createdLabel = user.createdAt
      ? new Date(user.createdAt).toLocaleDateString("hu-HU", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "-";
    const passLabel =
      user.passTotal != null && user.passRemaining != null
        ? `Vásárolt: ${user.passTotal} | Felhasznált: ${user.passUsed != null ? Number(user.passUsed) : Math.max(0, Number(user.passTotal) - Number(user.passRemaining))}`
        : "Nincs bérlet";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="text" data-role="full-name" /></td>
      <td><input type="email" data-role="email" /></td>
      <td><input type="text" data-role="birth-date" placeholder="YYYY-MM-DD" /></td>
      <td><input type="tel" data-role="phone" /></td>
      <td>${passLabel}</td>
      <td>${createdLabel}</td>
      <td class="form-actions">
        <button class="primary" data-action="save-user">Mentés</button>
        <button class="ghost" data-action="delete-user">Törlés</button>
      </td>
    `;
    const fullNameInput = row.querySelector('[data-role="full-name"]');
    const emailInput = row.querySelector('[data-role="email"]');
    const birthDateInput = row.querySelector('[data-role="birth-date"]');
    const phoneInput = row.querySelector('[data-role="phone"]');
    const saveButton = row.querySelector('[data-action="save-user"]');
    const deleteButton = row.querySelector('[data-action="delete-user"]');

    if (fullNameInput) {
      fullNameInput.value = user.fullName || "";
    }
    if (emailInput) {
      emailInput.value = user.email || "";
    }
    if (birthDateInput) {
      birthDateInput.value = user.birthDate || "";
    }
    if (phoneInput) {
      phoneInput.value = user.phone || "";
    }

    saveButton?.addEventListener("click", () => {
      updateAdminUser(user.email, {
        fullName: fullNameInput ? fullNameInput.value.trim() : "",
        email: emailInput ? emailInput.value.trim() : "",
        birthDate: birthDateInput ? birthDateInput.value.trim() : "",
        phone: phoneInput ? phoneInput.value.trim() : "",
      });
    });

    deleteButton?.addEventListener("click", () => {
      deleteAdminUser(user.email);
    });
    tbody.appendChild(row);
  });
  adminUsersPass.appendChild(table);
};

const updateAdminUser = async (currentEmail, payload) => {
  const response = await apiFetch(
    `/api/admin/users/${encodeURIComponent(currentEmail)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (classMessage) {
      classMessage.textContent =
        err.error || "Nem sikerült menteni a tag adatait.";
    }
    return;
  }
  if (classMessage) {
    classMessage.textContent = "Tag adatai frissítve.";
  }
  await loadAdminData();
  await loadClasses();
};

const deleteAdminUser = async (email) => {
  const confirmed = window.confirm(
    `Biztosan törlöd ezt a regisztrált tagot? (${email})`,
  );
  if (!confirmed) {
    return;
  }
  const response = await apiFetch(
    `/api/admin/users/${encodeURIComponent(email)}`,
    {
      method: "DELETE",
    },
  );
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (classMessage) {
      classMessage.textContent = err.error || "Nem sikerült törölni a tagot.";
    }
    return;
  }
  if (classMessage) {
    classMessage.textContent = "Tag törölve.";
  }
  await loadAdminData();
  await loadClasses();
};

const loadAdminPass = async () => {
  if (!passAdminEmail || !passAdminStatus) {
    return;
  }
  const email = passAdminEmail.value.trim();
  if (!email) {
    passAdminStatus.textContent = "Email megadása kötelező.";
    return;
  }
  passAdminStatus.textContent = "";
  const response = await apiFetch(
    `/api/admin/passes/${encodeURIComponent(email)}`,
  );
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    passAdminStatus.textContent = err.error || "Nem sikerült betölteni.";
    return;
  }
  const data = await response.json();
  renderAdminPass(data);
};

const saveAdminPass = async () => {
  if (!passAdminEmail || !passTotalInput || !passRemainingInput) {
    return;
  }
  const email = passAdminEmail.value.trim();
  if (!email) {
    passAdminStatus.textContent = "Email megadása kötelező.";
    return;
  }
  const total = passTotalInput.value;
  const used = passRemainingInput.value;
  const remaining = String(Math.max(0, Number(total) - Number(used)));
  const response = await apiFetch("/api/admin/passes/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, total, remaining }),
  });
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    passAdminStatus.textContent = err.error || "Nem sikerült menteni.";
    return;
  }
  passAdminStatus.textContent = "Bérlet frissítve.";
  await loadAdminPass();
};

const addPassUse = async () => {
  if (!passAdminEmail) {
    return;
  }
  const email = passAdminEmail.value.trim();
  if (!email) {
    passAdminStatus.textContent = "Email kötelező.";
    return;
  }

  let usedAt = null;
  if (passUseDate.value) {
    const dateObj = new Date(passUseDate.value);
    usedAt = dateObj.toISOString();
  }

  const body = { email };
  if (usedAt) {
    body.used_at = usedAt;
  }

  try {
    const response = await apiFetch("/api/admin/passes/use", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const responseData = await response.json();
    console.log("Add pass use response:", response.status, responseData);

    if (handleAdminUnauthorized(response)) {
      return;
    }
    if (!response.ok) {
      passAdminStatus.textContent =
        responseData.error || "Nem sikerült menteni.";
      return;
    }
    passAdminStatus.textContent = "Alkalom hozzáadva.";
    if (passUseDate) {
      passUseDate.value = "";
    }
    await loadAdminPass();
  } catch (err) {
    console.error("Error adding pass use:", err);
    passAdminStatus.textContent = "Hiba történt: " + err.message;
  }
};

const deletePassUse = async (useId) => {
  const response = await apiFetch(`/api/admin/passes/use/${useId}`, {
    method: "DELETE",
  });
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    passAdminStatus.textContent = err.error || "Nem sikerült törölni.";
    return;
  }
  passAdminStatus.textContent = "Alkalom törölve.";
  await loadAdminPass();
};

const handleAdminUnauthorized = (response) => {
  if (response.status === 401) {
    adminPanel.hidden = true;
    adminLoginForm.parentElement.hidden = false;
    if (classMessage) {
      classMessage.textContent = "Lejárt a belépés. Jelentkezz be újra.";
    }
    if (adminPill) {
      adminPill.hidden = true;
    }
    return true;
  }
  return false;
};

const loadUser = async () => {
  try {
    const response = await apiFetch("/api/auth/me");
    if (!response.ok) {
      currentUser = null;
      updateUserUI();
      renderMySignups([]);
      renderSignupsMenu();
      return;
    }
    const data = await response.json();
    currentUser = data.user;
    updateUserUI();
    await loadMySignups();
  } catch (err) {
    currentUser = null;
    updateUserUI();
    renderMySignups([]);
    renderSignupsMenu();
  }
};

const updateUserUI = () => {
  if (currentUser) {
    userPill.hidden = false;
    userPill.textContent = `Bejelentkezve: ${currentUser.fullName || currentUser.name || currentUser.email}`;
    userPill.classList.add("is-logged-in");
    openUser.textContent = "Kijelentkezés";
    if (openSignups) {
      openSignups.hidden = false;
    }
    if (openPass) {
      openPass.hidden = false;
    }
  } else {
    userPill.hidden = true;
    userPill.textContent = "";
    userPill.classList.remove("is-logged-in");
    openUser.textContent = "Bejelentkezés";
    if (openSignups) {
      openSignups.hidden = true;
    }
    if (openPass) {
      openPass.hidden = true;
    }
  }
  signupName.disabled = true;
  signupEmail.disabled = true;
  signupLoginButton.hidden = !!currentUser;
  if (!currentUser) {
    renderCalendarSync(null);
  }
};

const setAuthMode = (mode) => {
  authMode = mode;
  if (authLoginButton && authRegisterButton && userModal) {
    authLoginButton.classList.toggle("is-active", mode === "login");
    authRegisterButton.classList.toggle("is-active", mode === "register");
    userModal.classList.toggle("is-register", mode === "register");
  }
  if (authSubmitButton) {
    authSubmitButton.textContent =
      mode === "register" ? "Regisztrálok" : "Belépek";
  }
  if (userFullName) {
    userFullName.required = mode === "register";
  }
  if (userPassword) {
    userPassword.required = true;
  }
  if (userBirthDate) {
    userBirthDate.required = mode === "register";
  }
  if (userConsent) {
    userConsent.required = mode === "register";
  }
  if (userPhone) {
    userPhone.required = mode === "register";
    if (mode === "register" && userPhone.value.trim() === "") {
      userPhone.value = "+36";
    }
  }
};

const cancelSignup = async (id) => {
  const response = await apiFetch(`/api/signups/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    signupMessage.textContent = "Nem sikerült törölni az időpontot.";
    return;
  }
  closeModal(signupModal);
  await loadMySignups();
  await loadClasses();
};

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  signupMessage.textContent = "";
  if (!currentUser) {
    signupMessage.textContent = "Előbb jelentkezz be.";
    setAuthMode("login");
    userLoginMessage.textContent = "Feliratkozáshoz jelentkezz be.";
    openModal(userModal);
    return;
  }
  const classId = signupClassId.value;
  if (mySignupByClass.has(Number(classId))) {
    signupMessage.textContent = "Erre az órára már fel vagy iratkozva.";
    return;
  }
  const response = await apiFetch(`/api/classes/${classId}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const err = await response.json();
    signupMessage.textContent = err.error || "Hiba történt.";
    return;
  }

  const data = await response.json();
  signupMessage.textContent = "Sikeres feliratkozás!";
  await loadClasses();
  await loadMySignups();
  pendingSignupItem = null;
  setTimeout(() => closeModal(signupModal), 2500);
  console.log("Signup", data.status);
});

userLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  userLoginMessage.textContent = "";
  const emailValue = document.getElementById("user-email").value.trim();
  const passwordValue = userPassword ? userPassword.value : "";
  let response;
  if (authMode === "register") {
    response = await apiFetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: userFullName ? userFullName.value.trim() : "",
        email: emailValue,
        password: passwordValue,
        birthDate: userBirthDate ? normalizeBirthDate(userBirthDate.value) : "",
        phone: userPhone ? userPhone.value.trim() : "",
        consentText: consentText ? consentText.innerText : "",
        consentAccepted: userConsent ? userConsent.checked : false,
      }),
    });
  } else {
    response = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailValue, password: passwordValue }),
    });
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    userLoginMessage.textContent = err.error || "Sikertelen művelet.";
    return;
  }

  const data = await response.json();
  currentUser = data.user;
  updateUserUI();
  await loadCalendarSyncStatus();
  userLoginMessage.textContent =
    authMode === "register" ? "Sikeres regisztráció." : "Sikeres belépés.";
  closeModal(userModal);
  await loadMySignups();
  if (pendingSignupItem) {
    openSignup(pendingSignupItem);
  }
});

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminLoginMessage.textContent = "";
  const response = await apiFetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: document.getElementById("admin-email").value,
      password: document.getElementById("admin-password").value,
    }),
  });

  if (!response.ok) {
    adminLoginMessage.textContent = "Hibás belépés.";
    return;
  }

  adminLoginMessage.textContent = "Sikeres belépés.";
  await loadAdminData();
  if (adminPill) {
    adminPill.hidden = false;
  }
});

adminLogout.addEventListener("click", async () => {
  await apiFetch("/api/admin/logout", { method: "POST" });
  adminPanel.hidden = true;
  adminLoginForm.parentElement.hidden = false;
  if (adminPill) {
    adminPill.hidden = true;
  }
});

regenerateClassesButton?.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Biztosan újragenerálod a heti órákat? A bérlet és a meglévő feliratkozások dátumai megmaradnak, csak az üres jövőbeli órák frissülnek.",
  );
  if (!confirmed) {
    return;
  }
  const response = await apiFetch("/api/admin/classes/regenerate", {
    method: "POST",
  });
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    classMessage.textContent = "Nem sikerült újragenerálni.";
    return;
  }
  classMessage.textContent = "Heti órák újragenerálva.";
  await loadAdminData();
  await loadClasses();
});

loadPassAdminButton?.addEventListener("click", () => {
  loadAdminPass();
});

assignPassButton?.addEventListener("click", async () => {
  if (!passAdminEmail || !passAdminStatus) {
    return;
  }
  passAdminStatus.textContent = "";
  const email = passAdminEmail.value.trim();
  if (!email) {
    passAdminStatus.textContent = "Email megadása kötelező.";
    return;
  }
  const response = await apiFetch("/api/admin/passes/assign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    passAdminStatus.textContent =
      err.error || "Nem sikerült a bérletet rögzíteni.";
    return;
  }
  passAdminStatus.textContent = "Bérlet rögzítve.";
  passTotalInput.value = "10";
  passRemainingInput.value = "0";
  await loadAdminPass();
});

savePassAdminButton?.addEventListener("click", () => {
  saveAdminPass();
});

addPassUseButton?.addEventListener("click", () => {
  addPassUse();
});

openUser.addEventListener("click", async () => {
  if (currentUser) {
    // Ha be van jelentkezve, csak nyissuk meg a user modalt, NE léptessük ki!
    openModal(userModal);
    return;
  }
  setAuthMode("login");
  openModal(userModal);
  if (userPhone) {
    userPhone.value = normalizePhone(userPhone.value);
  }
});

openSignups?.addEventListener("click", () => {
  renderSignupsMenu();
  renderCalendarSync();
  openModal(signupsModal);
});

openPass?.addEventListener("click", async () => {
  await loadPass();
  openModal(passModal);
});

signupLoginButton.addEventListener("click", () => {
  closeModal(signupModal);
  setAuthMode("login");
  openModal(userModal);
});

openAdmin?.addEventListener("click", () => {
  openAdminLogin();
});

window.addEventListener("hashchange", () => {
  if (shouldOpenAdminFromUrl()) {
    openAdminLogin();
  }
});

adminClassToggle?.addEventListener("click", () => {
  setAdminClassVisibility(!adminClassesOpen);
});

adminNotificationsToggle?.addEventListener("click", () => {
  setAdminNotificationsVisibility(!adminNotificationsOpen);
});

enablePushButton?.addEventListener("click", () => {
  subscribeToPush().catch(() => {
    if (pushStatus) {
      pushStatus.textContent = "Hiba történt az értesítés beállításakor.";
    }
  });
});

testTelegramButton?.addEventListener("click", async () => {
  if (!telegramStatus) {
    return;
  }
  telegramStatus.textContent = "Küldöm a teszt üzenetet...";
  const response = await apiFetch("/api/admin/telegram/test", {
    method: "POST",
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    telegramStatus.textContent = err.error || "Nem sikerült a Telegram teszt.";
    return;
  }
  telegramStatus.textContent = "Telegram teszt elküldve.";
});

closeSignup.addEventListener("click", () => closeModal(signupModal));
closeUser.addEventListener("click", () => closeModal(userModal));
closeAdmin.addEventListener("click", () => closeModal(adminModal));
closeSignups?.addEventListener("click", () => closeModal(signupsModal));
closePass?.addEventListener("click", () => closeModal(passModal));

authLoginButton?.addEventListener("click", () => setAuthMode("login"));
authRegisterButton?.addEventListener("click", () => setAuthMode("register"));

signupsModal?.addEventListener("click", (event) => {
  if (event.target === signupsModal) {
    closeModal(signupsModal);
  }
});

passModal?.addEventListener("click", (event) => {
  if (event.target === passModal) {
    closeModal(passModal);
  }
});

assignPassButton?.addEventListener("click", async () => {
  if (!passEmailInput || !passAdminStatus) {
    return;
  }
  passAdminStatus.textContent = "";
  const email = passEmailInput.value.trim();
  if (!email) {
    passAdminStatus.textContent = "Email megadása kötelező.";
    return;
  }
  const response = await apiFetch("/api/admin/passes/assign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    passAdminStatus.textContent =
      err.error || "Nem sikerült a bérletet rögzíteni.";
    return;
  }
  passAdminStatus.textContent = "Bérlet rögzítve.";
  passEmailInput.value = "";
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }
  [signupModal, userModal, adminModal, signupsModal].forEach((modal) => {
    if (modal && modal.classList.contains("show")) {
      closeModal(modal);
    }
  });
});

window.addEventListener("DOMContentLoaded", () => {
  loadClasses();
  loadUser();
  setAuthMode("login");
  setAdminClassVisibility(false);
  setAdminNotificationsVisibility(false);
  scheduleWeekRefresh();
  if (userPhone) {
    userPhone.value = normalizePhone(userPhone.value);
  }
  if (shouldOpenAdminFromUrl()) {
    openAdminLogin();
  }
});

userPhone?.addEventListener("input", () => {
  const normalized = normalizePhone(userPhone.value);
  if (userPhone.value !== normalized) {
    userPhone.value = normalized;
  }
});

userBirthDate?.addEventListener("input", () => {
  const normalized = normalizeBirthDate(userBirthDate.value);
  if (userBirthDate.value !== normalized) {
    userBirthDate.value = normalized;
  }
});

window.addEventListener("resize", () => {
  const currentWidth = window.innerWidth;
  const widthDelta = Math.abs(currentWidth - lastViewportWidth);
  const crossedBreakpoint =
    (lastViewportWidth <= 720 && currentWidth > 720) ||
    (lastViewportWidth > 720 && currentWidth <= 720);
  if (widthDelta < 30 && !crossedBreakpoint) {
    return;
  }
  lastViewportWidth = currentWidth;
  if (lastClasses.length > 0) {
    renderClasses(lastClasses);
  }
});

window.addEventListener("scroll", () => {
  if (!scrollTopButton) {
    return;
  }
  const shouldShow = window.scrollY > 180;
  scrollTopButton.hidden = !shouldShow;
  scrollTopButton.classList.toggle("is-visible", shouldShow);
});

scrollTopButton?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

const scheduleWeekRefresh = () => {
  const now = getBudapestNow();
  const target = new Date(now);
  const day = now.getDay();
  const diffToFriday = day <= 5 ? 5 - day : 12 - day;
  target.setDate(now.getDate() + diffToFriday);
  target.setHours(12, 0, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 7);
  }
  const delay = target.getTime() - now.getTime();
  setTimeout(async () => {
    await loadClasses();
    await loadAdminData();
    scheduleWeekRefresh();
  }, delay);
};
