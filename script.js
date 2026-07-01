/* ===========================================================
   China Tradex N Tour — site logic
   Storage key: localStorage["ctx_applications"]
   Key used: Passport Number (Customized)
=========================================================== */

const STORAGE_KEY = "ctx_applications";
const STAGES = ["Submitted", "Processing", "Document Verified", "Visa Approved"];
const STAGE_BADGE_CLASSES = ["status-processing", "status-processing", "status-verified", "status-approved"];

/* Shared store for files selected on the Apply form before they're read into the record on submit */
let uploadedFileStore = [];

/* Tracks which application is currently open in the admin "Manage" modal */
let activeModalAppId = null;

/* ---------- Admin access (client-side gate only — see note in initAdminLogin) ---------- */
const ADMIN_SESSION_KEY = "ctx_admin_session";
const ADMIN_USERNAME = "808212";
const ADMIN_PASSWORD = "808212";

/* ---------- Mobile nav toggle (all pages) ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("navToggle");
  const nav = document.getElementById("mainNav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => nav.classList.toggle("open"));
  }

  initApplyForm();
  initDashboard();
  initDestinations();
  initScrollReveal();
  initCounters();
  initAdminLogin();
  initAdminDashboard();
});

/* ---------- Scroll-reveal animation (all pages) ---------- */
function initScrollReveal() {
  const items = document.querySelectorAll(".reveal");
  if (!items.length) return;

  if (!("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("in-view"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );

  items.forEach((el) => observer.observe(el));
}

/* ---------- Animated count-up numbers (e.g. Data Flow stats) ---------- */
function initCounters() {
  const counters = document.querySelectorAll("[data-counter]");
  if (!counters.length) return;

  const animateCounter = (el) => {
    const target = parseInt(el.dataset.counter, 10) || 0;
    const duration = 1400;
    const start = performance.now();

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(eased * target).toLocaleString("en-US");
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = target.toLocaleString("en-US");
    }
    requestAnimationFrame(tick);
  };

  if (!("IntersectionObserver" in window)) {
    counters.forEach(animateCounter);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.4 }
  );
  counters.forEach((el) => observer.observe(el));
}

/* ---------- Destinations "See More" toggle (Home page) ---------- */
function initDestinations() {
  const btn = document.getElementById("seeMoreBtn");
  const more = document.getElementById("moreDestinations");
  const label = document.getElementById("seeMoreLabel");
  if (!btn || !more) return;

  btn.addEventListener("click", () => {
    const isOpen = more.classList.toggle("open");
    btn.classList.toggle("open", isOpen);
    label.textContent = isOpen ? "Show Fewer Destinations" : "See More Destinations";
    if (isOpen) {
      more.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  initDestinationSearch();
}

/* ---------- Destinations search filter (Home page) ---------- */
function initDestinationSearch() {
  const input = document.getElementById("destinationSearch");
  if (!input) return;

  const more = document.getElementById("moreDestinations");
  const seeMoreBtn = document.getElementById("seeMoreBtn");
  const allCards = document.querySelectorAll("#destinationGrid .destination-card, #moreDestinations .destination-card");

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();

    if (query && more && !more.classList.contains("open")) {
      more.classList.add("open");
      if (seeMoreBtn) seeMoreBtn.classList.add("open");
    }

    allCards.forEach((card) => {
      const name = card.querySelector("h4")?.textContent.toLowerCase() || "";
      card.style.display = !query || name.includes(query) ? "" : "none";
    });
  });
}

/* ---------- Helpers ---------- */

function getApplications() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveApplications(apps) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
}

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function computeStage(submittedAt) {
  const minutesElapsed = (Date.now() - submittedAt) / 60000;
  if (minutesElapsed < 1) return 0;   // Submitted
  if (minutesElapsed < 3) return 1;   // Processing
  if (minutesElapsed < 6) return 2;   // Document Verified
  return 3;                            // Visa Approved
}

/* Resolves the *effective* status of an application, taking the admin's
   manual override (record.manualStatus) into account when present.
   manualStatus can be: undefined/null (auto, time-based), 0-3 (forced stage),
   or "rejected". */
