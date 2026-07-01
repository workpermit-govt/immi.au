/* ===========================================================
   VisaLink International — site logic
   Backend: Firebase Firestore (real-time, cross-device)
   Applications are stored in the "applications" collection,
   keyed by document ID = Passport Number.
   Each application's uploaded files live in the
   "applications/{id}/documents" subcollection.
=========================================================== */

const db = firebase.firestore();
const auth = firebase.auth();
const APPLICATIONS_COLLECTION = "applications";
const STAGES = ["Submitted", "Processing", "Document Verified", "Visa Approved"];
const STAGE_BADGE_CLASSES = ["status-processing", "status-processing", "status-verified", "status-approved"];

/* Max width/height (px) uploaded images are resized to before being
   stored as base64 in Firestore, and the JPEG quality used. This keeps
   each document comfortably under Firestore's 1MB per-document limit. */
const IMG_MAX_DIMENSION = 1280;
const IMG_QUALITY = 0.7;

/* Shared store for files selected on the Apply form before they're read into the record on submit */
let uploadedFileStore = [];

/* Tracks which application is currently open in the admin "Manage" modal */
let activeModalAppId = null;

/* Unsubscribe handle for the admin dashboard's live Firestore listener */
let adminUnsubscribe = null;

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

function getApplication(id) {
  return db.collection(APPLICATIONS_COLLECTION).doc(id).get()
    .then((snap) => (snap.exists ? snap.data() : null));
}

/* Creates a NEW application only — fails (by security rule) if the ID already exists.
   Used by the public Apply form so no one can overwrite someone else's record. */
function createApplication(id, record) {
  return db.collection(APPLICATIONS_COLLECTION).doc(id).set(record);
}

/* Admin-only partial update of an existing application. */
function updateApplication(id, partial) {
  return db.collection(APPLICATIONS_COLLECTION).doc(id).set(partial, { merge: true });
}

function deleteApplicationDoc(id) {
  return db.collection(APPLICATIONS_COLLECTION).doc(id).delete();
}

function getDocumentsSubcollection(appId) {
  return db.collection(APPLICATIONS_COLLECTION).doc(appId).collection("documents");
}

function addDocumentRecord(appId, doc) {
  return getDocumentsSubcollection(appId).doc(doc.id).set(doc);
}

function deleteDocumentRecord(appId, docId) {
  return getDocumentsSubcollection(appId).doc(docId).delete();
}

