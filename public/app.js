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
const classForm = document.getElementById("class-form");
const classMessage = document.getElementById("class-message");
const classIdInput = document.getElementById("class-id");
const classTitleInput = document.getElementById("class-title");
const classCoachInput = document.getElementById("class-coach");
const classStartsInput = document.getElementById("class-starts");
const classCapacityInput = document.getElementById("class-capacity");
const classNotesInput = document.getElementById("class-notes");
const classResetButton = document.getElementById("reset-class");
const adminClassList = document.getElementById("admin-class-list");
const adminClassToggle = document.getElementById("admin-class-toggle");
const adminSignups = document.getElementById("admin-signups");
const adminNotifications = document.getElementById("admin-notifications");
const adminUsers = document.getElementById("admin-users");
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
const passClassSelect = document.getElementById("pass-class-select");
const addPassUseButton = document.getElementById("add-pass-use");
const passUsesAdmin = document.getElementById("pass-uses-admin");
const passAdminStatus = document.getElementById("pass-admin-status");
const availabilityClassSelect = document.getElementById("availability-class");
const setUnavailableButton = document.getElementById("set-unavailable");
const setAvailableButton = document.getElementById("set-available");
const availabilityStatus = document.getElementById("availability-status");

let currentUser = null;
let lastClasses = [];
let pendingSignupItem = null;
let mySignupByClass = new Map();
let mySignupsCache = [];
let authMode = "login";
let lastViewportWidth = window.innerWidth;
let adminClassesCache = [];
let adminClassesOpen = false;

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

const FRIDAY_AFTERNOON = new Set(["16:00", "17:00", "18:00", "19:00"]);