function getStatusInfo(record) {
  if (record.manualStatus === "rejected") {
    return { index: -1, label: "Rejected", badgeClass: "status-rejected", isRejected: true, isManual: true };
  }
  const isManual = typeof record.manualStatus === "number";
  let idx = isManual ? record.manualStatus : computeStage(record.submittedAt);
  idx = Math.max(0, Math.min(STAGES.length - 1, idx));
  return { index: idx, label: STAGES[idx], badgeClass: STAGE_BADGE_CLASSES[idx], isRejected: false, isManual };
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/* Reads an array of File objects into storable document records (base64 data URLs)
   so they persist in localStorage alongside the application. */
function readFilesAsDocuments(files) {
  const reads = files.map((file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        id: "doc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: reader.result,
        uploadedAt: Date.now()
      });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  });
  return Promise.all(reads);
}

/* ---------- Apply Form Page ---------- */

function initApplyForm() {
  const form = document.getElementById("visaForm");
  if (!form) return;

  // ইউআরএল প্যারামিটার থেকে দেশ আগে থেকে সিলেক্ট করে দেওয়া হচ্ছে (যেমন apply.html?country=Canada)
  const params = new URLSearchParams(window.location.search);
  const prefillCountry = params.get("country");
  const destCountrySelect = document.getElementById("destCountry");
  if (prefillCountry && destCountrySelect) {
    const match = Array.from(destCountrySelect.options).find(
      (opt) => opt.value.toLowerCase() === prefillCountry.toLowerCase()
    );
    if (match) destCountrySelect.value = match.value;
  }

  // অ্যাডমিন এই ফর্ম দিয়ে ইউজারের পক্ষে আবেদন জমা দিচ্ছে কিনা চেক করা হচ্ছে (apply.html?admin=1)
  const isAdminMode = params.get("admin") === "1";
  if (isAdminMode) {
    const banner = document.getElementById("adminModeBanner");
    if (banner) banner.style.display = "inline-flex";
  }

  initDocumentPreview();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const fullName = document.getElementById("fullName").value.trim();
    const destCountry = document.getElementById("destCountry").value;
    const visaType = document.getElementById("visaType").value;
    const email = document.getElementById("email").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const nationality = document.getElementById("nationality").value.trim();
    // পাসপোর্ট নম্বরটিকে ট্র্যাকিং কি (Key) হিসেবে ব্যবহারের জন্য আপারকেস করা হচ্ছে
    const passport = document.getElementById("passport").value.trim().toUpperCase(); 
    const travelDate = document.getElementById("travelDate").value;

    if (!passport) {
      alert("Please enter a valid Passport Number.");
      return;
    }

    // ট্র্যাকিং আইডি হিসেবে এখন সরাসরি পাসপোর্ট নাম্বার সেট হবে
    const trackingId = passport; 

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.textContent : "";
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Submitting..."; }

    // আপলোড করা ফাইলগুলো base64 ডকুমেন্টে রূপান্তর করা হচ্ছে, যাতে অ্যাডমিন পরে
    // এগুলো এডমিন প্যানেল থেকে দেখতে/মুছতে পারে
    let documents = [];
    try {
      documents = await readFilesAsDocuments(uploadedFileStore);
    } catch (err) {
      console.error("Document read error:", err);
    }

    const record = {
      id: trackingId,
      name: fullName,
      destCountry,
      visaType,
      email,
      phone,
      nationality,
      passport,
      travelDate,
      submittedAt: Date.now(),
      documents,
      manualStatus: null,   // null = সয়ংক্রিয় (সময়-ভিত্তিক); অ্যাডমিন চাইলে এটা ওভাররাইড করতে পারবে
      statusNote: "",
      internalNotes: ""
    };

    const apps = getApplications();
    apps[trackingId] = record; // লোকাল স্টোরেজে পাসপোর্ট নাম্বার দিয়ে সেভ হচ্ছে

    try {
      saveApplications(apps);
    } catch (err) {
      console.error("Storage error:", err);
      // স্টোরেজ কোটা পার হয়ে গেলে ডকুমেন্ট ছাড়া সেভ করার চেষ্টা করা হচ্ছে
      record.documents = [];
      apps[trackingId] = record;
      try {
        saveApplications(apps);
        alert("ডকুমেন্টগুলো আকারে অনেক বড় হওয়ায় সংরক্ষণ করা যায়নি, তবে আপনার আবেদন জমা হয়েছে। দয়া করে আমাদের অফিসে সরাসরি ডকুমেন্ট পাঠান।");
      } catch (err2) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
        alert("আবেদনটি সংরক্ষণ করা যায়নি। দয়া করে আবার চেষ্টা করুন।");
        return;
      }
    }

    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
    uploadedFileStore = [];

    // কনফার্মেশন প্যানেলে পাসপোর্ট নাম্বারটি ট্র্যাকিং আইডি হিসেবে দেখাবে
    if (document.getElementById("confirmName")) document.getElementById("confirmName").textContent = fullName;
    if (document.getElementById("confirmCountry")) document.getElementById("confirmCountry").textContent = destCountry + " visa";
    if (document.getElementById("confirmAppId")) document.getElementById("confirmAppId").textContent = trackingId;

    form.style.display = "none";
    const panel = document.getElementById("confirmPanel");
    if (panel) {
      panel.style.display = "block";
      panel.classList.add("show");
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // ড্যাশবোর্ড লিঙ্কে পাসপোর্ট আইডি পাস করা হচ্ছে
    const trackBtn = document.getElementById("trackNowBtn");
    if (trackBtn) {
      trackBtn.href = `dashboard.html?id=${trackingId}`;
    }

    // অ্যাডমিন মোডে থাকলে "Back to Admin Dashboard" বাটন দেখানো হচ্ছে
    if (isAdminMode) {
      const adminBackBtn = document.getElementById("adminBackBtn");
      if (adminBackBtn) adminBackBtn.style.display = "inline-block";
    }
  });
}

