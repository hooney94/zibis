import { DB_PATHS } from "./config.js";
import { $, formatPhoneToE164 } from "./utils.js";

const CATEGORIES_BY_VENDOR = {
  hanssem: ["매립등", "메인등", "라인등", "마그네틱", "기타"],
  zibis: ["매립등", "라인등", "통신기기"],
};

function categoriesForVendor(vendor, catalogMap) {
  const preset = CATEGORIES_BY_VENDOR[vendor];
  if (preset && preset.length) return preset;
  const keys = Object.keys(catalogMap?.[vendor] || {});
  return keys.length ? keys : ["기타"];
}

function svgUri(label) {
  const safe = (label || "").replace(/[<>&"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="100%" height="100%" rx="24" ry="24" fill="#f3f4f6"/>
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
      font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="34" fill="#111827">${safe}</text>
  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// 초기 DB가 비었을 때만 fallback
const DEFAULT_CATALOG = {
  hanssem: {
    매립등: [{ id: "h-recess-01", name: "리바트 매립등 A", img: svgUri("리바트 매립등 A"), orderCode: "" }],
    메인등: [{ id: "h-main-01", name: "리바트 메인등 A", img: svgUri("리바트 메인등 A"), orderCode: "" }],
    라인등: [{ id: "h-line-01", name: "리바트 라인등 A", img: svgUri("리바트 라인등 A"), orderCode: "" }],
    마그네틱: [{ id: "h-mag-01", name: "리바트 마그네틱 A", img: svgUri("리바트 마그네틱 A"), orderCode: "" }],
    기타: [{ id: "h-etc-01", name: "리바트 기타 상품", img: svgUri("리바트 기타"), orderCode: "" }],
  },
  zibis: {
    매립등: [{ id: "z-recess-01", name: "지비스 매립등 A", img: svgUri("지비스 매립등 A"), orderCode: "" }],
    라인등: [{ id: "z-line-01", name: "지비스 라인등 A", img: svgUri("지비스 라인등 A"), orderCode: "" }],
    통신기기: [{ id: "z-comm-01", name: "지비스 통신기기 A", img: svgUri("지비스 통신기기 A"), orderCode: "" }],
  },
};

const clamp = (n, min, max) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
};

function setSelectedByData(containerEl, attr, value) {
  containerEl.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("selected", b.getAttribute(attr) === value);
  });
}

function sumObjValues(obj) {
  return Object.values(obj).reduce((a, b) => a + (Number(b) || 0), 0);
}

function normalizeCatalogFromDb(val) {
  if (!val) return null;
  const itemsObj = (val.items && typeof val.items === "object") ? val.items : val;
  if (!itemsObj || typeof itemsObj !== "object") return null;

  const map = { hanssem: {}, zibis: {} };
  for (const [id, r] of Object.entries(itemsObj)) {
    const vendor = r.vendor || "hanssem";
    const defaultCat = (CATEGORIES_BY_VENDOR[vendor] && CATEGORIES_BY_VENDOR[vendor][0]) ? CATEGORIES_BY_VENDOR[vendor][0] : "기타";
    const category = r.category || defaultCat;
    const name = r.name || "";
    const image = r.image || (r.img ? { type: "url", value: r.img } : null);
    const img = (image && image.value) ? image.value : svgUri(name || "상품");

    if (!map[vendor]) map[vendor] = {};
    if (!map[vendor][category]) map[vendor][category] = [];
    map[vendor][category].push({
      id,
      name,
      img,
      orderCode: r.orderCode || "",
      prices: r.prices || {},
    });
  }
  return map;
}

function keyOf(vendor, productId) {
  return `${vendor}:${productId}`;
}

export function mountCustomer({ rootEl, db, auth }) {
  return fetch("./partials/customer.html")
    .then((r) => r.text())
    .then((html) => {
      rootEl.innerHTML = html;
      wireCustomer({ rootEl, db, auth });
    });
}