const formatDate = (iso) => {
  const date = new Date(iso);
  return date.toLocaleString("hu-HU", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

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
  const keyResponse = await fetch("/api/push/vapid-public-key", {
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
  const saveResponse = await fetch("/api/push/subscribe", {
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
      }),
      date,
    };
  });

const isPastDay = (date) => {
  const today = new Date();
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
  const now = new Date();
  const classMap = new Map();
  classes.forEach((item) => {
    const date = new Date(item.startsAt);
    if (date < weekStart || date >= weekEnd) {
      return;
    }
    if (date <= now) {
      return;
    }
    const weekday = date.getDay();
    if (weekday < 1 || weekday > 5) {
      return;
    }
    const time = date.toLocaleTimeString("hu-HU", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
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

  if (day.key === 5 && FRIDAY_AFTERNOON.has(time)) {
    return null;
  }

  const mySignupId = mySignupByClass.get(item.id);
  const now = new Date();
  const startsAt = new Date(item.startsAt);
  const diffHours = (startsAt - now) / 3600000;
  const badges = [];
  if (diffHours > 0 && diffHours <= 2) {
    badges.push('<span class="badge badge--soon">Hamarosan indul</span>');
  }
  const names = Array.isArray(item.confirmedNames) ? item.confirmedNames : [];
  const namesText = names.length ? names.join(", ") : "Nincs feliratkozó";
  slot.innerHTML = `
    <div class="slot-time">${time}</div>
    ${badges.length ? `<div class="slot-badges">${badges.join("")}</div>` : ""}
    <div class="slot-meta">Feliratkozott: ${item.confirmedCount} fő</div>
    <div class="slot-names">${namesText}</div>
  `;

  const button = document.createElement("button");
  if (mySignupId) {
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

const renderAdminClasses = (classes) => {
  adminClassList.innerHTML = "";
  classes.forEach((item) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h4>${item.title}</h4>
      <div class="meta">
        <span>${item.coach ? `Edző: ${item.coach}` : ""}</span>
        <span>${formatDate(item.startsAt)}</span>
        <span>Max ${item.capacity} fő</span>
      </div>
      <button class="ghost" data-action="edit">Szerkesztem</button>
      <button class="ghost" data-action="delete">Törlés</button>
    `;
    const [editButton, deleteButton] = card.querySelectorAll("button");
    editButton.addEventListener("click", () => fillClassForm(item));
    deleteButton.addEventListener("click", () => deleteClass(item.id));
    adminClassList.appendChild(card);
  });
};

const renderSignups = (signups) => {
  adminSignups.innerHTML = "";
  signups.forEach((item) => {
    const row = document.createElement("div");
    row.className = "notice";
    row.innerHTML = `
      <strong>${item.name}</strong> (${item.email})<br />
      ${item.classTitle} - ${formatDate(item.classStartsAt)}<br />
      Állapot: ${item.status}
    `;
    adminSignups.appendChild(row);
  });
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

const renderAdminUsers = (users) => {
  if (!adminUsers) {
    return;
  }
  adminUsers.innerHTML = "";
  if (!users || users.length === 0) {
    adminUsers.innerHTML =
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
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${user.fullName || "-"}</td>
      <td>${user.email || "-"}</td>
      <td>${user.birthDate || "-"}</td>
      <td>${user.phone || "-"}</td>
      <td>${createdLabel}</td>
      <td><button class="ghost" data-email="${user.email || ""}">Törlés</button></td>
    `;
    const deleteButton = row.querySelector("button");
    deleteButton?.addEventListener("click", () => {
      deleteAdminUser(user.email);
    });
    tbody.appendChild(row);
  });
  adminUsers.appendChild(table);
};

const deleteAdminUser = async (email) => {
  if (!email) {
    return;
  }
  const confirmed = window.confirm(
    "Biztosan törlöd a tagot és az összes kapcsolódó adatát?",
  );
  if (!confirmed) {
    return;
  }
  const response = await fetch(
    `/api/admin/users/${encodeURIComponent(email)}`,
    { method: "DELETE" },
  );
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    window.alert(err.error || "Nem sikerult torolni a tagot.");
    return;
  }
  await loadAdminData();
};

const renderPass = (data) => {
  if (!passSummary || !passUses) {
    return;
  }
  passSummary.innerHTML = "";
  passUses.innerHTML = "";
  if (!data || !data.pass) {
    passSummary.innerHTML = '<div class="notice">Nincs aktiv bérleted.</div>';
    return;
  }
  const createdAt = new Date(data.pass.createdAt);
  const createdLabel = createdAt.toLocaleDateString("hu-HU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  passSummary.innerHTML = `
    <div class="notice">
      <strong>Aktiv berlet</strong><br />
      Vasarlas datuma: ${createdLabel}<br />
      Maradek: ${data.pass.remaining} / ${data.pass.total}
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
        <th>Edzes</th>
        <th>Datum</th>
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
  const response = await fetch("/api/passes/me");
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
  const response = await fetch("/api/classes");
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
  const response = await fetch("/api/signups/me");
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
  const [
    classesResponse,
    signupsResponse,
    notificationsResponse,
    usersResponse,
  ] = await Promise.all([
    fetch("/api/admin/classes"),
    fetch("/api/admin/signups"),
    fetch("/api/admin/notifications"),
    fetch("/api/admin/users"),
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
  const signups = await signupsResponse.json();
  const notifications = await notificationsResponse.json();
  const users = await usersResponse.json();
  adminClassesCache = classes;
  updatePassClassOptions();
  updateAvailabilityOptions();
  renderAdminClasses(classes);
  setAdminClassVisibility(adminClassesOpen);
  renderSignups(signups);
  renderNotifications(notifications);
  renderAdminUsers(users);
  adminPanel.hidden = false;
  adminLoginForm.parentElement.hidden = true;
  if (adminPill) {
    adminPill.hidden = false;
  }
};

const updatePassClassOptions = () => {
  if (!passClassSelect) {
    return;
  }
  passClassSelect.innerHTML = "";
  adminClassesCache.forEach((item) => {
    const option = document.createElement("option");
    option.value = String(item.id);
    option.textContent = `${item.title} - ${formatDate(item.startsAt)}`;
    passClassSelect.appendChild(option);
  });
};

const updateAvailabilityOptions = () => {
  if (!availabilityClassSelect) {
    return;
  }
  availabilityClassSelect.innerHTML = "";
  adminClassesCache.forEach((item) => {
    const option = document.createElement("option");
    const statusLabel =
      item.isActive === false ? "(nem elérhető)" : "(elérhető)";
    option.value = String(item.id);
    option.textContent = `${formatDate(item.startsAt)} ${statusLabel}`;
    availabilityClassSelect.appendChild(option);
  });
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
  passRemainingInput.value = String(data.pass.remaining);
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
    removeButton.textContent = "Alkalom torlese";
    removeButton.addEventListener("click", () => deletePassUse(use.id));
    row.appendChild(removeButton);
    passUsesAdmin.appendChild(row);
  });
};

const loadAdminPass = async () => {
  if (!passAdminEmail || !passAdminStatus) {
    return;
  }
  const email = passAdminEmail.value.trim();
  if (!email) {
    passAdminStatus.textContent = "Email megadasa kotelezo.";
    return;
  }
  passAdminStatus.textContent = "";
  const response = await fetch(
    `/api/admin/passes/${encodeURIComponent(email)}`,
  );
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    passAdminStatus.textContent = err.error || "Nem sikerult betolteni.";
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
    passAdminStatus.textContent = "Email megadasa kotelezo.";
    return;
  }
  const total = passTotalInput.value;
  const remaining = passRemainingInput.value;
  const response = await fetch("/api/admin/passes/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, total, remaining }),
  });
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    passAdminStatus.textContent = err.error || "Nem sikerult menteni.";
    return;
  }
  passAdminStatus.textContent = "Berlet frissitve.";
  await loadAdminPass();
};

const addPassUse = async () => {
  if (!passAdminEmail || !passClassSelect) {
    return;
  }
  const email = passAdminEmail.value.trim();
  const classId = passClassSelect.value;
  if (!email || !classId) {
    passAdminStatus.textContent = "Email es ora kivalasztasa kotelezo.";
    return;
  }
  const response = await fetch("/api/admin/passes/use", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, classId }),
  });
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    passAdminStatus.textContent = err.error || "Nem sikerult menteni.";
    return;
  }
  passAdminStatus.textContent = "Alkalom hozzaadva.";
  await loadAdminPass();
};