/* ---------- Document upload preview (Apply Form) ---------- */

function initDocumentPreview() {
  const input = document.getElementById("documents");
  const grid = document.getElementById("filePreviewGrid");
  if (!input || !grid) return;

  // ফর্ম লোড হওয়ার সময় আগের কোনো সেশনের ফাইল যেন বেঁচে না থাকে
  uploadedFileStore = [];

  function render() {
    grid.innerHTML = "";
    uploadedFileStore.forEach((file, index) => {
      const url = URL.createObjectURL(file);
      const isImage = file.type.startsWith("image/");
      const card = document.createElement("div");
      card.className = "file-preview-card";
      card.innerHTML = `
        <button type="button" class="file-remove" title="Remove" data-index="${index}">&times;</button>
        <div class="file-thumb">
          ${isImage
            ? `<img src="${url}" alt="${file.name}">`
            : `<div class="file-icon">PDF</div>`}
        </div>
        <div class="file-meta">
          <span class="file-name" title="${file.name}">${file.name}</span>
          <span class="file-size">${formatFileSize(file.size)}</span>
        </div>
        <a href="${url}" target="_blank" rel="noopener" class="btn btn-outline-navy file-view-btn">View</a>
      `;
      grid.appendChild(card);
    });

    if (uploadedFileStore.length) {
      grid.insertAdjacentHTML(
        "beforeend",
        `<p class="file-count-note">${uploadedFileStore.length} file${uploadedFileStore.length > 1 ? "s" : ""} selected</p>`
      );
    }

    grid.querySelectorAll(".file-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        uploadedFileStore.splice(idx, 1);
        render();
      });
    });
  }

  input.addEventListener("change", () => {
    if (input.files && input.files.length) {
      uploadedFileStore = uploadedFileStore.concat(Array.from(input.files));
      render();
    }
    // ইনপুটটা রিসেট করে দেওয়া হচ্ছে — যাতে একই ফাইল আবার সিলেক্ট করলেও
    // change ইভেন্ট ঠিকভাবে fire করে এবং প্রিভিউতে যোগ হয়
    input.value = "";
  });
}

/* ---------- Dashboard Page ---------- */