function wireCustomer({ rootEl, db, auth }) {
  // ---- Elements (A)
  const statusEl = $("#status", rootEl);
  const phoneStatusEl = $("#phoneStatus", rootEl);

  // ---- Elements (B)
  const activationGroup = $("#activationGroup", rootEl);
  const activationHint = $("#activationHint", rootEl);

  const vendorGroup = $("#vendorGroup", rootEl);
  const vendorHint = $("#vendorHint", rootEl);

  const categoryWrap = $("#categoryWrap", rootEl);
  const categoryGroup = $("#categoryGroup", rootEl);

  const productWrap = $("#productWrap", rootEl);
  const productGrid = $("#productGrid", rootEl);
  const productHint = $("#productHint", rootEl);

  const productSearchEl = $("#productSearch", rootEl);
  const searchHintEl = $("#searchHint", rootEl);

  // ---- Elements (C)
  const switchGrid = $("#switchGrid", rootEl);
  const thirdPartyGrid = $("#thirdPartyGrid", rootEl);

  // ---- Summary / Buttons
  const summaryBox = $("#summaryBox", rootEl);
  const resetEstimateBtn = $("#resetEstimateBtn", rootEl);
  const exportExcelBtn = $("#exportExcelBtn", rootEl);

  // ---- Elements (견적 결과)
  const installAreaEl = $("#installAreaPyeong", rootEl);
  const estimateResultBox = $("#estimateResultBox", rootEl);
  const sumLightingEl = $("#sumLighting", rootEl);
  const sumInstallEl = $("#sumInstall", rootEl);
  const sumSmartHomeEl = $("#sumSmartHome", rootEl);
  const orderCodeEl = $("#orderCode", rootEl);
  const orderCodeToggleEl = $("#orderCodeToggle", rootEl);
  const orderCodeChevronEl = $("#orderCodeChevron", rootEl);

  // ---- State
  const state = {
    phoneVerified: false,
    confirmationResult: null,
    recaptchaVerifier: null,

    activation: null,     // yes/no
    vendor: null,         // 현재 둘러보는 vendor
    category: null,       // 현재 둘러보는 category
    searchQuery: "",

    // ✅ 장바구니: vendor:id -> qty
    quantities: {},

    catalogMap: DEFAULT_CATALOG,
    // key(vendor:id) -> meta
    productIndex: {},

    switchCounts: { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 },
    thirdPartyGangTotal: 0,

    // ✅ 기본 단가(관리자 설정)
    pricing: null,
    // ✅ 스마트홈 세팅비 계산용 시공 평수
    installAreaPyeong: 0,

    orderCodeVisible: false,
  };

  function rebuildIndex() {
    const idx = {};
    const m = state.catalogMap || DEFAULT_CATALOG;
    for (const vendor of Object.keys(m || {})) {
      for (const category of Object.keys(m[vendor] || {})) {
        for (const p of (m[vendor][category] || [])) {
          const k = keyOf(vendor, p.id);
          idx[k] = {
            vendor,
            category,
            id: p.id,
            name: p.name || "",
            img: p.img || svgUri(p.name || "상품"),
            orderCode: p.orderCode || "",
          };
        }
      }
    }
    state.productIndex = idx;
  }

  function allProductsFlat() {
    const out = [];
    const m = state.catalogMap || DEFAULT_CATALOG;
    for (const vendor of Object.keys(m || {})) {
      for (const category of Object.keys(m[vendor] || {})) {
        for (const p of (m[vendor][category] || [])) {
          out.push({
            vendor,
            category,
            id: p.id,
            name: p.name || "",
            img: p.img || svgUri(p.name || "상품"),
            orderCode: p.orderCode || "",
          });
        }
      }
    }
    return out;
  }

  function getProducts(vendor, category) {
    const v = state.catalogMap || DEFAULT_CATALOG;
    return v?.[vendor]?.[category] ?? [];
  }

  function applyCatalog(val) {
    state.catalogMap = normalizeCatalogFromDb(val) || DEFAULT_CATALOG;
    rebuildIndex();

    // UI 갱신
    if (state.vendor) {
      renderCategories();
      categoryWrap.style.display = "block";
    }
    renderProducts(); // 검색어가 있으면 전체검색, 없으면 vendor/category 기반
    updateAreaLock();
    refreshSummary();
    updateProductHint();
  }

  const catalogRef = db.ref(`${DB_PATHS.catalog}/items`);
  try {
    catalogRef.on(
      "value",
      (snap) => applyCatalog(snap.val()),
      (err) => console.error("catalog subscribe error:", err)
    );
  } catch (e) {
    console.error(e);
    state.catalogMap = DEFAULT_CATALOG;
    rebuildIndex();
  }

  /* ---------- Pricing subscribe (기본 단가) ---------- */
  const DEFAULT_PRICING = {
    activationFee: { dealer: 200000, retail: 244600 },
    installPerPyeong: { dealer: "", retail: "" },
    constructionPerPyeong: { dealer: "", retail: "" },
    installCostPerItem: {
      main: { dealer: "", retail: "" },
      recess: { dealer: "", retail: "" },
      line: { dealer: "", retail: "" },
    },
    switchGang: { dealer: 45400, retail: 55600 },
    thirdPartyGang: { dealer: 15000, retail: 20000 },
  };

  function normalizePricingFromDb(v) {
    if (!v) return { ...DEFAULT_PRICING };

    // 신규 스키마
    if (v.activationFee?.dealer !== undefined || v.installPerPyeong) {
      return {
        activationFee: {
          dealer: v.activationFee?.dealer ?? "",
          retail: v.activationFee?.retail ?? "",
        },
        installPerPyeong: {
          dealer: v.installPerPyeong?.dealer ?? "",
          retail: v.installPerPyeong?.retail ?? "",
        },
        constructionPerPyeong: {
          dealer: v.constructionPerPyeong?.dealer ?? "",
          retail: v.constructionPerPyeong?.retail ?? "",
        },
        installCostPerItem: {
          main: { dealer: v.installCostPerItem?.main?.dealer ?? "", retail: v.installCostPerItem?.main?.retail ?? "" },
          recess: { dealer: v.installCostPerItem?.recess?.dealer ?? "", retail: v.installCostPerItem?.recess?.retail ?? "" },
          line: { dealer: v.installCostPerItem?.line?.dealer ?? "", retail: v.installCostPerItem?.line?.retail ?? "" },
        },
        switchGang: {
          dealer: v.switchGang?.dealer ?? "",
          retail: v.switchGang?.retail ?? "",
        },
        thirdPartyGang: {
          dealer: v.thirdPartyGang?.dealer ?? "",
          retail: v.thirdPartyGang?.retail ?? "",
        },
      };
    }

    // 레거시(A/B/C/D)
    const pickDealer = (obj) => obj?.A ?? obj?.C ?? "";
    const pickRetail = (obj) => obj?.B ?? obj?.D ?? "";
    return {
      activationFee: { dealer: pickDealer(v.activationFee), retail: pickRetail(v.activationFee) },
      installPerPyeong: { dealer: "", retail: "" },
      constructionPerPyeong: { dealer: "", retail: "" },
      installCostPerItem: { main: { dealer: "", retail: "" }, recess: { dealer: "", retail: "" }, line: { dealer: "", retail: "" } },
      switchGang: { dealer: pickDealer(v.switchGang), retail: pickRetail(v.switchGang) },
      thirdPartyGang: { dealer: pickDealer(v.thirdPartyGang), retail: pickRetail(v.thirdPartyGang) },
    };
  }

  const pricingRef = db.ref(DB_PATHS.pricing);
  try {
    pricingRef.on(
      "value",
      (snap) => {
        state.pricing = normalizePricingFromDb(snap.val() || null);
        updateAreaLock();
        refreshEstimateResult();
      },
      (err) => console.error("pricing subscribe error:", err)
    );
  } catch (e) {
    console.error(e);
    state.pricing = { ...DEFAULT_PRICING };
  }

  function anyPositive(v){ const n = Number(v); return Number.isFinite(n) && n > 0; }

  function updateAreaLock() {
    const p = state.pricing || {};
    const perUsed =
      anyPositive(p.installPerPyeong?.dealer) || anyPositive(p.installPerPyeong?.retail) ||
      anyPositive(p.constructionPerPyeong?.dealer) || anyPositive(p.constructionPerPyeong?.retail);

    const hint = $("#installAreaHint", rootEl);
    if (!perUsed) {
      state.installAreaPyeong = 0;
      installAreaEl.value = "";
      installAreaEl.disabled = true;
      if (hint) hint.textContent = "1평당 단가가 설정되지 않아 입력이 잠겨있습니다.";
    } else {
      installAreaEl.disabled = false;
      if (hint) hint.textContent = "1평당 단가가 설정된 경우에만 입력 가능합니다.";
    }
  }

  /* ---------- 시공 평수 ---------- */
  installAreaEl.addEventListener("input", () => {
    if (installAreaEl.disabled) return;
    state.installAreaPyeong = Number(installAreaEl.value || 0);
    refreshEstimateResult();
  });

  /* ---------- 발주 코드 토글(기본 숨김) ---------- */
  if (orderCodeToggleEl) {
    orderCodeEl.classList.add("hidden");
    if (orderCodeChevronEl) orderCodeChevronEl.classList.remove("open");
    state.orderCodeVisible = false;

    orderCodeToggleEl.addEventListener("click", () => {
      state.orderCodeVisible = !state.orderCodeVisible;
      orderCodeEl.classList.toggle("hidden", !state.orderCodeVisible);
      if (orderCodeChevronEl) orderCodeChevronEl.classList.toggle("open", state.orderCodeVisible);
    });
  }

  /* ---------- A: 고객정보/인증 ---------- */
  $("#addrSearchBtn", rootEl).addEventListener("click", () => {
    new daum.Postcode({
      oncomplete: (data) => {
        $("#addrMain", rootEl).value = data.roadAddress || data.address;
        $("#addrDetail", rootEl).focus();
      },
    }).open();
  });

  function initRecaptcha() {
    if (!state.recaptchaVerifier) {
      state.recaptchaVerifier = new firebase.auth.RecaptchaVerifier("recaptcha-container", { size: "invisible" });
      state.recaptchaVerifier.render();
    }
  }

  $("#sendCodeBtn", rootEl).addEventListener("click", async () => {
    statusEl.textContent = "";
    phoneStatusEl.style.display = "none";
    state.phoneVerified = false;

    const phone = $("#phone", rootEl).value.trim();
    const e164 = formatPhoneToE164(phone);
    if (!e164) return alert("휴대폰 번호를 정확히 입력해 주세요.");

    try {
      initRecaptcha();
      statusEl.textContent = "인증번호 발송 중입니다...";
      state.confirmationResult = await auth.signInWithPhoneNumber(e164, state.recaptchaVerifier);
      statusEl.textContent = "인증번호가 발송되었습니다.";
    } catch (e) {
      console.error(e);
      statusEl.textContent = "인증번호 발송 중 오류가 발생했습니다.";
      alert("인증번호 발송 실패");
    }
  });

  $("#confirmCodeBtn", rootEl).addEventListener("click", async () => {
    if (!state.confirmationResult) return alert("먼저 인증번호를 발송해 주세요.");
    const code = $("#verifyCode", rootEl).value.trim();
    if (!code) return alert("인증번호를 입력해 주세요.");

    try {
      statusEl.textContent = "인증 확인 중입니다...";
      await state.confirmationResult.confirm(code);
      state.phoneVerified = true;
      phoneStatusEl.style.display = "inline-flex";
      statusEl.textContent = "휴대폰 인증이 완료되었습니다.";
      refreshSummary();
    } catch (e) {
      console.error(e);
      statusEl.textContent = "인증번호가 올바르지 않습니다.";
      alert("인증번호가 올바르지 않습니다.");
    }
  });

  /* ---------- B: 발주/옵션 ---------- */
  activationGroup.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn) return;
    state.activation = btn.getAttribute("data-value");
    setSelectedByData(activationGroup, "data-value", state.activation);
    activationHint.textContent = state.activation === "yes" ? "YES 선택됨" : "NO 선택됨";
    refreshSummary();
  });

  // ✅ 검색창은 항상 노출되어 있으니, 입력하면 즉시 전체 검색 결과를 보여줌
  productSearchEl.addEventListener("input", () => {
    state.searchQuery = (productSearchEl.value || "").trim();
    renderProducts();
  });

  vendorGroup.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-vendor]");
    if (!btn) return;

    state.vendor = btn.getAttribute("data-vendor");
    setSelectedByData(vendorGroup, "data-vendor", state.vendor);

    const allowed = categoriesForVendor(state.vendor, state.catalogMap || DEFAULT_CATALOG);
    if (state.category && !allowed.includes(state.category)) state.category = null;
    vendorHint.textContent = state.vendor === "hanssem" ? "리바트 운영제품 선택됨" : "지비스 자체상품 선택됨";

    renderCategories();
    categoryWrap.style.display = "block";

    renderProducts();
    refreshSummary();
    updateProductHint();
  });

  categoryGroup.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-category]");
    if (!btn) return;

    state.category = btn.getAttribute("data-category");
    setSelectedByData(categoryGroup, "data-category", state.category);

    renderProducts();
    refreshSummary();
    updateProductHint();
  });

  function renderCategories() {
    categoryGroup.innerHTML = "";
    const cats = categoriesForVendor(state.vendor, state.catalogMap || DEFAULT_CATALOG);
    cats.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-outline";
      b.textContent = c;
      b.setAttribute("data-category", c);
      categoryGroup.appendChild(b);
    });
    if (state.category) setSelectedByData(categoryGroup, "data-category", state.category);
  }

  function renderProducts() {
    const q = (state.searchQuery || "").toLowerCase();

    // ✅ 검색어가 있으면: 전체 상품 검색
    if (q) {
      const all = allProductsFlat();
      const filtered = all.filter((p) => {
        const name = (p.name || "").toLowerCase();
        const code = (p.orderCode || "").toLowerCase();
        return name.includes(q) || code.includes(q);
      });

      productWrap.style.display = "block";
      productGrid.innerHTML = "";
      searchHintEl.textContent = `전체 검색 결과: ${filtered.length}개 / 전체 ${all.length}개`;

      if (!filtered.length) {
        productGrid.innerHTML = `<div class="hint">검색 결과가 없습니다.</div>`;
        updateProductHint();
        return;
      }

      filtered.forEach((p) => renderProductCard(p, true));
      updateProductHint();
      return;
    }

    // ✅ 검색어가 없으면: 기존 흐름(선택한 vendor+category)
    searchHintEl.textContent = "검색어를 입력하면 발주처/상품군 선택 없이도 전체 상품에서 검색됩니다.";

    if (!state.vendor || !state.category) {
      productWrap.style.display = "none";
      productGrid.innerHTML = "";
      return;
    }

    const products = getProducts(state.vendor, state.category).map((p) => ({
      vendor: state.vendor,
      category: state.category,
      id: p.id,
      name: p.name || "",
      img: p.img || svgUri(p.name || "상품"),
      orderCode: p.orderCode || "",
    }));

    productWrap.style.display = "block";
    productGrid.innerHTML = "";

    if (!products.length) {
      productGrid.innerHTML = `<div class="hint">등록된 상품이 없습니다. (관리자에서 품목을 추가해 주세요)</div>`;
      updateProductHint();
      return;
    }

    products.forEach((p) => renderProductCard(p, false));
    updateProductHint();
  }

  function renderProductCard(p, showBadges) {
    const card = document.createElement("div");
    card.className = "card";
    card.style.padding = "12px";
    card.style.marginBottom = "0";

    const img = document.createElement("img");
    img.className = "product-img";
    img.src = p.img || svgUri(p.name);
    img.alt = p.name;

    const title = document.createElement("div");
    title.style.marginTop = "8px";
    title.style.fontSize = "13px";
    title.style.fontWeight = "600";
    title.textContent = p.name;

    const badges = document.createElement("div");
    badges.className = "product-badges";
    badges.style.display = showBadges ? "flex" : "none";

    const vb = document.createElement("span");
    vb.className = "product-badge";
    vb.textContent = p.vendor === "hanssem" ? "리바트" : "지비스";

    const cb = document.createElement("span");
    cb.className = "product-badge";
    cb.textContent = p.category || "기타";

    badges.appendChild(vb);
    badges.appendChild(cb);

    const code = document.createElement("div");
    code.style.marginTop = "4px";
    code.style.fontSize = "12px";
    code.style.color = "#6b7280";
    code.textContent = p.orderCode ? `발주코드: ${p.orderCode}` : "";

    const qtyRow = document.createElement("div");
    qtyRow.className = "qty-row";

    const qtyInput = document.createElement("input");
    qtyInput.className = "qty-input";
    qtyInput.type = "number";
    qtyInput.min = "0";
    qtyInput.max = "999";

    const k = keyOf(p.vendor, p.id);
    qtyInput.value = String(state.quantities[k] ?? 0);

    const syncQty = (next) => {
      state.quantities[k] = clamp(next, 0, 999);
      qtyInput.value = String(state.quantities[k]);
      updateProductHint();
      refreshSummary();
    };

    qtyInput.addEventListener("input", () => syncQty(qtyInput.value));

    const buttons = document.createElement("div");
    buttons.className = "qty-buttons";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "btn-outline";
    minus.textContent = "−";
    minus.addEventListener("click", () => syncQty((state.quantities[k] ?? 0) - 1));

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "btn-outline";
    plus.textContent = "+";
    plus.addEventListener("click", () => syncQty((state.quantities[k] ?? 0) + 1));

    buttons.appendChild(minus);
    buttons.appendChild(plus);

    qtyRow.appendChild(qtyInput);
    qtyRow.appendChild(buttons);

    card.appendChild(img);
    card.appendChild(title);
    if (showBadges) card.appendChild(badges);
    if (p.orderCode) card.appendChild(code);
    card.appendChild(qtyRow);

    productGrid.appendChild(card);
  }

  function selectedItemsAll() {
    const items = [];
    for (const [k, qtyVal] of Object.entries(state.quantities)) {
      const qty = Number(qtyVal || 0);
      if (qty <= 0) continue;

      const meta = state.productIndex[k];
      if (!meta) continue;

      items.push({
        key: k,
        vendor: meta.vendor,
        category: meta.category,
        productId: meta.id,
        name: meta.name,
        orderCode: meta.orderCode,
        qty,
      });
    }
    items.sort((a, b) => (a.vendor + a.category + a.name).localeCompare(b.vendor + b.category + b.name, "ko"));
    return items;
  }

  function updateProductHint() {
    const total = sumObjValues(state.quantities);
    productHint.textContent = total > 0 ? `현재 선택 수량 합계(전체): ${total}` : "수량을 1개 이상 선택해 주세요.";
  }

  /* ---------- C: 회로 설계 ---------- */
  function renderSwitches() {
    switchGrid.innerHTML = "";
    for (let g = 1; g <= 6; g++) {
      const card = document.createElement("div");
      card.className = "card";
      card.style.marginBottom = "0";
      card.style.padding = "12px";

      const title = document.createElement("div");
      title.className = "section-title";
      title.style.marginBottom = "8px";
      title.textContent = `${g}구 스위치`;

      const row = document.createElement("div");
      row.className = "qty-row";
      row.style.justifyContent = "flex-start";

      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "btn-outline";
      minus.textContent = "−";

      const input = document.createElement("input");
      input.className = "qty-input";
      input.type = "number";
      input.min = "0";
      input.max = "999";
      input.value = String(state.switchCounts[g]);

      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "btn-outline";
      plus.textContent = "+";

      const sync = () => {
        input.value = String(state.switchCounts[g]);
        refreshSummary();
      };

      minus.addEventListener("click", () => {
        state.switchCounts[g] = clamp(state.switchCounts[g] - 1, 0, 999);
        sync();
      });
      plus.addEventListener("click", () => {
        state.switchCounts[g] = clamp(state.switchCounts[g] + 1, 0, 999);
        sync();
      });
      input.addEventListener("input", () => {
        state.switchCounts[g] = clamp(input.value, 0, 999);
        sync();
      });

      row.appendChild(minus);
      row.appendChild(input);
      row.appendChild(plus);

      card.appendChild(title);
      card.appendChild(row);
      switchGrid.appendChild(card);
    }
  }

  // ✅ UI 수정: "구수" 라벨 제거 + 스위치 카드와 동일한 스타일/여백
  function renderThirdPartyCard() {
    if (!thirdPartyGrid) return;
    thirdPartyGrid.innerHTML = "";

    const card = document.createElement("div");
    card.className = "card";
    card.style.marginBottom = "0";
    card.style.padding = "12px";

    const title = document.createElement("div");
    title.className = "section-title";
    title.style.marginBottom = "8px";
    title.textContent = "사제 스위치 구수 합계";

    const row = document.createElement("div");
    row.className = "qty-row";
    row.style.justifyContent = "flex-start";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "btn-outline";
    minus.textContent = "−";

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "999";
    input.className = "qty-input";
    input.value = String(state.thirdPartyGangTotal || 0);

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "btn-outline";
    plus.textContent = "+";

    const sync = () => {
      input.value = String(state.thirdPartyGangTotal || 0);
      refreshSummary();
    };

    minus.addEventListener("click", () => {
      state.thirdPartyGangTotal = clamp((state.thirdPartyGangTotal || 0) - 1, 0, 999);
      sync();
    });
    plus.addEventListener("click", () => {
      state.thirdPartyGangTotal = clamp((state.thirdPartyGangTotal || 0) + 1, 0, 999);
      sync();
    });
    input.addEventListener("input", () => {
      state.thirdPartyGangTotal = clamp(input.value, 0, 999);
      sync();
    });

    row.appendChild(minus);
    row.appendChild(input);
    row.appendChild(plus);

    card.appendChild(title);
    card.appendChild(row);

    thirdPartyGrid.appendChild(card);
  }

  renderSwitches();
  renderThirdPartyCard();

  /* ---------- 요약 ---------- */
  function switchesText() {
    const parts = [];
    for (let g = 1; g <= 6; g++) if (state.switchCounts[g] > 0) parts.push(`${g}구 ${state.switchCounts[g]}개`);
    return parts.length ? parts.join(", ") : "선택 없음";
  }

  function formatWon(n) {
    const x = Number(n) || 0;
    return `${x.toLocaleString()}원`;
  }

  function safeNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function getCatalogPrice(vendor, category, productId, priceType) {
    const arr = state.catalogMap?.[vendor]?.[category] || [];
    const found = arr.find(p => p.id === productId);
    const price = found?.prices?.[priceType];
    return safeNum(price);
  }

  // ✅ 카테고리(한글) -> pricing.installCostPerItem 키 매핑
  function installCostKeyByCategory(koreanCategory) {
    if (koreanCategory === "메인등") return "main";
    if (koreanCategory === "매립등") return "recess";
    if (koreanCategory === "라인등") return "line";
    return null;
  }

  // priceType: "retail" | "dealer"
  function calcSums(priceType) {
    let lighting = 0;
    let install = 0;

    const items = selectedItemsAll();
    const p = state.pricing || {};

    for (const it of items) {
      const meta = state.productIndex[it.key];
      if (!meta) continue;

      const unitPrice = getCatalogPrice(it.vendor, it.category, it.productId, priceType);

      // 기존 규칙 유지: 조명(매립/메인/라인)은 lighting 합계
      if (["매립등", "메인등", "라인등"].includes(meta.category)) {
        lighting += unitPrice * it.qty;

        // ✅ 추가 규칙: 조명 카테고리별 "1개당 시공비"를 install 합계에 누적
        const costKey = installCostKeyByCategory(meta.category);
        if (costKey) {
          const perItemInstall = safeNum(p.installCostPerItem?.[costKey]?.[priceType]);
          install += perItemInstall * it.qty;
        }
      } else if (["마그네틱", "기타", "통신기기"].includes(meta.category)) {
        // 기타/통신기기 등은 기존처럼 install 합계
        install += unitPrice * it.qty;
      }
    }

    // 스위치 총 "구수" = (1구*개수 + 2구*개수 + ...)
    const switchTotalGang = Object.entries(state.switchCounts)
      .reduce((a, [g, c]) => a + safeNum(g) * safeNum(c), 0);

    install += safeNum(p.switchGang?.[priceType]) * switchTotalGang;
    install += safeNum(p.thirdPartyGang?.[priceType]) * safeNum(state.thirdPartyGangTotal);

    // ✅ 1평당 시공단가: 시공 합계 금액에 추가
    install += safeNum(p.constructionPerPyeong?.[priceType]) * safeNum(state.installAreaPyeong);

    // 스마트홈 세팅 비용: 개통유무 YES일 때만 포함
    let smartHome = 0;
    if (state.activation === "yes") {
      const actFee = safeNum(p.activationFee?.[priceType]);
      const per = safeNum(p.installPerPyeong?.[priceType]);

      if (actFee > 0) smartHome = actFee;
      else if (per > 0) smartHome = per * safeNum(state.installAreaPyeong);
    }

    return { lighting, install, smartHome };
  }

  function buildOrderCode(dealerSums) {
    return `JL_${dealerSums.lighting}_${dealerSums.install}_${dealerSums.smartHome}`;
  }

  function refreshEstimateResult() {
    const retail = calcSums("retail");
    const dealer = calcSums("dealer");

    const any =
      (retail.lighting + retail.install + retail.smartHome) > 0 ||
      (dealer.lighting + dealer.install + dealer.smartHome) > 0;

    if (!any) {
      estimateResultBox.style.display = "none";
      return;
    }

    estimateResultBox.style.display = "block";

    // 발주코드 기본 숨김 유지
    if (orderCodeToggleEl && !state.orderCodeVisible) {
      orderCodeEl.classList.add("hidden");
      if (orderCodeChevronEl) orderCodeChevronEl.classList.remove("open");
    }

    sumLightingEl.textContent = formatWon(retail.lighting);
    sumInstallEl.textContent = formatWon(retail.install);
    sumSmartHomeEl.textContent = formatWon(retail.smartHome);
    orderCodeEl.textContent = buildOrderCode(dealer);
  }

  function refreshSummary() {
    const items = selectedItemsAll();
    const totalQty = items.reduce((a, b) => a + b.qty, 0);

    const actText =
      state.activation === "yes" ? "YES(포함)" :
      state.activation === "no" ? "NO(미포함)" : "미선택";

    let itemDetail = "없음";
    if (items.length) {
      const top = items.slice(0, 8).map(it => `${it.name} x${it.qty}`);
      itemDetail = top.join(", ") + (items.length > 8 ? ` 외 ${items.length - 8}개` : "");
    }

    summaryBox.innerHTML = `
      <div>• 개통유무: <strong>${actText}</strong></div>
      <div>• 선택 상품: <strong>${items.length}종 / 총 ${totalQty}개</strong></div>
      <div class="summary-muted">- ${itemDetail}</div>
      <div style="margin-top:6px;">• 스위치(우리제품): <strong>${switchesText()}</strong></div>
      <div>• 사제 스위치 구수 합계: <strong>${state.thirdPartyGangTotal}구</strong></div>
    `;
    refreshEstimateResult();
  }
  refreshSummary();

  /* ---------- 초기화/엑셀 ---------- */
  function resetEstimateOnly() {
    state.activation = null;
    state.vendor = null;
    state.category = null;
    state.searchQuery = "";
    state.quantities = {};
    state.installAreaPyeong = 0;
    installAreaEl.value = "";

    activationHint.textContent = "선택해 주세요.";
    vendorHint.textContent = "발주처를 선택하면 상품군/상품이 표시됩니다. (리바트/지비스를 번갈아 선택해도 기존 수량은 유지됩니다)";
    setSelectedByData(activationGroup, "data-value", "__none__");
    setSelectedByData(vendorGroup, "data-vendor", "__none__");

    categoryGroup.innerHTML = "";
    categoryWrap.style.display = "none";

    productSearchEl.value = "";
    searchHintEl.textContent = "검색어를 입력하면 발주처/상품군 선택 없이도 전체 상품에서 검색됩니다.";
    productGrid.innerHTML = "";
    productWrap.style.display = "none";
    productHint.textContent = "수량을 1개 이상 선택해 주세요.";

    for (let g = 1; g <= 6; g++) state.switchCounts[g] = 0;
    state.thirdPartyGangTotal = 0;
    renderSwitches();
    renderThirdPartyCard();

    refreshSummary();
  }

  resetEstimateBtn.addEventListener("click", () => {
    const ok = confirm("견적(발주/회로) 정보를 초기화할까요?\n※ 고객 정보/휴대폰 인증은 유지됩니다.");
    if (ok) resetEstimateOnly();
  });

  exportExcelBtn.addEventListener("click", () => {
    if (typeof XLSX === "undefined") return alert("엑셀 라이브러리(XLSX)가 로드되지 않았습니다.");
    alert("엑셀 저장 로직은 기존 구현을 유지하세요. (원하면 여기도 함께 맞춰드릴게요)");
  });

  // 최초 인덱스 구성
  rebuildIndex();
  // 초기엔 검색어 없고 vendor/category 없으면 productWrap 숨김(HTML에서 이미 숨김)
}
