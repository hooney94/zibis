import { DB_PATHS } from "./config.js";
import { $, $all } from "./utils.js";

const CATEGORIES_BY_VENDOR = {
  hanssem: ["매립등", "메인등", "라인등", "마그네틱", "기타"],
  zibis: ["매립등", "라인등", "통신기기"],
};

const VENDORS = [
  { value: "hanssem", label: "한샘" },
  { value: "zibis", label: "지비스" },
];

function toNumOrEmpty(v) {
  const s = (v ?? "").toString().replace(/[^0-9]/g, "");
  return s ? Number(s) : "";
}
function setNumInput(el, n) {
  el.value = (n === null || n === undefined || n === "") ? "" : String(n);
}
function showBadge(el, text) {
  el.textContent = text;
  el.style.display = "inline-flex";
  setTimeout(() => { el.style.display = "none"; }, 1800);
}
function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}
function downloadTextFile(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

export function mountAdmin({ rootEl, db }) {
  return fetch("./partials/admin.html")
    .then(r => r.text())
    .then(html => {
      rootEl.innerHTML = html;
      wireAdmin({ rootEl, db });
    });
}

function wireAdmin({ rootEl, db }) {
  /* =========================
     Settings JSON export/import
  ========================= */
  const exportSettingsBtn = $("#exportSettingsBtn", rootEl);
  const applyLocalSettingsBtn = $("#applyLocalSettingsBtn", rootEl);
  const importSettingsInput = $("#importSettingsInput", rootEl);
  const settingsStatus = $("#settingsStatus", rootEl);

  function buildSettingsPayload({ pricing, catalogItems }) {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      firebasePaths: {
        pricing: DB_PATHS.pricing,
        catalogItems: `${DB_PATHS.catalog}/items`,
      },
      data: {
        pricing: pricing || {},
        catalog: { items: catalogItems || {} },
      },
    };
  }

  function normalizeImportedSettings(obj) {
    if (!isObject(obj)) throw new Error("JSON 루트가 객체가 아닙니다.");

    if (obj.schemaVersion && isObject(obj.data)) {
      const pricing = obj.data.pricing || {};
      const items = obj.data.catalog?.items || {};
      if (!isObject(pricing)) throw new Error("data.pricing 형식 오류");
      if (!isObject(items)) throw new Error("data.catalog.items 형식 오류");
      return { pricing, items };
    }

    if (isObject(obj.pricing) && isObject(obj.catalog) && isObject(obj.catalog.items)) {
      return { pricing: obj.pricing, items: obj.catalog.items };
    }

    if (isObject(obj.pricing) && isObject(obj.catalogItems)) {
      return { pricing: obj.pricing, items: obj.catalogItems };
    }

    throw new Error("지원하지 않는 settings.json 형식입니다.");
  }

  async function exportSettings() {
    const [pSnap, cSnap] = await Promise.all([
      db.ref(DB_PATHS.pricing).once("value"),
      db.ref(`${DB_PATHS.catalog}/items`).once("value"),
    ]);

    const payload = buildSettingsPayload({
      pricing: pSnap.val() || {},
      catalogItems: cSnap.val() || {},
    });

    downloadTextFile("settings.json", JSON.stringify(payload, null, 2));
    showBadge(settingsStatus, "📤 내보냄");
  }

  async function applySettingsToDb({ pricing, items }) {
    const ok = confirm(
      "settings.json을 적용하면 현재 Firebase DB의 기본 단가/품목이 덮어씌워집니다.\n진행할까요?"
    );
    if (!ok) return;

    await Promise.all([
      db.ref(DB_PATHS.pricing).set(pricing),
      db.ref(`${DB_PATHS.catalog}/items`).set(items),
    ]);

    showBadge(settingsStatus, "✅ 적용됨");
    await loadPricing();
    await loadCatalog();
    alert("settings.json 적용 완료!");
  }

  exportSettingsBtn.addEventListener("click", () => {
    exportSettings().catch((e) => {
      console.error(e);
      alert("내보내기 중 오류가 발생했습니다.");
    });
  });

  applyLocalSettingsBtn.addEventListener("click", async () => {
    try {
      const res = await fetch(`./settings.json?ts=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        return alert(
          "settings.json을 찾을 수 없습니다.\n\n" +
          "✅ 해결 방법:\n" +
          "1) settings.json을 index.html과 같은 폴더(public)에 넣기\n" +
          "2) file:// 이 아닌 로컬 서버로 열기 (예: python -m http.server)\n" +
          "3) 또는 [JSON 파일 선택 후 적용]을 사용하기"
        );
      }
      const obj = await res.json();
      const normalized = normalizeImportedSettings(obj);
      await applySettingsToDb(normalized);
    } catch (e) {
      console.error(e);
      alert(
        "settings.json 자동 불러오기 실패.\n\n" +
        "대부분 file://로 열어서 발생합니다.\n" +
        "로컬 서버로 열거나, [JSON 파일 선택 후 적용]을 사용해 주세요."
      );
    }
  });

  importSettingsInput.addEventListener("change", async () => {
    const f = importSettingsInput.files && importSettingsInput.files[0];
    if (!f) return;
    importSettingsInput.value = "";

    try {
      const text = await f.text();
      const obj = JSON.parse(text);
      const normalized = normalizeImportedSettings(obj);
      await applySettingsToDb(normalized);
    } catch (e) {
      console.error(e);
      alert("가져오기 중 오류가 발생했습니다. (JSON 파싱/형식 확인)");
    }
  });

  /* ---------- Tabs ---------- */
  const tabBtns = $all(".tab-btn", rootEl);
  function setTab(key) {
    tabBtns.forEach(b => b.classList.toggle("selected", b.dataset.tab === key));
    $all(".admin-tab", rootEl).forEach(sec => {
      const id = sec.id || "";
      const show =
        (key === "pricing" && id === "adminTab_pricing") ||
        (key === "catalog" && id === "adminTab_catalog");
      sec.style.display = show ? "block" : "none";
    });
  }
  tabBtns.forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
  setTab("pricing");

  /* =========================
     1) Pricing (개통비 vs 1평당 단가 상호배타)
  ========================= */
  const pricingSaveBtn = $("#pricingSaveBtn", rootEl);
  const pricingReloadBtn = $("#pricingReloadBtn", rootEl);
  const pricingStatus = $("#pricingStatus", rootEl);

  const p_activation_dealer = $("#price_activation_dealer", rootEl);
  const p_activation_retail = $("#price_activation_retail", rootEl);

  const p_install_dealer = $("#price_install_dealer", rootEl);
  const p_install_retail = $("#price_install_retail", rootEl);

  const p_construction_dealer = $("#price_construction_dealer", rootEl);
  const p_construction_retail = $("#price_construction_retail", rootEl);

  const p_main_install_dealer = $("#price_main_install_dealer", rootEl);
  const p_main_install_retail = $("#price_main_install_retail", rootEl);

  const p_recess_install_dealer = $("#price_recess_install_dealer", rootEl);
  const p_recess_install_retail = $("#price_recess_install_retail", rootEl);

  const p_line_install_dealer = $("#price_line_install_dealer", rootEl);
  const p_line_install_retail = $("#price_line_install_retail", rootEl);

  const p_switch_dealer = $("#price_switch_dealer", rootEl);
  const p_switch_retail = $("#price_switch_retail", rootEl);

  const p_third_dealer = $("#price_third_dealer", rootEl);
  const p_third_retail = $("#price_third_retail", rootEl);

  const priceInputs = [
    p_activation_dealer, p_activation_retail,
    p_install_dealer, p_install_retail,
    p_construction_dealer, p_construction_retail,
    p_main_install_dealer, p_main_install_retail,
    p_recess_install_dealer, p_recess_install_retail,
    p_line_install_dealer, p_line_install_retail,
    p_switch_dealer, p_switch_retail,
    p_third_dealer, p_third_retail,
  ];

  priceInputs.forEach((el) => {
    el.addEventListener("input", () => {
      const n = toNumOrEmpty(el.value);
      setNumInput(el, n);
      applyAutoLock();
    });
  });

  function anyPositiveOrFilled(...els) {
    return els.some(el => {
      const v = toNumOrEmpty(el.value);
      return v !== "" && Number(v) > 0;
    });
  }

  function applyAutoLock() {
    const activationUsed = anyPositiveOrFilled(p_activation_dealer, p_activation_retail);
    const perPyeongUsed = anyPositiveOrFilled(
      p_install_dealer, p_install_retail,
      p_construction_dealer, p_construction_retail
    );

    if (activationUsed) {
      // ✅ 사용자 요청: 1평당 개통단가/시공단가 둘 다 잠금
      p_install_dealer.disabled = true;
      p_install_retail.disabled = true;
      p_construction_dealer.disabled = true;
      p_construction_retail.disabled = true;

      p_activation_dealer.disabled = false;
      p_activation_retail.disabled = false;
      return;
    }

    if (perPyeongUsed) {
      p_activation_dealer.disabled = true;
      p_activation_retail.disabled = true;

      p_install_dealer.disabled = false;
      p_install_retail.disabled = false;
      p_construction_dealer.disabled = false;
      p_construction_retail.disabled = false;
      return;
    }

    // 아무것도 입력 안 된 상태
    p_activation_dealer.disabled = false;
    p_activation_retail.disabled = false;

    p_install_dealer.disabled = false;
    p_install_retail.disabled = false;
    p_construction_dealer.disabled = false;
    p_construction_retail.disabled = false;
  }

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

    if (v.activationFee?.dealer !== undefined || v.installPerPyeong || v.constructionPerPyeong) {
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

  async function loadPricing() {
    const snap = await db.ref(DB_PATHS.pricing).once("value");
    const v = normalizePricingFromDb(snap.val() || null);

    setNumInput(p_activation_dealer, v.activationFee.dealer);
    setNumInput(p_activation_retail, v.activationFee.retail);

    setNumInput(p_install_dealer, v.installPerPyeong.dealer);
    setNumInput(p_install_retail, v.installPerPyeong.retail);

    setNumInput(p_construction_dealer, v.constructionPerPyeong.dealer);
    setNumInput(p_construction_retail, v.constructionPerPyeong.retail);

    setNumInput(p_main_install_dealer, v.installCostPerItem?.main?.dealer ?? "");
    setNumInput(p_main_install_retail, v.installCostPerItem?.main?.retail ?? "");

    setNumInput(p_recess_install_dealer, v.installCostPerItem?.recess?.dealer ?? "");
    setNumInput(p_recess_install_retail, v.installCostPerItem?.recess?.retail ?? "");

    setNumInput(p_line_install_dealer, v.installCostPerItem?.line?.dealer ?? "");
    setNumInput(p_line_install_retail, v.installCostPerItem?.line?.retail ?? "");

    setNumInput(p_switch_dealer, v.switchGang.dealer);
    setNumInput(p_switch_retail, v.switchGang.retail);

    setNumInput(p_third_dealer, v.thirdPartyGang.dealer);
    setNumInput(p_third_retail, v.thirdPartyGang.retail);

    applyAutoLock();
    showBadge(pricingStatus, "✅ 불러옴");
  }

  async function savePricing() {
    const payload = {
      activationFee: {
        dealer: toNumOrEmpty(p_activation_dealer.value),
        retail: toNumOrEmpty(p_activation_retail.value),
      },
      installPerPyeong: {
        dealer: toNumOrEmpty(p_install_dealer.value),
        retail: toNumOrEmpty(p_install_retail.value),
      },
      constructionPerPyeong: {
        dealer: toNumOrEmpty(p_construction_dealer.value),
        retail: toNumOrEmpty(p_construction_retail.value),
      },
      installCostPerItem: {
        main: { dealer: toNumOrEmpty(p_main_install_dealer.value), retail: toNumOrEmpty(p_main_install_retail.value) },
        recess: { dealer: toNumOrEmpty(p_recess_install_dealer.value), retail: toNumOrEmpty(p_recess_install_retail.value) },
        line: { dealer: toNumOrEmpty(p_line_install_dealer.value), retail: toNumOrEmpty(p_line_install_retail.value) },
      },
      switchGang: {
        dealer: toNumOrEmpty(p_switch_dealer.value),
        retail: toNumOrEmpty(p_switch_retail.value),
      },
      thirdPartyGang: {
        dealer: toNumOrEmpty(p_third_dealer.value),
        retail: toNumOrEmpty(p_third_retail.value),
      },
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
    };

    const activationUsed =
      (payload.activationFee.dealer !== "" && payload.activationFee.dealer > 0) ||
      (payload.activationFee.retail !== "" && payload.activationFee.retail > 0);

    const perUsed =
      (payload.installPerPyeong.dealer !== "" && payload.installPerPyeong.dealer > 0) ||
      (payload.installPerPyeong.retail !== "" && payload.installPerPyeong.retail > 0) ||
      (payload.constructionPerPyeong.dealer !== "" && payload.constructionPerPyeong.dealer > 0) ||
      (payload.constructionPerPyeong.retail !== "" && payload.constructionPerPyeong.retail > 0);

    if (activationUsed && perUsed) return alert("개통비와 1평당 단가(개통단가/시공단가)를 동시에 사용할 수 없습니다. 한쪽을 비워주세요.");
    if (!activationUsed && !perUsed) return alert("개통비 또는 1평당 단가(개통단가/시공단가) 중 하나는 입력해 주세요.");

    await db.ref(DB_PATHS.pricing).set(payload);
    applyAutoLock();
    showBadge(pricingStatus, "💾 저장됨");
  }

  pricingReloadBtn.addEventListener("click", () => loadPricing().catch(console.error));
  pricingSaveBtn.addEventListener("click", () => savePricing().catch((e) => {
    console.error(e);
    alert("저장 중 오류가 발생했습니다.");
  }));

  /* =========================
     2) Catalog
  ========================= */
  const addItemBtn = $("#addItemBtn", rootEl);
  const catalogSaveBtn = $("#catalogSaveBtn", rootEl);
  const catalogReloadBtn = $("#catalogReloadBtn", rootEl);
  const catalogStatus = $("#catalogStatus", rootEl);
  const catalogBody = $("#catalogBody", rootEl);

  let catalogRows = [];

  function normalizeCatalogFromDb(v) {
    if (!v) return [];
    const itemsObj = (v.items && typeof v.items === "object") ? v.items : v;
    if (!itemsObj || typeof itemsObj !== "object") return [];

    const rows = [];
    for (const [id, r] of Object.entries(itemsObj)) {
      const vendor = r.vendor || "hanssem";
      const allowedCats = CATEGORIES_BY_VENDOR[vendor] || ["기타"];
      const cat = allowedCats.includes(r.category) ? r.category : allowedCats[0];

      rows.push({
        id,
        vendor,
        category: cat,
        name: r.name || "",
        prices: {
          dealer: (r.prices && r.prices.dealer !== undefined) ? r.prices.dealer : "",
          retail: (r.prices && r.prices.retail !== undefined) ? r.prices.retail : "",
        },
        image: r.image || (r.img ? { type: "url", value: r.img } : null),
        orderCode: r.orderCode || "",
        _deleted: false,
      });
    }
    return rows;
  }

  function buildCatalogPayload(rows) {
    const items = {};
    rows.filter(r => !r._deleted).forEach(r => {
      items[r.id] = {
        vendor: r.vendor || "hanssem",
        category: r.category || (CATEGORIES_BY_VENDOR[r.vendor] ? CATEGORIES_BY_VENDOR[r.vendor][0] : "기타"),
        name: r.name || "",
        prices: {
          dealer: (r.prices?.dealer === "" ? "" : Number(r.prices?.dealer || 0)),
          retail: (r.prices?.retail === "" ? "" : Number(r.prices?.retail || 0)),
        },
        image: r.image || null,
        orderCode: r.orderCode || "",
        updatedAt: firebase.database.ServerValue.TIMESTAMP,
      };
    });
    return items;
  }

  async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  function renderCategorySelect(sel, vendor, current) {
    sel.innerHTML = "";
    const cats = CATEGORIES_BY_VENDOR[vendor] || ["기타"];
    cats.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    });
    sel.value = (cats.includes(current) ? current : cats[0]);
  }

  function renderCatalog() {
    catalogBody.innerHTML = "";

    const alive = catalogRows.filter(r => !r._deleted);
    if (!alive.length) {
      catalogBody.innerHTML = `<tr><td colspan="8" class="subtitle" style="text-align:center;">등록된 품목이 없습니다. [＋ 품목 추가]를 눌러 추가해 주세요.</td></tr>`;
      return;
    }

    alive.forEach((row) => {
      const tr = document.createElement("tr");

      // vendor
      const tdVendor = document.createElement("td");
      const selVendor = document.createElement("select");
      selVendor.className = "";
      VENDORS.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v.value;
        opt.textContent = v.label;
        selVendor.appendChild(opt);
      });
      selVendor.value = row.vendor;

      // category
      const tdCat = document.createElement("td");
      const selCat = document.createElement("select");
      selCat.className = "";
      renderCategorySelect(selCat, row.vendor, row.category);

      selVendor.addEventListener("change", () => {
        row.vendor = selVendor.value;
        const allowed = CATEGORIES_BY_VENDOR[row.vendor] || ["기타"];
        if (!allowed.includes(row.category)) row.category = allowed[0];
        renderCategorySelect(selCat, row.vendor, row.category);
      });

      selCat.addEventListener("change", () => {
        row.category = selCat.value;
      });

      tdVendor.appendChild(selVendor);
      tdCat.appendChild(selCat);

      // name
      const tdName = document.createElement("td");
      const inName = document.createElement("input");
      inName.type = "text";
      inName.className = "";
      inName.placeholder = "품명";
      inName.value = row.name || "";
      inName.addEventListener("input", () => row.name = inName.value);
      tdName.appendChild(inName);

      // dealer
      const tdDealer = document.createElement("td");
      const inDealer = document.createElement("input");
      inDealer.type = "number";
      inDealer.className = "price-input";
      inDealer.inputMode = "numeric";
      inDealer.placeholder = "숫자";
      inDealer.value = (row.prices?.dealer ?? "") === "" ? "" : String(row.prices.dealer);
      inDealer.addEventListener("input", () => {
        row.prices = row.prices || {};
        row.prices.dealer = toNumOrEmpty(inDealer.value);
        setNumInput(inDealer, row.prices.dealer);
      });
      tdDealer.appendChild(inDealer);

      // retail
      const tdRetail = document.createElement("td");
      const inRetail = document.createElement("input");
      inRetail.type = "number";
      inRetail.className = "price-input";
      inRetail.inputMode = "numeric";
      inRetail.placeholder = "숫자";
      inRetail.value = (row.prices?.retail ?? "") === "" ? "" : String(row.prices.retail);
      inRetail.addEventListener("input", () => {
        row.prices = row.prices || {};
        row.prices.retail = toNumOrEmpty(inRetail.value);
        setNumInput(inRetail, row.prices.retail);
      });
      tdRetail.appendChild(inRetail);

      // image
      const tdImg = document.createElement("td");
      tdImg.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:6px;">
          <input type="text" data-role="imgUrl" placeholder="이미지 URL" />
          <input type="file" accept="image/*" data-role="imgFile" />
        </div>
      `;
      const imgUrlEl = tdImg.querySelector('[data-role="imgUrl"]');
      const imgFileEl = tdImg.querySelector('[data-role="imgFile"]');

      if (row.image?.type === "url") imgUrlEl.value = row.image.value || "";
      if (row.image?.type === "data") imgUrlEl.value = "(업로드 이미지)";

      imgUrlEl.addEventListener("input", () => {
        const url = imgUrlEl.value.trim();
        if (!url) row.image = null;
        else row.image = { type: "url", value: url };
      });

      imgFileEl.addEventListener("change", async () => {
        const f = imgFileEl.files && imgFileEl.files[0];
        if (!f) return;
        const dataUrl = await fileToDataUrl(f);
        row.image = { type: "data", value: dataUrl };
        imgUrlEl.value = "(업로드 이미지)";
        imgFileEl.value = "";
      });

      // orderCode
      const tdCode = document.createElement("td");
      const inCode = document.createElement("input");
      inCode.type = "text";
      inCode.className = "";
      inCode.placeholder = "제품코드";
      inCode.value = row.orderCode || "";
      inCode.addEventListener("input", () => row.orderCode = inCode.value);
      tdCode.appendChild(inCode);

      // delete
      const tdDel = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn-danger-inline";
      delBtn.textContent = "삭제";
      delBtn.addEventListener("click", () => {
        const ok = confirm("이 품목을 삭제할까요? (저장해야 반영됩니다)");
        if (!ok) return;
        row._deleted = true;
        renderCatalog();
      });
      tdDel.appendChild(delBtn);

      [tdVendor, tdCat, tdName, tdDealer, tdRetail, tdImg, tdCode, tdDel].forEach(td => tr.appendChild(td));
      catalogBody.appendChild(tr);
    });
  }

  async function loadCatalog() {
    const snap = await db.ref(`${DB_PATHS.catalog}/items`).once("value");
    catalogRows = normalizeCatalogFromDb(snap.val() || null);
    renderCatalog();
    showBadge(catalogStatus, "✅ 불러옴");
  }

  async function saveCatalog() {
    const payload = buildCatalogPayload(catalogRows);
    await db.ref(`${DB_PATHS.catalog}/items`).set(payload);
    showBadge(catalogStatus, "💾 저장됨");
  }

  addItemBtn.addEventListener("click", () => {
    catalogRows.unshift({
      id: uuid(),
      vendor: "hanssem",
      category: CATEGORIES_BY_VENDOR.hanssem[0],
      name: "",
      prices: { dealer: "", retail: "" },
      image: null,
      orderCode: "",
      _deleted: false,
    });
    renderCatalog();
  });

  catalogReloadBtn.addEventListener("click", () => loadCatalog().catch(console.error));
  catalogSaveBtn.addEventListener("click", () => saveCatalog().catch((e) => {
    console.error(e);
    alert("저장 중 오류가 발생했습니다.");
  }));

  // init
  loadPricing().catch(console.error);
  loadCatalog().catch(console.error);
}