function getDocumentsForApp(appId) {
  return getDocumentsSubcollection(appId).orderBy("uploadedAt").get()
    .then((snap) => snap.docs.map((d) => d.data()));
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

/* Reads an array of File objects into storable document records.
   Images are resized/compressed via <canvas> before being converted to
   base64 so each document comfortably fits Firestore's 1MB doc limit.
   Non-images (e.g. PDFs) are stored as-is; very large PDFs may fail to
   save — the UI warns the user in that case. */
function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > IMG_MAX_DIMENSION || height > IMG_MAX_DIMENSION) {
        const scale = IMG_MAX_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", IMG_QUALITY));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Image could not be loaded for compression"));
    };
    img.src = objectUrl;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readFilesAsDocuments(files) {
  const reads = files.map(async (file) => {
    const isImage = (file.type || "").startsWith("image/");
    const dataUrl = isImage ? await compressImageFile(file) : await readFileAsDataUrl(file);
    // Rough byte size of the resulting base64 string (for the size label + a safety check)
    const approxBytes = Math.round((dataUrl.length * 3) / 4);
    return {
      id: "doc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      name: file.name,
      type: file.type || "application/octet-stream",
      size: approxBytes,
      dataUrl,
      uploadedAt: Date.now()
    };
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

    // আপলোড করা ফাইলগুলো (কম্প্রেসড) base64 ডকুমেন্টে রূপান্তর করা হচ্ছে
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
      documentCount: documents.length,
      manualStatus: null,   // null = সয়ংক্রিয় (সময়-ভিত্তিক); অ্যাডমিন চাইলে এটা ওভাররাইড করতে পারবে
      statusNote: "",
      internalNotes: ""
    };

    try {
      // পাসপোর্ট নাম্বার দিয়ে Firestore-এ নতুন অ্যাপ্লিকেশন তৈরি হচ্ছে
      // (একই আইডি আগে থেকে থাকলে সিকিউরিটি রুলস এটা আটকে দেবে)
      await createApplication(trackingId, record);

      // প্রতিটি ডকুমেন্ট আলাদা সাব-ডকুমেন্ট হিসেবে সেভ হচ্ছে (Firestore-এর 1MB লিমিট এড়াতে)
      for (const doc of documents) {
        try {
          await addDocumentRecord(trackingId, doc);
        } catch (docErr) {
          console.error("Document save error:", docErr);
        }
      }
    } catch (err) {
      console.error("Application save error:", err);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
      if (err && err.code === "permission-denied") {
        alert("এই পাসপোর্ট নাম্বার দিয়ে ইতিমধ্যে একটি আবেদন জমা আছে, অথবা সার্ভার অনুমতি দিচ্ছে না। দয়া করে পাসপোর্ট নাম্বার চেক করুন।");
      } else {
        alert("আবেদনটি সংরক্ষণ করা যায়নি। ইন্টারনেট সংযোগ চেক করে আবার চেষ্টা করুন।");
      }
      return;
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

  const runLookup = async () => {
    const id = input.value.trim().toUpperCase(); // ইউজার পাসপোর্ট টাইপ করলে তা রিড করবে
    if (errorMsg) errorMsg.classList.remove("show");
    if (!id) return;

    lookupBtn.disabled = true;
    const originalLabel = lookupBtn.textContent;
    lookupBtn.textContent = "Checking...";

    try {
      const record = await findApplication(id);
      if (!record) {
        if (errorMsg) errorMsg.classList.add("show");
        return;
      }
      renderDashboard(record);
    } catch (err) {
      console.error("Lookup error:", err);
      if (errorMsg) errorMsg.classList.add("show");
    } finally {
      lookupBtn.disabled = false;
      lookupBtn.textContent = originalLabel;
    }
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

async function findApplication(id) {
  if (!id) return null;

  // ব্যাকআপ ডেমো রেকর্ড (আগের মতোই কাজ করবে, কোনো Firestore কল ছাড়াই)
  if (id === "CTX-2026-3381") {
    return {
      id: "CTX-2026-3381",
      name: "Wei Chen",
      visaType: "Work Permit",
      submittedAt: Date.now() - 8 * 60000
    };
  }

  const record = await getApplication(id); // পাসপোর্ট নাম্বার দিয়ে Firestore-এ সার্চ
  return record || null;
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
   Real authentication via Firebase Authentication (email/password).
   Create the admin user in Firebase Console > Authentication > Users.
   Firestore security rules restrict write/delete/list access to
   signed-in users only — see FIRESTORE_RULES.txt.
=========================================================== */

function initAdminLogin() {
  const form = document.getElementById("adminLoginForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("adminUser").value.trim();
    const pass = document.getElementById("adminPass").value;
    const errorMsg = document.getElementById("adminError");
    const submitBtn = form.querySelector('button[type="submit"]');

    if (errorMsg) errorMsg.classList.remove("show");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Signing in..."; }

    try {
      await auth.signInWithEmailAndPassword(email, pass);
      window.location.href = "admin-dashboard.html";
    } catch (err) {
      console.error("Admin login error:", err);
      if (errorMsg) errorMsg.classList.add("show");
      form.classList.add("shake");
      setTimeout(() => form.classList.remove("shake"), 400);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Sign In"; }
    }
  });
}

function initAdminDashboard() {
  const tableBody = document.getElementById("adminTableBody");
  if (!tableBody) return;

  // Gate: bounce non-authenticated visitors straight back to login.
  // onAuthStateChanged fires once Firebase resolves the current session.
  auth.onAuthStateChanged((user) => {
    if (!user) {
      if (adminUnsubscribe) { adminUnsubscribe(); adminUnsubscribe = null; }
      window.location.href = "admin-login.html";
      return;
    }
    startAdminDashboard();
  });
}

function startAdminDashboard() {
  const logoutBtn = document.getElementById("adminLogoutBtn");
  if (logoutBtn && !logoutBtn.dataset.bound) {
    logoutBtn.dataset.bound = "1";
    logoutBtn.addEventListener("click", () => {
      if (adminUnsubscribe) { adminUnsubscribe(); adminUnsubscribe = null; }
      auth.signOut().then(() => { window.location.href = "admin-login.html"; });
    });
  }

  const searchInput = document.getElementById("adminSearch");
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("input", () => renderAdminTable(searchInput.value.trim().toLowerCase()));
  }

  initAppModal();

  // Real-time listener: any change made from ANY device (new application,
  // status update, deletion) is reflected here instantly, without a refresh.
  if (adminUnsubscribe) adminUnsubscribe();
  adminUnsubscribe = db.collection(APPLICATIONS_COLLECTION)
    .onSnapshot(
      (snapshot) => {
        const records = snapshot.docs.map((d) => d.data());
        window.__latestAdminRecords = records;
        renderAdminTable(document.getElementById("adminSearch")?.value.trim().toLowerCase() || "");
      },
      (err) => console.error("Admin live listener error:", err)
    );
}

function renderAdminTable(query) {
  const tableBody = document.getElementById("adminTableBody");
  const emptyState = document.getElementById("adminEmpty");
  if (!tableBody) return;

  const allRecords = window.__latestAdminRecords || [];
  let records = allRecords.slice().sort((a, b) => b.submittedAt - a.submittedAt);

  if (query) {
    records = records.filter((r) =>
      (r.name || "").toLowerCase().includes(query) ||
      (r.passport || "").toLowerCase().includes(query)
    );
  }

  // Update summary stat cards (always reflect the full, unfiltered dataset)
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
    const docCount = r.documentCount || 0;
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
    btn.addEventListener("click", async () => {
      if (!confirm("Permanently delete this application and all its documents? This cannot be undone.")) return;
      btn.disabled = true;
      try {
        await deleteAllDocuments(btn.dataset.id);
        await deleteApplicationDoc(btn.dataset.id);
        // onSnapshot listener re-renders the table automatically
      } catch (err) {
        console.error("Delete error:", err);
        alert("মুছে ফেলা যায়নি। আবার চেষ্টা করুন।");
        btn.disabled = false;
      }
    });
  });
}

async function deleteAllDocuments(appId) {
  const snap = await getDocumentsSubcollection(appId).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  if (!snap.empty) await batch.commit();
}

/* ---------- Admin: Application Detail / Manage Modal ---------- */

function initAppModal() {
  const overlay = document.getElementById("appModalOverlay");
  if (!overlay || overlay.dataset.bound) return;
  overlay.dataset.bound = "1";

  const closeModal = () => closeAppModal();
  document.getElementById("modalCloseBtn")?.addEventListener("click", closeModal);
  document.getElementById("modalCloseBtn2")?.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("show")) closeModal();
  });

  document.getElementById("miSaveStatusBtn")?.addEventListener("click", async () => {
    if (!activeModalAppId) return;
    const btn = document.getElementById("miSaveStatusBtn");
    const selectVal = document.getElementById("miStatusSelect").value;
    const manualStatus = selectVal === "auto" ? null : (selectVal === "rejected" ? "rejected" : Number(selectVal));
    const statusNote = document.getElementById("miStatusNote").value.trim();

    btn.disabled = true;
    try {
      await updateApplication(activeModalAppId, {
        manualStatus,
        statusNote,
        lastUpdated: Date.now()
      });
      flashSaved("miSaveStatusBtn", "Status Updated");
    } catch (err) {
      console.error("Status save error:", err);
      alert("সেভ করা যায়নি। আবার চেষ্টা করুন।");
      btn.disabled = false;
    }
  });

  document.getElementById("miSaveNotesBtn")?.addEventListener("click", async () => {
    if (!activeModalAppId) return;
    const btn = document.getElementById("miSaveNotesBtn");
    const internalNotes = document.getElementById("miInternalNotes").value.trim();

    btn.disabled = true;
    try {
      await updateApplication(activeModalAppId, {
        internalNotes,
        lastUpdated: Date.now()
      });
      flashSaved("miSaveNotesBtn", "Notes Saved");
    } catch (err) {
      console.error("Notes save error:", err);
      alert("সেভ করা যায়নি। আবার চেষ্টা করুন।");
      btn.disabled = false;
    }
  });

  document.getElementById("miAddDocInput")?.addEventListener("change", async (e) => {
    if (!activeModalAppId) return;
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    try {
      const newDocs = await readFilesAsDocuments(files);
      for (const doc of newDocs) {
        await addDocumentRecord(activeModalAppId, doc);
      }
      const existingDocs = await getDocumentsForApp(activeModalAppId);
      await updateApplication(activeModalAppId, {
        documentCount: existingDocs.length,
        lastUpdated: Date.now()
      });
      await refreshModal(activeModalAppId);
    } catch (err) {
      console.error(err);
      alert("ডকুমেন্ট যোগ করা যায়নি, হয়তো ফাইলটি অনেক বড়।");
    }
    e.target.value = "";
  });

  document.getElementById("miDeleteAppBtn")?.addEventListener("click", async () => {
    if (!activeModalAppId) return;
    if (!confirm("Permanently delete this application and all its documents? This cannot be undone.")) return;
    try {
      await deleteAllDocuments(activeModalAppId);
      await deleteApplicationDoc(activeModalAppId);
      closeAppModal();
      // onSnapshot listener re-renders the table automatically
    } catch (err) {
      console.error("Delete error:", err);
      alert("মুছে ফেলা যায়নি। আবার চেষ্টা করুন।");
    }
  });
}