const deletePassUse = async (useId) => {
  const response = await fetch(`/api/admin/passes/use/${useId}`, {
    method: "DELETE",
  });
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    passAdminStatus.textContent = err.error || "Nem sikerult torolni.";
    return;
  }
  passAdminStatus.textContent = "Alkalom torolve.";
  await loadAdminPass();
};

const handleAdminUnauthorized = (response) => {
  if (response.status === 401) {
    adminPanel.hidden = true;
    adminLoginForm.parentElement.hidden = false;
    classMessage.textContent = "Lejárt a belépés. Jelentkezz be újra.";
    if (adminPill) {
      adminPill.hidden = true;
    }
    return true;
  }
  return false;
};

const loadUser = async () => {
  try {
    const response = await fetch("/api/auth/me");
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

const fillClassForm = (item) => {
  classIdInput.value = item.id;
  if (classTitleInput) {
    classTitleInput.value = item.title;
  }
  if (classCoachInput) {
    classCoachInput.value = item.coach || "";
  }
  classStartsInput.value = item.startsAt.slice(0, 16);
  if (classCapacityInput) {
    classCapacityInput.value = item.capacity;
  }
  classNotesInput.value = item.notes || "";
  classMessage.textContent = "Szerkesztés betöltve.";
  const modalContent = adminModal.querySelector(".modal-content");
  if (modalContent) {
    modalContent.scrollTo({ top: 0, behavior: "smooth" });
  }
};

const resetClassForm = () => {
  classIdInput.value = "";
  if (classTitleInput) {
    classTitleInput.value = "";
  }
  if (classCoachInput) {
    classCoachInput.value = "";
  }
  classStartsInput.value = "";
  if (classCapacityInput) {
    classCapacityInput.value = "";
  }
  classNotesInput.value = "";
  classMessage.textContent = "";
};

const deleteClass = async (id) => {
  classMessage.textContent = "";
  const response = await fetch(`/api/admin/classes/${id}`, {
    method: "DELETE",
  });
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    classMessage.textContent = "Nem sikerült törölni.";
    return;
  }
  await loadAdminData();
  await loadClasses();
};

const cancelSignup = async (id) => {
  const response = await fetch(`/api/signups/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    signupMessage.textContent = "Nem sikerült törölni az időpontot.";
    return;
  }
  signupMessage.textContent = "Sikeresen törölve!";
  openModal(signupModal);
  await loadMySignups();
  await loadClasses();
  setTimeout(() => closeModal(signupModal), 2000);
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
  const response = await fetch(`/api/classes/${classId}/signup`, {
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
    response = await fetch("/api/auth/register", {
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
    response = await fetch("/api/auth/login", {
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
  const response = await fetch("/api/admin/login", {
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

classForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  classMessage.textContent = "";
  const payload = {
    title: classTitleInput ? classTitleInput.value.trim() : "Edzes",
    coach: classCoachInput ? classCoachInput.value.trim() : "",
    startsAt: classStartsInput.value,
    capacity: classCapacityInput ? Number(classCapacityInput.value) : 9999,
    notes: classNotesInput.value.trim(),
  };

  const method = classIdInput.value ? "PUT" : "POST";
  const url = classIdInput.value
    ? `/api/admin/classes/${classIdInput.value}`
    : "/api/admin/classes";

  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (handleAdminUnauthorized(response)) {
    return;
  }

  if (!response.ok) {
    classMessage.textContent = "Nem sikerült menteni.";
    return;
  }

  classMessage.textContent = "Mentve.";
  resetClassForm();
  await loadAdminData();
  await loadClasses();
});

classResetButton.addEventListener("click", resetClassForm);

adminLogout.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  adminPanel.hidden = true;
  adminLoginForm.parentElement.hidden = false;
  if (adminPill) {
    adminPill.hidden = true;
  }
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
    passAdminStatus.textContent = "Email megadasa kotelezo.";
    return;
  }
  const response = await fetch("/api/admin/passes/assign", {
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
      err.error || "Nem sikerult a berletet rogziteni.";
    return;
  }
  passAdminStatus.textContent = "Berlet rogzitve.";
  passTotalInput.value = "10";
  passRemainingInput.value = "10";
  await loadAdminPass();
});

savePassAdminButton?.addEventListener("click", () => {
  saveAdminPass();
});

addPassUseButton?.addEventListener("click", () => {
  addPassUse();
});

const setClassAvailability = async (isActive) => {
  if (!availabilityClassSelect || !availabilityStatus) {
    return;
  }
  const classId = availabilityClassSelect.value;
  if (!classId) {
    availabilityStatus.textContent = "Valassz egy orat.";
    return;
  }
  availabilityStatus.textContent = "";
  const response = await fetch(`/api/admin/classes/${classId}/availability`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive }),
  });
  if (handleAdminUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    availabilityStatus.textContent = "Nem sikerult frissiteni.";
    return;
  }
  availabilityStatus.textContent = isActive
    ? "Ora elerhetove teve."
    : "Ora nem elerheto.";
  await loadAdminData();
  await loadClasses();
};

setUnavailableButton?.addEventListener("click", () => {
  setClassAvailability(false);
});

setAvailableButton?.addEventListener("click", () => {
  setClassAvailability(true);
});

openUser.addEventListener("click", async () => {
  if (currentUser) {
    await fetch("/api/auth/logout", { method: "POST" });
    currentUser = null;
    updateUserUI();
    renderMySignups([]);
    renderSignupsMenu();
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

openAdmin.addEventListener("click", () => {
  openModal(adminModal);
  loadAdminData();
});

adminClassToggle?.addEventListener("click", () => {
  setAdminClassVisibility(!adminClassesOpen);
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
  telegramStatus.textContent = "Kuldem a teszt uzenetet...";
  const response = await fetch("/api/admin/telegram/test", {
    method: "POST",
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    telegramStatus.textContent = err.error || "Nem sikerult a Telegram teszt.";
    return;
  }
  telegramStatus.textContent = "Telegram teszt elkuldve.";
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
    passAdminStatus.textContent = "Email megadasa kotelezo.";
    return;
  }
  const response = await fetch("/api/admin/passes/assign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    passAdminStatus.textContent =
      err.error || "Nem sikerult a berletet rogziteni.";
    return;
  }
  passAdminStatus.textContent = "Berlet rogzitve.";
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
  scheduleWeekRefresh();
  if (userPhone) {
    userPhone.value = normalizePhone(userPhone.value);
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
  const now = new Date();
  const target = new Date(now);
  const day = now.getDay();
  const diffToFriday = day <= 5 ? 5 - day : 12 - day;
  target.setDate(now.getDate() + diffToFriday);
  target.setHours(10, 0, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 7);
  }
  const delay = target.getTime() - now.getTime();
  setTimeout(async () => {
    await loadClasses();
    scheduleWeekRefresh();
  }, delay);
};
