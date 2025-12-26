export function $(sel, root = document) {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`Element not found: ${sel}`);
  return el;
}
export function $all(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function formatPhoneToE164(phone) {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) return "+82" + digits.substring(1);
  if (digits.startsWith("82")) return "+" + digits;
  return "+82" + digits;
}

export function yyyyMMddFromDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function formatDateTime(ts) {
  if (!ts) return "";
  const dt = new Date(ts);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mi = String(dt.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function maskName(name) {
  if (!name) return "";
  if (name.length <= 2) return name[0] + "*";
  return name[0] + "*".repeat(name.length - 2) + name[name.length - 1];
}

export function maskPhone(phone) {
  const digits = (phone || "").replace(/[^0-9]/g, "");
  if (digits.length < 7) return phone || "";
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

export function stableSortStringAsc(a, b, locale = "ko-KR") {
  return (a || "").toString().localeCompare((b || "").toString(), locale);
}