async function openAppModal(id) {
  const record = await getApplication(id);
  if (!record) return;

  activeModalAppId = id;
  const overlay = document.getElementById("appModalOverlay");
  if (overlay) overlay.classList.add("show");

  await refreshModal(id, record);
}

async function refreshModal(id, preloadedRecord) {
  const record = preloadedRecord || await getApplication(id);
  if (!record) return;
  const docs = await getDocumentsForApp(id);
  populateModal(record, docs);
}

function closeAppModal() {
  activeModalAppId = null;
  const overlay = document.getElementById("appModalOverlay");
  if (overlay) overlay.classList.remove("show");
}

function populateModal(record, docs) {
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

  renderModalDocs(docs || []);
}

function renderModalDocs(docs) {
  const grid = document.getElementById("miDocGrid");
  if (!grid) return;

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
    btn.addEventListener("click", async () => {
      if (!activeModalAppId) return;
      if (!confirm("Delete this document?")) return;
      try {
        await deleteDocumentRecord(activeModalAppId, btn.dataset.docId);
        const remainingDocs = await getDocumentsForApp(activeModalAppId);
        await updateApplication(activeModalAppId, {
          documentCount: remainingDocs.length,
          lastUpdated: Date.now()
        });
        await refreshModal(activeModalAppId);
      } catch (err) {
        console.error("Document delete error:", err);
        alert("ডকুমেন্ট মুছা যায়নি। আবার চেষ্টা করুন।");
      }
    });
  });
}

function flashSaved(btnId, message) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = message;
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