function initDashboard() {
  const lookupBtn = document.getElementById("lookupBtn");
  if (!lookupBtn) return; 

  const input = document.getElementById("appIdInput");
  const errorMsg = document.getElementById("lookupError");
  const demoFillBtn = document.getElementById("demoFillBtn");
  const searchAnotherBtn = document.getElementById("searchAnotherBtn");

  const runLookup = () => {
    const id = input.value.trim().toUpperCase(); // ইউজার পাসপোর্ট টাইপ করলে তা রিড করবে
    if (errorMsg) errorMsg.classList.remove("show");

    const record = findApplication(id);
    if (!record) {
      if (errorMsg) errorMsg.classList.add("show");
      return;
    }
    renderDashboard(record);
  };

  lookupBtn.addEventListener("click", runLookup);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") runLookup(); });

  if (demoFillBtn) {
    demoFillBtn.addEventListener("click", () => {
      input.value = "CTX-2026-3381"; // ডেমো আইডি আগের মতোই কাজ করবে
      runLookup();
    });
  }

  if (searchAnotherBtn) {
    searchAnotherBtn.addEventListener("click", () => {
      const dbPanel = document.getElementById("dashboardPanel");
      const lWrap = document.getElementById("lookupWrap");
      if (dbPanel) dbPanel.classList.remove("show");
      if (lWrap) lWrap.style.display = "block";
      input.value = "";
      input.focus();
    });
  }

  const params = new URLSearchParams(window.location.search);
  const prefillId = params.get("id");
  if (prefillId) {
    input.value = prefillId;
    runLookup();
  }
}

function findApplication(id) {
  const apps = getApplications();
  if (apps[id]) return apps[id]; // পাসপোর্ট নাম্বার দিয়ে সার্চ করলে এখান থেকে ডাটা ম্যাচ করবে

  // ব্যাকআপ ডেমো রেকর্ড
  if (id === "CTX-2026-3381") {
    return {
      id: "CTX-2026-3381",
      name: "Wei Chen",
      visaType: "Work Permit",
      submittedAt: Date.now() - 8 * 60000 
    };
  }
  return null;
}

