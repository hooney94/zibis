// public/js/main.js
import { initFirebase } from "./firebase.js";
import { mountCustomer } from "./customer.js";
import { mountAdmin } from "./admin.js";

const { db, auth } = initFirebase();

const customerSection = document.getElementById("customerSection");
const adminSection = document.getElementById("adminSection");
const toggleAdminBtn = document.getElementById("toggleAdminBtn");
const modeIndicator = document.getElementById("modeIndicator");

let mode = "customer";

function setMode(next) {
  mode = next;
  if (mode === "admin") {
    customerSection.style.display = "none";
    adminSection.style.display = "block";
    toggleAdminBtn.textContent = "👤 고객";
    modeIndicator.textContent = "현재 모드: 관리자 모드";
  } else {
    customerSection.style.display = "block";
    adminSection.style.display = "none";
    toggleAdminBtn.textContent = "🔐 관리자";
    modeIndicator.textContent = "현재 모드: 고객 모드";
  }
}

toggleAdminBtn.addEventListener("click", () => {
  if (mode === "customer") {
    const pw = window.prompt("관리자 비밀번호를 입력하세요.");
    if (pw === null) return;
    if (pw === "1111") setMode("admin");
    else alert("비밀번호가 올바르지 않습니다.");
  } else {
    setMode("customer");
  }
});

await mountCustomer({ rootEl: customerSection, db, auth });
await mountAdmin({ rootEl: adminSection, db, auth });

setMode("customer");
