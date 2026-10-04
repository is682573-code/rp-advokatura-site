(() => {
  const cfg = window.SUPABASE_CONFIG;

  if (!window.supabase) {
    document.body.insertAdjacentHTML(
      "afterbegin",
      `<div class="container"><div class="message error">Supabase SDK не загрузился. Проверь интернет и подключение скрипта.</div></div>`
    );
    return;
  }

  if (!cfg?.url || !cfg?.anonKey) {
    document.body.insertAdjacentHTML(
      "afterbegin",
      `<div class="container"><div class="message error">Не найден config.js. Скопируй assets/js/config.example.js в assets/js/config.js и заполни SUPABASE_URL и SUPABASE_ANON_KEY.</div></div>`
    );
    return;
  }

  const sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true
    }
  });

  const page = document.body.dataset.page;

  let profile = null;
  let lawyersCache = [];

  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  const ORDER_EXTENSIONS = ["pdf", "doc", "docx", "jpg", "jpeg", "png", "webp"];
  const PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

  const MIME_BY_EXT = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp"
  };

  const ROLE_LABELS = {
    admin: "Администратор",
    lawyer: "Адвокат",
    employee: "Сотрудник"
  };

  const CASE_STATUS_LABELS = {
    open: "Открыто",
    in_work: "В работе",
    closed: "Закрыто",
    archived: "Архив"
  };

  const ORDER_STATUS_LABELS = {
    draft: "Черновик",
    active: "Действует",
    closed: "Закрыт",
    cancelled: "Отменён"
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    try {
      if (page === "public") await initPublic();
      else if (page === "login") await initLogin();
      else if (page === "cabinet") await initCabinet();
    } catch (err) {
      console.error(err);
      const msg =
        document.getElementById("cabinetMessage") ||
        document.getElementById("publicMessage") ||
        document.getElementById("loginMessage");
      if (msg) showMessage(msg, err.message || "Неизвестная ошибка", "error");
    }
  }

  // ══════════════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════════════

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[ch];
    });
  }

  function showMessage(el, text, type = "info") {
    if (!el) return;
    el.className = `message ${type}`;
    el.textContent = text;
    el.classList.remove("hidden");
  }

  function hideMessage(el) {
    if (!el) return;
    el.classList.add("hidden");
    el.textContent = "";
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("ru-RU");
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString("ru-RU");
  }

  function formatBytes(bytes) {
    if (!bytes) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let value = Number(bytes);
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i += 1;
    }
    return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function shortUuid(id) {
    if (!id) return "—";
    return String(id).slice(0, 8);
  }

  function uuid() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getExtension(fileName) {
    const match = /\.([0-9a-z]+)$/i.exec(fileName || "");
    return match ? match[1].toLowerCase() : "";
  }

  function guessMimeType(file) {
    const ext = getExtension(file.name);
    return file.type || MIME_BY_EXT[ext] || "application/octet-stream";
  }

  function validateFile(file, allowedExtensions) {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      throw new Error("Файл больше 10 МБ.");
    }
    const ext = getExtension(file.name);
    if (!allowedExtensions.includes(ext)) {
      throw new Error(`Недопустимый тип файла: .${ext || "?"}`);
    }
  }

  function isOffice() {
    return profile?.role === "admin" || profile?.role === "employee";
  }

  function lawyerLabel(lawyer) {
    return `${lawyer.display_name}${lawyer.reg_number ? ` — ${lawyer.reg_number}` : ""}`;
  }

  function lawyerNameById(id) {
    if (!id) return "—";
    const lawyer = lawyersCache.find((l) => l.lawyer_id === id);
    if (lawyer) return lawyerLabel(lawyer);
    return `ID ${shortUuid(id)}`;
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function fillSelect(select, items, valueKey, labelFn, placeholder) {
    if (!select) return;
    const prev = select.value;
    select.innerHTML = placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : "";
    items.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item[valueKey];
      opt.textContent = labelFn(item);
      select.appendChild(opt);
    });
    if ([...select.options].some((o) => o.value === prev)) {
      select.value = prev;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  SUPABASE DATA HELPERS
  // ══════════════════════════════════════════════════════════

  async function getCurrentProfile() {
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) return null;

    const { data, error } = await sb
      .from("profiles")
      .select("*")
      .eq("id", sessionData.session.user.id)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function searchPublicLawyers(query) {
    const { data, error } = await sb.rpc("search_public_lawyers", {
      p_query: query || null,
      p_limit: 200
    });
    if (error) throw error;
    return data || [];
  }

  async function getLawyerOrders(lawyerId) {
    const { data, error } = await sb.rpc("get_lawyer_orders", {
      p_lawyer_id: lawyerId,
      p_limit: 100
    });
    if (error) throw error;
    return data || [];
  }

  async function openFile(bucket, path) {
    try {
      const { data, error } = await sb.storage
        .from(bucket)
        .createSignedUrl(path, 600);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      alert(`Не удалось открыть файл: ${err.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  PUBLIC PAGE
  // ══════════════════════════════════════════════════════════

  async function initPublic() {
    await updatePublicAuthNav();

    const input = document.getElementById("publicQuery");
    const button = document.getElementById("publicSearchBtn");
    const messageEl = document.getElementById("publicMessage");
    const resultsEl = document.getElementById("publicResults");
    const ordersSectionEl = document.getElementById("publicLawyerOrders");
    const titleEl = document.getElementById("publicLawyerTitle");
    const listEl = document.getElementById("publicOrdersList");

    if (!input || !button) return;

    button.addEventListener("click", () => {
      performLawyerSearch(input.value.trim(), messageEl, resultsEl, ordersSectionEl, titleEl, listEl);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        performLawyerSearch(input.value.trim(), messageEl, resultsEl, ordersSectionEl, titleEl, listEl);
      }
    });

    const params = new URLSearchParams(location.search);
    const q = params.get("q");
    if (q) {
      input.value = q;
      performLawyerSearch(q, messageEl, resultsEl, ordersSectionEl, titleEl, listEl);
    }
  }

  async function updatePublicAuthNav() {
    const link = document.getElementById("publicAuthLink");
    if (!link) return;

    const { data: sessionData } = await sb.auth.getSession();
    if (sessionData.session) {
      const p = await getCurrentProfile();
      if (p?.is_active) {
        link.textContent = "Кабинет";
        link.href = "cabinet.html";
        return;
      }
    }

    link.textContent = "Войти";
    link.href = "login.html";
  }

  async function performLawyerSearch(query, messageEl, resultsEl, ordersSectionEl, titleEl, listEl) {
    hideMessage(messageEl);
    resultsEl.innerHTML = "";
    ordersSectionEl.hidden = true;
    listEl.innerHTML = "";

    showMessage(messageEl, "Поиск...", "info");

    try {
      const lawyers = await searchPublicLawyers(query);

      if (!lawyers.length) {
        showMessage(messageEl, "Ничего не найдено.", "info");
        return;
      }

      showMessage(messageEl, `Найдено адвокатов: ${lawyers.length}`, "success");

      resultsEl.innerHTML = lawyers
        .map(
          (l) => `
            <div class="card case-item">
              <strong>${escapeHtml(l.display_name)}</strong>
              <div class="meta">
                <span>Рег. номер: ${escapeHtml(l.reg_number || "—")}</span>
                <span>Публичных ордеров: ${Number(l.public_orders_count || 0)}</span>
              </div>
              <div class="actions">
                <button
                  class="btn small"
                  data-lawyer-id="${escapeHtml(l.lawyer_id)}"
                  data-lawyer-name="${escapeHtml(l.display_name)}"
                  data-lawyer-reg="${escapeHtml(l.reg_number || "")}"
                >
                  Показать ордера
                </button>
              </div>
            </div>
          `
        )
        .join("");

      resultsEl.querySelectorAll("[data-lawyer-id]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const lawyerId = btn.dataset.lawyerId;
          const lawyerName = btn.dataset.lawyerName;
          const lawyerReg = btn.dataset.lawyerReg;

          ordersSectionEl.hidden = false;
          titleEl.textContent = `${lawyerName}${lawyerReg ? ` — ${lawyerReg}` : ""}`;
          listEl.innerHTML = "";
          showMessage(messageEl, "Загрузка ордеров...", "info");

          try {
            const orders = await getLawyerOrders(lawyerId);
            renderOrders(orders, listEl, { showPublicToggle: false });
            showMessage(messageEl, `Ордеров найдено: ${orders.length}`, "success");
          } catch (err) {
            showMessage(messageEl, err.message, "error");
          }
        });
      });
    } catch (err) {
      showMessage(messageEl, err.message, "error");
    }
  }

  function renderOrders(orders, container, options = {}) {
    if (!orders.length) {
      container.innerHTML = `<p class="muted">Ордера не найдены.</p>`;
      return;
    }

    container.innerHTML = orders
      .map((o) => {
        const caseNumber = o.case_number || o.case?.case_number || "—";
        const fileButton =
          o.file_path && o.can_view_file
            ? `<button class="btn small secondary" data-open-file="${escapeHtml(o.file_path)}">Открыть файл</button>`
            : o.file_path
            ? `<span class="muted">файл защищен</span>`
            : `<span class="muted">нет файла</span>`;

        const publicButton =
          options.showPublicToggle
            ? `<button class="btn small secondary" data-toggle-public="${escapeHtml(o.id)}" data-current="${o.is_public}">
                 ${o.is_public ? "Сделать приватным" : "Сделать публичным"}
               </button>`
            : "";

        return `
          <div class="order-item">
            <strong>${escapeHtml(o.order_number)}</strong>
            <div class="meta">
              <span>Дело: ${escapeHtml(caseNumber)}</span>
              <span>Статус: ${escapeHtml(ORDER_STATUS_LABELS[o.status] || o.status)}</span>
              <span>Дата: ${escapeHtml(formatDate(o.issued_at))}</span>
              ${o.order_type ? `<span>Тип: ${escapeHtml(o.order_type)}</span>` : ""}
              ${o.file_name ? `<span>Файл: ${escapeHtml(o.file_name)} (${escapeHtml(formatBytes(o.file_size))})</span>` : ""}
            </div>
            <div class="actions">
              ${fileButton}
              ${publicButton}
            </div>
          </div>
        `;
      })
      .join("");

    container.querySelectorAll("[data-open-file]").forEach((btn) => {
      btn.addEventListener("click", () => openFile("orders", btn.dataset.openFile));
    });

    container.querySelectorAll("[data-toggle-public]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.togglePublic;
        const current = btn.dataset.current === "true";
        try {
          const { error } = await sb
            .from("orders")
            .update({ is_public: !current })
            .eq("id", id);
          if (error) throw error;
          await loadOrders();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  //  LOGIN PAGE
  // ══════════════════════════════════════════════════════════

  async function initLogin() {
    const form = document.getElementById("loginForm");
    const input = document.getElementById("accessKey");
    const messageEl = document.getElementById("loginMessage");

    const params = new URLSearchParams(location.search);
    if (params.get("error") === "disabled") {
      showMessage(messageEl, "Профиль отключен администратором.", "error");
    }

    const { data: sessionData } = await sb.auth.getSession();
    if (sessionData.session) {
      const p = await getCurrentProfile();
      if (p?.is_active) {
        location.href = "cabinet.html";
        return;
      }
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideMessage(messageEl);
      showMessage(messageEl, "Вход...", "info");

      try {
        await loginByKey(input.value);
        location.href = "cabinet.html";
      } catch (err) {
        showMessage(messageEl, err.message || "Не удалось войти", "error");
      }
    });
  }

  async function loginByKey(rawKey) {
    const key = rawKey.trim();
    if (!key) throw new Error("Введите ключ доступа.");

    const keyHash = await sha256Hex(key);
    const email = `key_${keyHash}@rp-adv.example`;
    const password = key;

    let authData;
    let authError;

    ({ data: authData, error: authError } = await sb.auth.signInWithPassword({
      email,
      password
    }));

    if (authError) {
      if (!/invalid login/i.test(authError.message)) {
        throw authError;
      }

      const validation = await sb.rpc("validate_new_access_key", { p_key: key });
      if (validation.error) throw validation.error;
      if (!validation.data?.success) {
        throw new Error(validation.data?.error || "Неверный ключ доступа.");
      }

      const signUp = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            key_hash: keyHash
          }
        }
      });

      if (
        signUp.error &&
        !/already|registered|user/i.test(signUp.error.message)
      ) {
        throw signUp.error;
      }

      if (signUp.data.session) {
        authData = signUp.data;
      } else {
        const retry = await sb.auth.signInWithPassword({
          email,
          password
        });
        if (retry.error) throw retry.error;
        authData = retry.data;
      }
    }

    if (!authData.session) {
      throw new Error(
        "Не удалось войти. Проверь, что в Supabase отключено Confirm email."
      );
    }

    const rpc = await sb.rpc("register_profile_with_key", { p_key: key });
    if (rpc.error) {
      await sb.auth.signOut();
      throw rpc.error;
    }

    if (!rpc.data?.success) {
      await sb.auth.signOut();
      throw new Error(rpc.data?.error || "Ошибка активации ключа.");
    }

    return rpc.data.profile;
  }

  async function logout() {
    await sb.auth.signOut();
    location.href = "login.html";
  }

  // ══════════════════════════════════════════════════════════
  //  CABINET
  // ══════════════════════════════════════════════════════════

  async function initCabinet() {
    profile = await getCurrentProfile();

    if (!profile) {
      location.href = "login.html";
      return;
    }

    if (!profile.is_active) {
      await sb.auth.signOut();
      location.href = "login.html?error=disabled";
      return;
    }

    document.getElementById("userName").textContent = profile.display_name;
    document.getElementById("userRole").textContent =
      ROLE_LABELS[profile.role] || profile.role;

    document.getElementById("logoutBtn").addEventListener("click", logout);

    if (profile.role === "admin") {
      document.getElementById("adminTab")?.classList.remove("hidden");
    }

    if (isOffice()) {
      document.getElementById("orderPublicWrap")?.classList.remove("hidden");
    }

    setupTabs();
    setupForms();

    await switchTab("overview");
  }

  function setupTabs() {
    const buttons = document.querySelectorAll(".tab-btn");
    const sections = document.querySelectorAll(".tab-section");

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    window.switchTab = async function switchTab(tab) {
      buttons.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
      sections.forEach((s) => {
        const isActive = s.id === `tab-${tab}`;
        s.classList.toggle("active", isActive);
        s.classList.toggle("hidden", !isActive);
      });

      try {
        if (tab === "overview") await loadOverview();
        if (tab === "cases") await loadCases();
        if (tab === "orders") await loadOrders();
        if (tab === "photos") await loadPhotos();
        if (tab === "search") initCabinetSearch();
        if (tab === "admin" && profile.role === "admin") await loadAdmin();
      } catch (err) {
        showMessage(document.getElementById("cabinetMessage"), err.message, "error");
      }
    };
  }

  function setupForms() {
    document.getElementById("caseForm")?.addEventListener("submit", createCase);
    document.getElementById("orderForm")?.addEventListener("submit", createOrder);
    document.getElementById("photoForm")?.addEventListener("submit", createPhoto);

    const adminRole = document.getElementById("adminRole");
    const adminRegNumber = document.getElementById("adminRegNumber");

    function syncAdminReg() {
      if (!adminRole || !adminRegNumber) return;
      const isLawyer = adminRole.value === "lawyer";
      adminRegNumber.required = isLawyer;
      adminRegNumber.disabled = !isLawyer;
      if (!isLawyer) adminRegNumber.value = "";
    }

    adminRole?.addEventListener("change", syncAdminReg);
    syncAdminReg();

    document.getElementById("issueKeyForm")?.addEventListener("submit", issueKey);

    document.getElementById("copyKeyBtn")?.addEventListener("click", async () => {
      const textarea = document.getElementById("adminKeyText");
      const btn = document.getElementById("copyKeyBtn");
      if (!textarea?.value) return;
      try {
        await navigator.clipboard.writeText(textarea.value);
        const old = btn.textContent;
        btn.textContent = "Скопировано";
        setTimeout(() => (btn.textContent = old), 1500);
      } catch {
        textarea.select();
        document.execCommand("copy");
      }
    });
  }

  async function loadOverview() {
    const el = document.getElementById("overviewContent");
    if (!el) return;

    const [casesRes, ordersRes, photosRes] = await Promise.all([
      sb.from("cases").select("*", { count: "exact", head: true }),
      sb.from("orders").select("*", { count: "exact", head: true }),
      sb.from("photos").select("*", { count: "exact", head: true })
    ]);

    el.innerHTML = `
      <div class="card">
        <h3>Профиль</h3>
        <div class="meta">
          <span>Имя: ${escapeHtml(profile.display_name)}</span>
          <span>Роль: ${escapeHtml(ROLE_LABELS[profile.role] || profile.role)}</span>
          ${profile.reg_number ? `<span>Рег. номер: ${escapeHtml(profile.reg_number)}</span>` : ""}
        </div>
      </div>

      <div class="card">
        <h3>Статистика</h3>
        <div class="meta">
          <span>Дела: ${casesRes.count ?? 0}</span>
          <span>Ордера: ${ordersRes.count ?? 0}</span>
          <span>Фото: ${photosRes.count ?? 0}</span>
        </div>
      </div>
    `;
  }

  async function ensureLawyers(force = false) {
    if (force || lawyersCache.length === 0) {
      lawyersCache = await searchPublicLawyers("");
    }

    fillSelect(
      document.getElementById("caseLawyer"),
      lawyersCache,
      "lawyer_id",
      lawyerLabel,
      "Не назначен"
    );

    fillSelect(
      document.getElementById("orderLawyerSelect"),
      lawyersCache,
      "lawyer_id",
      lawyerLabel,
      "Выберите адвоката"
    );

    if (profile.role === "lawyer") {
      const caseLawyer = document.getElementById("caseLawyer");
      const orderLawyer = document.getElementById("orderLawyerSelect");
      if (caseLawyer) caseLawyer.value = profile.id;
      if (orderLawyer) orderLawyer.value = profile.id;
    }
  }

  async function loadCasesForSelect() {
    const { data, error } = await sb
      .from("cases")
      .select("id, case_number, title")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    fillSelect(
      document.getElementById("orderCaseSelect"),
      data || [],
      "id",
      (c) => `${c.case_number} — ${c.title}`,
      "Без дела"
    );

    fillSelect(
      document.getElementById("photoCaseSelect"),
      data || [],
      "id",
      (c) => `${c.case_number} — ${c.title}`,
      "—"
    );
  }

  async function loadOrdersForSelect() {
    const { data, error } = await sb
      .from("orders")
      .select("id, order_number")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    fillSelect(
      document.getElementById("photoOrderSelect"),
      data || [],
      "id",
      (o) => o.order_number,
      "—"
    );
  }

  async function loadCases() {
    await ensureLawyers();

    const { data, error } = await sb
      .from("cases")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const container = document.getElementById("casesList");
    if (!container) return;

    if (!data.length) {
      container.innerHTML = `<p class="muted">Дела не найдены.</p>`;
      return;
    }

    container.innerHTML = data
      .map(
        (c) => `
          <div class="card case-item">
            <strong>${escapeHtml(c.case_number)}</strong>
            <div>${escapeHtml(c.title)}</div>
            <div class="meta">
              <span>Клиент: ${escapeHtml(c.client_name || "—")}</span>
              <span>Адвокат: ${escapeHtml(lawyerNameById(c.assigned_lawyer_id))}</span>
              <span>Статус: ${escapeHtml(CASE_STATUS_LABELS[c.status] || c.status)}</span>
              <span>Создано: ${escapeHtml(formatDateTime(c.created_at))}</span>
            </div>
            ${c.description ? `<p class="muted">${escapeHtml(c.description)}</p>` : ""}
          </div>
        `
      )
      .join("");
  }

  async function createCase(e) {
    e.preventDefault();
    const messageEl = document.getElementById("cabinetMessage");
    hideMessage(messageEl);

    try {
      const assignedLawyerId = document.getElementById("caseLawyer")?.value || null;

      const payload = {
        case_number: document.getElementById("caseNumber").value.trim(),
        title: document.getElementById("caseTitle").value.trim(),
        client_name: document.getElementById("caseClient").value.trim() || null,
        description: document.getElementById("caseDescription").value.trim() || null,
        status: document.getElementById("caseStatus").value,
        assigned_lawyer_id: assignedLawyerId,
        created_by: profile.id
      };

      if (profile.role === "lawyer" && !payload.assigned_lawyer_id) {
        payload.assigned_lawyer_id = profile.id;
      }

      const { error } = await sb.from("cases").insert(payload);
      if (error) throw error;

      showMessage(messageEl, "Дело создано.", "success");
      document.getElementById("caseForm").reset();
      await loadCases();
    } catch (err) {
      showMessage(messageEl, err.message, "error");
    }
  }

  async function loadOrders() {
    await ensureLawyers();
    await loadCasesForSelect();

    const { data, error } = await sb
      .from("orders")
      .select(`
        id,
        order_number,
        case_id,
        lawyer_id,
        order_type,
        issued_at,
        status,
        file_path,
        file_name,
        file_size,
        mime_type,
        is_public,
        created_at,
        case:cases(case_number)
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const container = document.getElementById("ordersList");
    if (!container) return;

    const orders = (data || []).map((o) => ({
      ...o,
      case_number: o.case?.case_number,
      can_view_file: Boolean(o.file_path)
    }));

    const withLawyer = orders.map((o) => ({
      ...o,
      lawyer_name: lawyerNameById(o.lawyer_id)
    }));

    container.innerHTML = withLawyer.length
      ? withLawyer
          .map(
            (o) => `
              <div class="card order-item">
                <strong>${escapeHtml(o.order_number)}</strong>
                <div class="meta">
                  <span>Дело: ${escapeHtml(o.case_number || "—")}</span>
                  <span>Адвокат: ${escapeHtml(o.lawyer_name)}</span>
                  <span>Статус: ${escapeHtml(ORDER_STATUS_LABELS[o.status] || o.status)}</span>
                  <span>Дата: ${escapeHtml(formatDate(o.issued_at))}</span>
                  <span>Публичный: ${o.is_public ? "да" : "нет"}</span>
                </div>
                ${o.order_type ? `<div class="muted">Тип: ${escapeHtml(o.order_type)}</div>` : ""}
                ${o.content ? `<p class="muted">${escapeHtml(o.content)}</p>` : ""}
                <div class="actions">
                  ${
                    o.file_path
                      ? `<button class="btn small secondary" data-open-file="${escapeHtml(o.file_path)}">
                           Открыть файл (${escapeHtml(o.file_name || "файл")}, ${escapeHtml(formatBytes(o.file_size))})
                         </button>`
                      : `<span class="muted">Файл не загружен</span>`
                  }
                  ${
                    isOffice()
                      ? `<button class="btn small secondary" data-toggle-public="${escapeHtml(o.id)}" data-current="${o.is_public}">
                           ${o.is_public ? "Сделать приватным" : "Сделать публичным"}
                         </button>`
                      : ""
                  }
                </div>
              </div>
            `
          )
          .join("")
      : `<p class="muted">Ордера не найдены.</p>`;

    container.querySelectorAll("[data-open-file]").forEach((btn) => {
      btn.addEventListener("click", () => openFile("orders", btn.dataset.openFile));
    });

    container.querySelectorAll("[data-toggle-public]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.togglePublic;
        const current = btn.dataset.current === "true";
        try {
          const { error } = await sb
            .from("orders")
            .update({ is_public: !current })
            .eq("id", id);
          if (error) throw error;
          await loadOrders();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  async function createOrder(e) {
    e.preventDefault();
    const messageEl = document.getElementById("cabinetMessage");
    hideMessage(messageEl);

    const fileInput = document.getElementById("orderFile");
    const file = fileInput.files[0];

    try {
      if (file) validateFile(file, ORDER_EXTENSIONS);

      const caseId = document.getElementById("orderCaseSelect")?.value || null;
      let lawyerId = document.getElementById("orderLawyerSelect")?.value || null;

      if (profile.role === "lawyer" && !lawyerId) {
        lawyerId = profile.id;
      }

      if (!lawyerId) {
        throw new Error("Выберите адвоката для ордера.");
      }

      const payload = {
        order_number: document.getElementById("orderNumber").value.trim(),
        case_id: caseId,
        lawyer_id: lawyerId,
        order_type: document.getElementById("orderType").value.trim() || null,
        issued_at: document.getElementById("orderIssuedAt").value || null,
        content: document.getElementById("orderContent").value.trim() || null,
        status: document.getElementById("orderStatus").value,
        is_public: isOffice() ? document.getElementById("orderIsPublic").checked : false,
        created_by: profile.id
      };

      const { data: order, error: insertError } = await sb
        .from("orders")
        .insert(payload)
        .select()
        .single();

      if (insertError) throw insertError;

      if (file) {
        const ext = getExtension(file.name);
        const folder = order.case_id || "unassigned";
        const path = `orders/${folder}/${order.id}.${ext}`;

        try {
          const { error: uploadError } = await sb.storage
            .from("orders")
            .upload(path, file, {
              cacheControl: "3600",
              upsert: false,
              contentType: guessMimeType(file)
            });

          if (uploadError) throw uploadError;

          const { error: updateError } = await sb
            .from("orders")
            .update({
              file_path: path,
              file_name: file.name,
              file_size: file.size,
              mime_type: guessMimeType(file)
            })
            .eq("id", order.id);

          if (updateError) throw updateError;
        } catch (uploadErr) {
          await sb.from("orders").delete().eq("id", order.id);
          throw uploadErr;
        }
      }

      showMessage(messageEl, "Ордер создан.", "success");
      document.getElementById("orderForm").reset();
      await loadOrders();
    } catch (err) {
      showMessage(messageEl, err.message, "error");
    }
  }

  async function loadPhotos() {
    await loadCasesForSelect();
    await loadOrdersForSelect();

    const { data, error } = await sb
      .from("photos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const container = document.getElementById("photosList");
    if (!container) return;

    if (!data.length) {
      container.innerHTML = `<p class="muted">Фото не найдены.</p>`;
      return;
    }

    container.innerHTML = data
      .map(
        (p) => `
          <div class="card photo-item">
            <strong>${escapeHtml(p.caption || "Фотография")}</strong>
            <div class="meta">
              <span>Дело: ${escapeHtml(p.case_id ? shortUuid(p.case_id) : "—")}</span>
              <span>Ордер: ${escapeHtml(p.order_id ? shortUuid(p.order_id) : "—")}</span>
              <span>Загружено: ${escapeHtml(formatDateTime(p.created_at))}</span>
            </div>
            <div class="actions">
              <button class="btn small secondary" data-photo-path="${escapeHtml(p.file_path)}">
                Показать фото
              </button>
            </div>
          </div>
        `
      )
      .join("");

    container.querySelectorAll("[data-photo-path]").forEach((btn) => {
      btn.addEventListener("click", () => openFile("photos", btn.dataset.photoPath));
    });
  }

  async function createPhoto(e) {
    e.preventDefault();
    const messageEl = document.getElementById("cabinetMessage");
    hideMessage(messageEl);

    const fileInput = document.getElementById("photoFile");
    const file = fileInput.files[0];

    try {
      if (!file) throw new Error("Выбери файл фото.");
      validateFile(file, PHOTO_EXTENSIONS);

      const caseId = document.getElementById("photoCaseSelect")?.value || null;
      const orderId = document.getElementById("photoOrderSelect")?.value || null;

      if (!caseId && !orderId) {
        throw new Error("Выбери дело или ордер для фото.");
      }

      const ext = getExtension(file.name);
      const path = `photos/${uuid()}.${ext}`;

      const { error: uploadError } = await sb.storage
        .from("photos")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: guessMimeType(file)
        });

      if (uploadError) throw uploadError;

      const { error: insertError } = await sb.from("photos").insert({
        case_id: caseId,
        order_id: orderId,
        file_path: path,
        file_name: file.name,
        caption: document.getElementById("photoCaption").value.trim() || null,
        created_by: profile.id
      });

      if (insertError) {
        await sb.storage.from("photos").remove([path]);
        throw insertError;
      }

      showMessage(messageEl, "Фото загружено.", "success");
      document.getElementById("photoForm").reset();
      await loadPhotos();
    } catch (err) {
      showMessage(messageEl, err.message, "error");
    }
  }

  function initCabinetSearch() {
    const input = document.getElementById("cabinetQuery");
    const button = document.getElementById("cabinetSearchBtn");
    const messageEl = document.getElementById("cabinetSearchMessage");
    const resultsEl = document.getElementById("cabinetSearchResults");
    const ordersSectionEl = document.getElementById("cabinetLawyerOrders");
    const titleEl = document.getElementById("cabinetLawyerTitle");
    const listEl = document.getElementById("cabinetOrdersList");

    if (!input || !button) return;

    const run = () =>
      performLawyerSearch(input.value.trim(), messageEl, resultsEl, ordersSectionEl, titleEl, listEl);

    button.onclick = run;
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        run();
      }
    };
  }

  // ══════════════════════════════════════════════════════════
  //  ADMIN
  // ══════════════════════════════════════════════════════════

  async function loadAdmin() {
    await loadAccessKeys();
    await loadProfilesAdmin();
    await loadLogs();
  }

  async function issueKey(e) {
    e.preventDefault();
    const messageEl = document.getElementById("cabinetMessage");
    hideMessage(messageEl);

    try {
      const role = document.getElementById("adminRole").value;
      const displayName = document.getElementById("adminDisplayName").value.trim();
      const regNumberRaw = document.getElementById("adminRegNumber").value.trim();
      const label = document.getElementById("adminLabel").value.trim() || null;
      const expiresRaw = document.getElementById("adminExpiresAt").value;

      const regNumber = role === "lawyer" ? regNumberRaw || null : null;
      const expiresAt = expiresRaw ? new Date(expiresRaw).toISOString() : null;

      const { data, error } = await sb.rpc("issue_access_key", {
        p_role: role,
        p_display_name: displayName,
        p_reg_number: regNumber,
        p_label: label,
        p_expires_at: expiresAt
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Не удалось выдать ключ");

      const resultBox = document.getElementById("adminKeyResult");
      const keyText = document.getElementById("adminKeyText");

      keyText.value = data.key;
      resultBox.classList.remove("hidden");

      showMessage(
        messageEl,
        "Ключ создан. Скопируй его сейчас — он показывается только один раз.",
        "success"
      );

      document.getElementById("issueKeyForm").reset();
      document.getElementById("adminRole").value = "lawyer";
      document.getElementById("adminRole").dispatchEvent(new Event("change"));

      await loadAccessKeys();
    } catch (err) {
      showMessage(messageEl, err.message, "error");
    }
  }

  async function loadAccessKeys() {
    const { data, error } = await sb
      .from("access_keys")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const container = document.getElementById("accessKeysList");
    if (!container) return;

    if (!data.length) {
      container.innerHTML = `<p class="muted">Ключи не найдены.</p>`;
      return;
    }

    container.innerHTML = data
      .map((k) => {
        const status = k.revoked_at
          ? "Отозван"
          : k.used_count >= k.max_uses
          ? "Использован"
          : k.expires_at && new Date(k.expires_at) < new Date()
          ? "Истёк"
          : "Активен";

        return `
          <div class="card key-item">
            <strong>${escapeHtml(k.display_name)}</strong>
            <div class="meta">
              <span>Роль: ${escapeHtml(ROLE_LABELS[k.role] || k.role)}</span>
              <span>Рег. номер: ${escapeHtml(k.reg_number || "—")}</span>
              <span>Статус: ${escapeHtml(status)}</span>
              <span>Метка: ${escapeHtml(k.label || "—")}</span>
              <span>Создан: ${escapeHtml(formatDateTime(k.created_at))}</span>
              ${k.expires_at ? `<span>Истекает: ${escapeHtml(formatDateTime(k.expires_at))}</span>` : ""}
            </div>
            <div class="actions">
              ${
                !k.revoked_at
                  ? `<button class="btn small danger" data-revoke-key="${escapeHtml(k.id)}">Отозвать ключ</button>`
                  : `<span class="muted">Ключ отозван</span>`
              }
            </div>
          </div>
        `;
      })
      .join("");

    container.querySelectorAll("[data-revoke-key]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Отозвать этот ключ?")) return;
        try {
          const { error } = await sb
            .from("access_keys")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", btn.dataset.revokeKey);
          if (error) throw error;
          await loadAccessKeys();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  async function loadProfilesAdmin() {
    const { data, error } = await sb
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const container = document.getElementById("profilesList");
    if (!container) return;

    if (!data.length) {
      container.innerHTML = `<p class="muted">Пользователи не найдены.</p>`;
      return;
    }

    container.innerHTML = data
      .map((p) => {
        const self = p.id === profile.id;
        return `
          <div class="card profile-item">
            <strong>${escapeHtml(p.display_name)}</strong>
            <div class="meta">
              <span>Роль: ${escapeHtml(ROLE_LABELS[p.role] || p.role)}</span>
              <span>Рег. номер: ${escapeHtml(p.reg_number || "—")}</span>
              <span>Активен: ${p.is_active ? "да" : "нет"}</span>
              <span>ID: ${escapeHtml(shortUuid(p.id))}</span>
            </div>
            <div class="actions">
              ${
                self
                  ? `<span class="muted">Нельзя отключить самого себя</span>`
                  : `<button class="btn small ${p.is_active ? "danger" : "secondary"}"
                       data-toggle-active="${escapeHtml(p.id)}"
                       data-current="${p.is_active}">
                       ${p.is_active ? "Отключить" : "Включить"}
                     </button>`
              }
            </div>
          </div>
        `;
      })
      .join("");

    container.querySelectorAll("[data-toggle-active]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.toggleActive;
        const current = btn.dataset.current === "true";
        if (!confirm(current ? "Отключить пользователя?" : "Включить пользователя?")) return;

        try {
          const { error } = await sb
            .from("profiles")
            .update({ is_active: !current })
            .eq("id", id);
          if (error) throw error;
          await loadProfilesAdmin();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  async function loadLogs() {
    const { data, error } = await sb
      .from("login_logs")
      .select("*")
      .order("login_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const container = document.getElementById("logsList");
    if (!container) return;

    if (!data.length) {
      container.innerHTML = `<p class="muted">Логи пусты.</p>`;
      return;
    }

    container.innerHTML = data
      .map(
        (log) => `
          <div class="card log-item">
            <strong>${escapeHtml(log.display_name || "Неизвестный")}</strong>
            <div class="meta">
              <span>Роль: ${escapeHtml(ROLE_LABELS[log.role] || log.role || "—")}</span>
              <span>Ключ: ${escapeHtml(log.key_label || "—")}</span>
              <span>Время: ${escapeHtml(formatDateTime(log.login_at))}</span>
            </div>
          </div>
        `
      )
      .join("");
  }
})();