function renderDashboard(record) {
  const lWrap = document.getElementById("lookupWrap");
  if (lWrap) lWrap.style.display = "none";
  
  const panel = document.getElementById("dashboardPanel");
  if (panel) panel.classList.add("show");

  const info = getStatusInfo(record);
  const stageIndex = info.index; // -1 when rejected

  if (document.getElementById("dashName")) document.getElementById("dashName").textContent = record.name;
  if (document.getElementById("dashAppId")) document.getElementById("dashAppId").textContent = record.id;
  if (document.getElementById("dashVisaType")) document.getElementById("dashVisaType").textContent = record.visaType;
  if (document.getElementById("statVisaType")) document.getElementById("statVisaType").textContent = record.visaType;
  if (document.getElementById("statSubmitted")) document.getElementById("statSubmitted").textContent = formatDate(record.submittedAt);

  const eta = new Date(record.submittedAt);
  eta.setDate(eta.getDate() + 10);
  if (document.getElementById("statEta")) document.getElementById("statEta").textContent = formatDate(eta);

  const badge = document.getElementById("dashStatusBadge");
  if (badge) {
    badge.textContent = info.label;
    badge.className = "status-badge " + info.badgeClass;
  }

  const trackerEl = document.getElementById("tracker");
  const rejectionBanner = document.getElementById("rejectionBanner");

  if (info.isRejected) {
    if (trackerEl) trackerEl.style.display = "none";
    if (rejectionBanner) {
      rejectionBanner.style.display = "block";
      const textEl = document.getElementById("rejectionText");
      if (textEl) textEl.textContent = record.statusNote && record.statusNote.trim()
        ? record.statusNote.trim()
        : "Please contact our office for more details about this decision.";
    }
  } else {
    if (trackerEl) trackerEl.style.display = "";
    if (rejectionBanner) rejectionBanner.style.display = "none";

    const fill = document.getElementById("trackerFill");
    if (fill) fill.style.width = `${(stageIndex / (STAGES.length - 1)) * 90}%`;

    document.querySelectorAll(".tracker-step").forEach((stepEl, i) => {
      stepEl.classList.remove("done", "current");
      if (i < stageIndex) stepEl.classList.add("done");
      else if (i === stageIndex) stepEl.classList.add("current");

      const dateEl = stepEl.querySelector(".t-date");
      if (dateEl) {
        if (i <= stageIndex) {
          const stepDate = new Date(record.submittedAt);
          stepDate.setMinutes(stepDate.getMinutes() + i * 2);
          dateEl.textContent = formatDate(stepDate);
        } else {
          dateEl.textContent = "Pending";
        }
      }
    });
  }

  const list = document.getElementById("timelineList");
  if (list) {
    list.innerHTML = "";

    if (info.isRejected) {
      const li1 = document.createElement("li");
      li1.innerHTML = `
        <span class="dot"></span>
        <div>
          <div class="t-title">Application submitted</div>
          <div class="t-meta">${formatDate(record.submittedAt)} &middot; Your application and documents were received.</div>
        </div>`;
      list.appendChild(li1);

      const li2 = document.createElement("li");
      const note = record.statusNote && record.statusNote.trim() ? record.statusNote.trim() : "Please contact our office for more details.";
      li2.innerHTML = `
        <span class="dot" style="background:#FF6B6B;"></span>
        <div>
          <div class="t-title" style="color:#FF6B6B;">Application rejected</div>
          <div class="t-meta">${escapeHtml(note)}</div>
        </div>`;
      list.appendChild(li2);
    } else {
      const timelineCopy = [
        { title: "Application submitted", meta: "Your application and documents were received." },
        { title: "Processing started", meta: "A case officer has been assigned to your file." },
        { title: "Documents verified", meta: "All supporting documents have been checked and approved." },
        { title: "Visa approved", meta: "Your visa has been approved. Collection instructions sent by email." }
      ];
      for (let i = 0; i <= stageIndex; i++) {
        const li = document.createElement("li");
        const stepDate = new Date(record.submittedAt);
        stepDate.setMinutes(stepDate.getMinutes() + i * 2);
        li.innerHTML = `
          <span class="dot"></span>
          <div>
            <div class="t-title">${timelineCopy[i].title}</div>
            <div class="t-meta">${formatDate(stepDate)} &middot; ${timelineCopy[i].meta}</div>
          </div>`;
        list.appendChild(li);
      }
    }
  }

  if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ===========================================================
   Admin area
   NOTE: This is a client-side UI gate only — credentials and
   the session flag live in this file / localStorage, both of
   which are visible to anyone who opens dev tools. It hides
   the panel from casual visitors but is NOT real security.
   For genuine protection, move auth to a real backend/server.
=========================================================== */

function initAdminLogin() {
  const form = document.getElementById("adminLoginForm");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const user = document.getElementById("adminUser").value.trim();
    const pass = document.getElementById("adminPass").value;
    const errorMsg = document.getElementById("adminError");

    if (user === ADMIN_USERNAME && pass === ADMIN_PASSWORD) {
      sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
      window.location.href = "admin-dashboard.html";
    } else {
      if (errorMsg) errorMsg.classList.add("show");
      form.classList.add("shake");
      setTimeout(() => form.classList.remove("shake"), 400);
    }
  });
}

function initAdminDashboard() {
  const tableBody = document.getElementById("adminTableBody");
  if (!tableBody) return;

  // Gate: bounce non-authenticated visitors straight back to login
  if (sessionStorage.getItem(ADMIN_SESSION_KEY) !== "1") {
    window.location.href = "admin-login.html";
    return;
  }

  const logoutBtn = document.getElementById("adminLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      window.location.href = "admin-login.html";
    });
  }

  const searchInput = document.getElementById("adminSearch");
  if (searchInput) {
    searchInput.addEventListener("input", () => renderAdminTable(searchInput.value.trim().toLowerCase()));
  }

  initAppModal();
  renderAdminTable("");
}

function renderAdminTable(query) {
  const tableBody = document.getElementById("adminTableBody");
  const emptyState = document.getElementById("adminEmpty");
  if (!tableBody) return;

  const apps = getApplications();
  let records = Object.values(apps).sort((a, b) => b.submittedAt - a.submittedAt);

  if (query) {
    records = records.filter((r) =>
      (r.name || "").toLowerCase().includes(query) ||
      (r.passport || "").toLowerCase().includes(query)
    );
  }

  // Update summary stat cards (always reflect the full, unfiltered dataset)
  const allRecords = Object.values(apps);
  const counts = [0, 0, 0, 0];
  let rejectedCount = 0;
  allRecords.forEach((r) => {
    const info = getStatusInfo(r);
    if (info.isRejected) rejectedCount++;
    else counts[info.index]++;
  });
  setText("statTotal", allRecords.length);
  setText("statProcessing", counts[0] + counts[1]);
  setText("statVerified", counts[2]);
  setText("statApproved", counts[3]);
  setText("statRejected", rejectedCount);

  tableBody.innerHTML = "";

  if (!records.length) {
    if (emptyState) emptyState.style.display = "block";
    return;
  }
  if (emptyState) emptyState.style.display = "none";

  records.forEach((r) => {
    const info = getStatusInfo(r);
    const docCount = Array.isArray(r.documents) ? r.documents.length : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="at-name">${escapeHtml(r.name || "—")}</td>
      <td class="at-id">${escapeHtml(r.passport || r.id || "—")}</td>
      <td>${escapeHtml(r.destCountry || "—")}</td>
      <td>${escapeHtml(r.visaType || "—")}</td>
      <td>
        <span class="status-badge ${info.badgeClass}">${info.label}</span>
        ${info.isManual ? '<span class="manual-tag">manual</span>' : ""}
      </td>
      <td>${formatDate(r.submittedAt)}</td>
      <td>
        <div class="admin-actions-cell">
          <button type="button" class="admin-view-btn" data-id="${escapeHtml(r.id)}">Manage${docCount ? ` (${docCount} doc${docCount > 1 ? "s" : ""})` : ""}</button>
          <button type="button" class="admin-del-btn" data-id="${escapeHtml(r.id)}">Remove</button>
        </div>
      </td>
    `;
    tableBody.appendChild(tr);
  });

  tableBody.querySelectorAll(".admin-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => openAppModal(btn.dataset.id));
  });

  tableBody.querySelectorAll(".admin-del-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Permanently delete this application and all its documents? This cannot be undone.")) return;
      const allApps = getApplications();
      delete allApps[btn.dataset.id];
      saveApplications(allApps);
      renderAdminTable(document.getElementById("adminSearch")?.value.trim().toLowerCase() || "");
    });
  });
}

/* ---------- Admin: Application Detail / Manage Modal ---------- */

function initAppModal() {
  const overlay = document.getElementById("appModalOverlay");
  if (!overlay) return;

  const closeModal = () => closeAppModal();
  document.getElementById("modalCloseBtn")?.addEventListener("click", closeModal);
  document.getElementById("modalCloseBtn2")?.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("show")) closeModal();
  });

  document.getElementById("miSaveStatusBtn")?.addEventListener("click", () => {
    if (!activeModalAppId) return;
    const apps = getApplications();
    const record = apps[activeModalAppId];
    if (!record) return;

    const selectVal = document.getElementById("miStatusSelect").value;
    record.manualStatus = selectVal === "auto" ? null : (selectVal === "rejected" ? "rejected" : Number(selectVal));
    record.statusNote = document.getElementById("miStatusNote").value.trim();
    record.lastUpdated = Date.now();

    apps[activeModalAppId] = record;
    saveApplications(apps);
    renderAdminTable(document.getElementById("adminSearch")?.value.trim().toLowerCase() || "");
    populateModal(record);
    flashSaved("miSaveStatusBtn", "Status Updated");
  });

  document.getElementById("miSaveNotesBtn")?.addEventListener("click", () => {
    if (!activeModalAppId) return;
    const apps = getApplications();
    const record = apps[activeModalAppId];
    if (!record) return;

    record.internalNotes = document.getElementById("miInternalNotes").value.trim();
    record.lastUpdated = Date.now();

    apps[activeModalAppId] = record;
    saveApplications(apps);
    flashSaved("miSaveNotesBtn", "Notes Saved");
  });

  document.getElementById("miAddDocInput")?.addEventListener("change", async (e) => {
    if (!activeModalAppId) return;
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const apps = getApplications();
    const record = apps[activeModalAppId];
    if (!record) return;

    try {
      const newDocs = await readFilesAsDocuments(files);
      record.documents = (record.documents || []).concat(newDocs);
      record.lastUpdated = Date.now();
      apps[activeModalAppId] = record;
      saveApplications(apps);
      populateModal(record);
      renderAdminTable(document.getElementById("adminSearch")?.value.trim().toLowerCase() || "");
    } catch (err) {
      console.error(err);
      alert("ডকুমেন্ট যোগ করা যায়নি, হয়তো ফাইলটি অনেক বড়।");
    }
    e.target.value = "";
  });

  document.getElementById("miDeleteAppBtn")?.addEventListener("click", () => {
    if (!activeModalAppId) return;
    if (!confirm("Permanently delete this application and all its documents? This cannot be undone.")) return;
    const apps = getApplications();
    delete apps[activeModalAppId];
    saveApplications(apps);
    closeAppModal();
    renderAdminTable(document.getElementById("adminSearch")?.value.trim().toLowerCase() || "");
  });
}

function openAppModal(id) {
  const apps = getApplications();
  const record = apps[id];
  if (!record) return;

  activeModalAppId = id;
  populateModal(record);

  const overlay = document.getElementById("appModalOverlay");
  if (overlay) overlay.classList.add("show");
}

function closeAppModal() {
  activeModalAppId = null;
  const overlay = document.getElementById("appModalOverlay");
  if (overlay) overlay.classList.remove("show");
}

function populateModal(record) {
  setText("modalAppTitle", record.name || "Application Details");
  setText("miName", record.name || "—");
  setText("miPassport", record.passport || record.id || "—");
  setText("miNationality", record.nationality || "—");
  setText("miEmail", record.email || "—");
  setText("miPhone", record.phone || "—");
  setText("miCountry", record.destCountry || "—");
  setText("miVisaType", record.visaType || "—");
  setText("miTravelDate", record.travelDate ? formatDate(record.travelDate) : "—");
  setText("miSubmitted", formatDate(record.submittedAt));

  const statusSelect = document.getElementById("miStatusSelect");
  if (statusSelect) {
    statusSelect.value = record.manualStatus === "rejected"
      ? "rejected"
      : (typeof record.manualStatus === "number" ? String(record.manualStatus) : "auto");
  }
  const noteEl = document.getElementById("miStatusNote");
  if (noteEl) noteEl.value = record.statusNote || "";

  const internalEl = document.getElementById("miInternalNotes");
  if (internalEl) internalEl.value = record.internalNotes || "";

  renderModalDocs(record);
}

function renderModalDocs(record) {
  const grid = document.getElementById("miDocGrid");
  if (!grid) return;

  const docs = Array.isArray(record.documents) ? record.documents : [];
  if (!docs.length) {
    grid.innerHTML = `<p class="modal-doc-empty">No documents uploaded for this application.</p>`;
    return;
  }

  grid.innerHTML = "";
  docs.forEach((doc) => {
    const isImage = (doc.type || "").startsWith("image/");
    const card = document.createElement("div");
    card.className = "file-preview-card";
    card.innerHTML = `
      <button type="button" class="file-remove" title="Delete document" data-doc-id="${escapeHtml(doc.id)}">&times;</button>
      <div class="file-thumb">
        ${isImage
          ? `<img src="${doc.dataUrl}" alt="${escapeHtml(doc.name)}">`
          : `<div class="file-icon">PDF</div>`}
      </div>
      <div class="file-meta">
        <span class="file-name" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</span>
        <span class="file-size">${formatFileSize(doc.size || 0)}</span>
      </div>
      <a href="${doc.dataUrl}" target="_blank" rel="noopener" class="btn btn-outline-navy file-view-btn">View</a>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll(".file-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!activeModalAppId) return;
      if (!confirm("Delete this document?")) return;
      const apps = getApplications();
      const rec = apps[activeModalAppId];
      if (!rec) return;
      rec.documents = (rec.documents || []).filter((d) => d.id !== btn.dataset.docId);
      rec.lastUpdated = Date.now();
      apps[activeModalAppId] = rec;
      saveApplications(apps);
      populateModal(rec);
      renderAdminTable(document.getElementById("adminSearch")?.value.trim().toLowerCase() || "");
    });
  });
}

function flashSaved(btnId, message) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = message;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1200);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
