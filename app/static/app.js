/* ===================== state & helpers ===================== */
let token = "", me = null, P = [], C = [], cart = [], currentPage = "home", pending = null;
const $ = (x) => document.getElementById(x);
const money = (x) => Number(x || 0).toLocaleString("vi-VN") + "\u00A0đ";
const dt = (iso) => new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// khối dựng form: nhãn + ô nhập + gợi ý, và tiêu đề nhóm
const fld = (label, inner, o = {}) => `<div class="${o.cls || ""}"><label>${label}${o.req ? ` <span class="text-brick-500">*</span>` : ""}</label>${inner}${o.hint ? `<p class="text-xs text-ink-300 mt-1.5 leading-relaxed">${o.hint}</p>` : ""}</div>`;
const sect = (t) => `<div class="flex items-center gap-3 pt-1"><span class="text-[11px] font-700 tracking-wider uppercase text-ink-300">${t}</span><span class="flex-1 h-px bg-ink-100"></span></div>`;
const autoBadge = `<span class="pill bg-ink-50 text-ink-500 ml-1.5">Tự động</span>`;
async function loadNextCode(kind, inputId) {
  try { const r = await api("/codes/next?kind=" + kind); if ($(inputId)) $(inputId).value = r.code; } catch (e) { /* để trống, server vẫn tự cấp mã khi lưu */ }
}

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

async function api(path, opts = {}) {
  opts.headers = Object.assign(
    { "Content-Type": "application/json" },
    opts.headers || {},
    token ? { Authorization: "Bearer " + token } : {}
  );
  const r = await fetch("/api" + path, opts);
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { logout(); throw new Error("Phiên đăng nhập đã hết hạn"); }
  if (!r.ok) throw new Error(d.detail || "Có lỗi xảy ra");
  return d;
}

function toast(msg, kind = "ok") {
  const colors = { ok: "border-leaf-500 text-leaf-600", err: "border-brick-500 text-brick-500", info: "border-ink-500 text-ink-700" };
  const el = document.createElement("div");
  el.className = `toast card border-l-4 ${colors[kind]} shadow-lg px-4 py-3 text-sm font-600`;
  el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .25s"; setTimeout(() => el.remove(), 250); }, 2600);
}

function modal(bodyHtml, { title = "", wide = false } = {}) {
  const w = wide === "lg" ? "max-w-xl" : wide ? "max-w-3xl" : "max-w-md";
  $("modalRoot").innerHTML = `
    <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4" id="mb">
      <div class="card w-full ${w} max-h-[88vh] overflow-y-auto shadow-2xl">
        <div class="flex items-center justify-between px-5 py-4 border-b border-ink-100">
          <h3 class="font-head font-700 text-lg text-ink-900">${title}</h3>
          <button onclick="closeModal()" class="w-8 h-8 rounded-full hover:bg-ink-50 flex items-center justify-center text-ink-300 text-lg">✕</button>
        </div>
        <div class="p-5">${bodyHtml}</div>
      </div>
    </div>`;
}
function closeModal() {
  $("modalRoot").innerHTML = "";
  if (pending && pending.orderId) { pending = null; if (currentPage === "pos") pos(); }
}

async function downloadFile(path, fallbackName, opts = {}) {
  const headers = Object.assign({ Authorization: "Bearer " + token }, opts.body ? { "Content-Type": "application/json" } : {});
  const r = await fetch("/api" + path, { ...opts, headers });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.detail || "Không xuất được file Excel");
  }
  const blob = await r.blob();
  const m = /filename="?([^";]+)"?/.exec(r.headers.get("Content-Disposition") || "");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = m ? m[1] : fallbackName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ===================== icons ===================== */
const ICONS = {
  home: "M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1Z",
  pos: "M4 7h16l-1.5 9.5a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7L4 7Zm3-3h10M9 11v3M15 11v3",
  users: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm9 1a2.5 2.5 0 1 0 0-5M3 20c0-3.3 2.2-6 5.5-6s5.5 2.7 5.5 6M15.5 14c3 0 5.5 2.6 5.5 6",
  orders: "M6 3h9l3 3v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm9 0v3h3M8 11h8M8 15h8M8 7h4",
  box: "M3.5 7.5 12 3l8.5 4.5L12 12 3.5 7.5Zm0 0V16L12 20.5m0-8.5V20.5m8.5-13V16L12 20.5",
  stock: "M4 20V10m5 10V4m5 16v-7m5 7V8",
  wallet: "M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2h-5a3 3 0 0 0 0 6h5v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm16 3a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-4a2 2 0 0 1 0-4h4Z",
  truck: "M3 7h11v9H3Zm11 3h4l3 3v3h-7M7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm9 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9c0-3.9 3.1-7 7-7s7 3.1 7 7",
};
const icon = (name, cls = "w-[18px] h-[18px]") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${(ICONS[name] || "").split("M").filter(Boolean).map(p => `<path d="M${p}"/>`).join("")}</svg>`;

/* ===================== auth / shell ===================== */
async function login() {
  try {
    const x = await api("/auth/login", { method: "POST", body: JSON.stringify({ username: $("u").value, password: $("p").value }) });
    token = x.access_token;
    me = await api("/me");
    localStorage.sbh_token = token;
    start();
  } catch (e) { $("msg").textContent = e.message; }
}
function logout() { localStorage.removeItem("sbh_token"); location.reload(); }
function can(p) { return me.role === "admin" || (me.permissions || []).includes(p); }

function start() {
  $("login").classList.add("hide");
  $("app").classList.remove("hide");
  $("user").textContent = me.full_name || me.username;
  $("userRole").textContent = me.role === "admin" ? "Quản trị viên" : "Nhân viên";
  $("avatar").textContent = (me.full_name || me.username).trim().slice(0, 1).toUpperCase();
  buildNav();
  tickClock(); setInterval(tickClock, 30000);
  goto("home");
}
function tickClock() {
  $("clock").textContent = new Date().toLocaleString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const NAV = [
  { k: "home", label: "Tổng quan", icon: "home", perm: "dashboard" },
  { k: "pos", label: "Bán hàng", icon: "pos", perm: "pos" },
  { k: "orders", label: "Đơn hàng", icon: "orders", perm: "orders" },
  { k: "customers", label: "Khách hàng", icon: "users", perm: "customers" },
  { k: "products", label: "Sản phẩm", icon: "box", adminOnly: true },
  { k: "purchases", label: "Mua hàng đại lý", icon: "truck", adminOnly: true },
  { k: "stock", label: "Kho hàng", icon: "stock", adminOnly: true },
  { k: "expenses", label: "Chi phí", icon: "wallet", adminOnly: true },
  { k: "users", label: "Tài khoản", icon: "user", adminOnly: true },
];
function buildNav() {
  $("nav").innerHTML = NAV.filter(n => n.adminOnly ? me.role === "admin" : can(n.perm)).map(n => `
    <button data-k="${n.k}" onclick="goto('${n.k}')" class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-600 text-ink-100/85 hover:bg-white/5 transition">
      <span class="ni-dot w-1.5 h-1.5 rounded-full bg-transparent"></span>${icon(n.icon)}<span>${n.label}</span>
    </button>`).join("");
}
const PAGE_META = {
  home: ["Tổng quan", "Tình hình kinh doanh hôm nay"],
  pos: ["Bán hàng", "Tạo đơn hàng mới tại quầy"],
  orders: ["Đơn hàng", "Lịch sử giao dịch gần đây"],
  customers: ["Khách hàng", "Danh sách và thông tin khách hàng"],
  products: ["Sản phẩm", "Quản lý danh mục và giá bán"],
  purchases: ["Mua hàng đại lý", "Phiếu mua hàng và thông tin đại lý"],
  stock: ["Kho hàng", "Nhập, xuất và điều chỉnh tồn kho"],
  expenses: ["Chi phí", "Theo dõi các khoản chi vận hành"],
  users: ["Tài khoản", "Quản lý người dùng hệ thống"],
};
function goto(page) {
  currentPage = page;
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.k === page));
  const meta = PAGE_META[page] || ["", ""];
  $("pageTitle").textContent = meta[0]; $("pageSub").textContent = meta[1];
  Promise.resolve().then(() => ({ home, pos, orders, customers, products, purchases, stock, expenses, users })[page]()).catch((e) => {
    $("main").innerHTML = `<div class="card p-6 max-w-lg">
      <h3 class="font-head font-700 text-brick-500">Không tải được trang này</h3>
      <p class="text-sm text-ink-500 mt-1.5">${esc(e.message)}</p>
      <button onclick="goto('${page}')" class="btn btn-primary mt-4">Thử lại</button></div>`;
  });
}

if (localStorage.sbh_token) {
  token = localStorage.sbh_token;
  api("/me").then(x => { me = x; start(); }).catch(() => logout());
}

/* ===================== dashboard ===================== */
async function home() {
  const d = await api("/dashboard");
  $("main").innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      ${statCard("Đơn hôm nay", d.orders, "pos")}
      ${statCard("Doanh thu hôm nay", money(d.revenue), "wallet")}
      ${statCard("Lợi nhuận hôm nay", money(d.profit), "stock", d.profit >= 0 ? "leaf" : "brick")}
      ${statCard("Sắp hết hàng", d.low_stock, "box", d.low_stock > 0 ? "amber" : "leaf")}
    </div>
    <div class="grid lg:grid-cols-3 gap-5 mt-5">
      <div class="card p-5 lg:col-span-2">
        <h3 class="font-head font-700 text-ink-900 mb-1">Doanh thu 7 ngày gần nhất</h3>
        <p class="text-xs text-ink-300 mb-4">Tổng doanh thu và lợi nhuận theo ngày</p>
        <canvas id="revChart" height="150"></canvas>
      </div>
      <div class="card p-5">
        <h3 class="font-head font-700 text-ink-900 mb-1">Bán chạy (30 ngày)</h3>
        <p class="text-xs text-ink-300 mb-4">Theo số lượng đã bán</p>
        <div class="space-y-3">
          ${d.top_products.length ? d.top_products.map((p, i) => `
            <div class="flex items-center gap-3">
              <span class="w-6 h-6 rounded-md bg-ink-50 text-ink-500 text-xs font-num font-600 flex items-center justify-center">${i + 1}</span>
              <span class="flex-1 text-sm truncate">${esc(p.name)}</span>
              <span class="font-num text-sm text-ink-500">×${p.qty}</span>
            </div>`).join("") : `<p class="text-sm text-ink-300">Chưa có dữ liệu bán hàng.</p>`}
        </div>
      </div>
    </div>
    <div class="card p-5 mt-5">
      <div class="flex items-center justify-between mb-1">
        <h3 class="font-head font-700 text-ink-900">Sản phẩm sắp hết hàng</h3>
        <button onclick="goto('products')" class="text-xs font-600 text-ink-500 hover:text-ink-900">Xem kho →</button>
      </div>
      <p class="text-xs text-ink-300 mb-4">Tồn kho đang bằng hoặc dưới mức tối thiểu</p>
      ${d.low_stock_items.length ? `
        <table class="w-full text-left"><thead><tr><th class="th">Mã</th><th class="th">Sản phẩm</th><th class="th">Tồn kho</th><th class="th">Tối thiểu</th></tr></thead>
        <tbody>${d.low_stock_items.map(p => `<tr><td class="td font-num">${esc(p.code)}</td><td class="td">${esc(p.name)}</td><td class="td"><span class="pill bg-brick-50 text-brick-500">${p.stock}</span></td><td class="td font-num text-ink-300">${p.min_stock}</td></tr>`).join("")}</tbody></table>
      ` : `<p class="text-sm text-leaf-600">Tất cả sản phẩm đều đủ hàng.</p>`}
    </div>`;

  const ctx = $("revChart");
  if (ctx && window.Chart) {
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: d.chart.map(c => c.date),
        datasets: [
          { label: "Doanh thu", data: d.chart.map(c => c.revenue), backgroundColor: "#13213B", borderRadius: 5, maxBarThickness: 28 },
          { label: "Lợi nhuận", data: d.chart.map(c => c.profit), backgroundColor: "#D89A2A", borderRadius: 5, maxBarThickness: 28 },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, font: { family: "IBM Plex Sans", size: 12 } } } },
        scales: {
          y: { ticks: { callback: (v) => (v >= 1000 ? v / 1000 + "k" : v), font: { family: "IBM Plex Mono", size: 11 } }, grid: { color: "#EFEEE8" } },
          x: { grid: { display: false }, ticks: { font: { family: "IBM Plex Sans", size: 11 } } },
        },
      },
    });
  }
}
function statCard(label, value, iconName, tone) {
  const toneMap = { amber: "text-amber-500", leaf: "text-leaf-600", brick: "text-brick-500" };
  return `<div class="card p-4">
    <div class="flex items-center justify-between">
      <span class="text-xs font-600 text-ink-300 uppercase tracking-wide">${label}</span>
      <span class="text-ink-300">${icon(iconName, "w-4 h-4")}</span>
    </div>
    <div class="font-head font-800 text-2xl mt-2 ${toneMap[tone] || "text-ink-900"}">${value}</div>
  </div>`;
}

/* ===================== POS ===================== */
async function pos() {
  [P, C] = await Promise.all([api("/products"), api("/customers")]);
  cart = [];
  $("main").innerHTML = `
    <div class="grid lg:grid-cols-5 gap-5">
      <div class="lg:col-span-3 card p-4">
        <input id="q" type="search" placeholder="Tìm theo tên hoặc mã sản phẩm (Enter để thêm nhanh)..." oninput="drawP()" onkeydown="if(event.key==='Enter')addFirstMatch()">
        <div id="plist" class="grid sm:grid-cols-2 gap-2.5 mt-3 max-h-[60vh] overflow-y-auto pr-1"></div>
      </div>
      <div class="lg:col-span-2">
        <div class="card p-4 sticky top-20">
          <h3 class="font-head font-700 mb-3">Hóa đơn</h3>
          <div id="cart" class="space-y-2 max-h-[30vh] overflow-y-auto mb-2"></div>
          <div class="ticket-edge h-px my-3"></div>
          <div class="flex gap-2 mb-2">
            <select id="cus" onchange="showCusInfo()"></select>
            <button onclick="posCustomerForm()" class="btn btn-ghost !px-3 whitespace-nowrap">+ Khách mới</button>
          </div>
          <div id="cusInfo" class="text-xs text-ink-500 bg-ink-50 rounded-lg px-3 py-2 mb-2 leading-relaxed hide"></div>
          <div class="grid grid-cols-2 gap-2 mb-2">
            <div><label class="text-[11px] font-600 text-ink-500 mb-1 block">Chiết khấu cả đơn (%)</label><input id="discPct" type="number" min="0" max="100" placeholder="0" value="0" oninput="drawCart()"></div>
            <div><label class="text-[11px] font-600 text-ink-500 mb-1 block">Phí ship (đ)</label><input id="ship" type="number" min="0" placeholder="0" value="0" oninput="drawCart()"></div>
          </div>
          <select id="pay" onchange="drawCart()" class="mb-2">
            <option value="cash">Tiền mặt</option>
            <option value="transfer">Chuyển khoản</option>
            <option value="card">Quẹt thẻ</option>
          </select>
          <input id="cash" type="number" placeholder="Tiền khách đưa" oninput="drawCart()" class="mb-3">
          <div class="space-y-1 text-sm font-num mb-3">
            <div class="flex justify-between text-ink-300"><span>Tạm tính</span><span id="sumSub">0đ</span></div>
            <div id="sumItemRow" class="flex justify-between text-brick-500 hide"><span>Chiết khấu mặt hàng</span><span id="sumItemDisc">-0đ</span></div>
            <div id="sumDiscRow" class="flex justify-between text-brick-500 hide"><span id="sumDiscLabel">Chiết khấu cả đơn</span><span id="sumDisc">-0đ</span></div>
            <div class="flex justify-between text-ink-900"><span>Sau chiết khấu</span><span id="sumAfter">0đ</span></div>
            <div class="flex justify-between text-ink-300"><span>Phí ship</span><span id="sumShip">0đ</span></div>
            <div class="flex justify-between text-ink-900 font-head font-800 text-lg pt-1 border-t border-ink-100"><span class="font-body font-600 text-sm">Tổng cộng</span><span id="sumTotal">0đ</span></div>
            <div id="sumChange" class="flex justify-between text-leaf-600 hide"><span>Tiền thừa</span><span></span></div>
          </div>
          <button onclick="checkout()" class="btn btn-amber w-full py-3">Thanh toán</button>
        </div>
      </div>
    </div>`;
  fillCus(); drawP(); drawCart();
}
function drawP() {
  const q = norm($("q")?.value || "");
  const list = P.filter(p => norm(p.name).includes(q) || norm(p.code).includes(q));
  $("plist").innerHTML = list.length ? list.map(p => `
    <button onclick="addToCart(${p.id})" class="text-left border border-ink-100 rounded-xl p-3 hover:border-ink-900 transition ${p.stock <= 0 ? 'opacity-40 pointer-events-none' : ''}">
      <div class="font-num text-[11px] text-ink-300 mb-0.5">${esc(p.code)}</div>
      <div class="text-sm font-600 truncate">${esc(p.name)}</div>
      <div class="flex items-center justify-between mt-1.5">
        <span class="font-num text-sm text-ink-900">${money(p.price)}</span>
        <span class="text-xs text-ink-300">Tồn ${p.stock}</span>
      </div>
    </button>`).join("") : `<p class="text-sm text-ink-300 col-span-2 py-6 text-center">Không tìm thấy sản phẩm.</p>`;
}
function lineNet(price, qty, disc) { return Math.round(price * qty * (100 - (disc || 0)) / 100); }
function addToCart(id) {
  const line = cart.find(a => a.id === id), p = P.find(a => a.id === id);
  if (!line) cart.push({ id, qty: 1, disc: 0 });
  else if (line.qty < p.stock) line.qty++;
  else return toast("Không đủ tồn kho", "err");
  drawCart();
}
function cartQty(id, delta) {
  const line = cart.find(a => a.id === id), p = P.find(a => a.id === id);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) cart = cart.filter(a => a.id !== id);
  else if (line.qty > p.stock) { line.qty = p.stock; toast("Không đủ tồn kho", "err"); }
  drawCart();
}
function setQty(id, v) {
  const line = cart.find(a => a.id === id), p = P.find(a => a.id === id);
  if (!line) return;
  let n = Math.floor(+v);
  if (!(n >= 1)) return; // đang gõ dở, chờ nhập xong
  if (n > p.stock) { n = p.stock; toast(`Chỉ còn ${p.stock} sản phẩm trong kho`, "err"); $("q" + id).value = n; }
  line.qty = n;
  $("lt" + id).textContent = money(lineNet(p.price, n, line.disc));
  drawSummary();
}
function fixQty(id) {
  const line = cart.find(a => a.id === id);
  if (line && $("q" + id)) $("q" + id).value = line.qty;
}
function addFirstMatch() {
  const q = norm(($("q").value || "").trim());
  if (!q) return;
  const list = P.filter(p => p.stock > 0 && (norm(p.name).includes(q) || norm(p.code).includes(q)));
  const hit = list.find(p => norm(p.code) === q) || list[0];
  if (!hit) return toast("Không tìm thấy sản phẩm còn hàng", "err");
  addToCart(hit.id); $("q").value = ""; drawP(); $("q").focus();
}
function fillCus(selected = "") {
  $("cus").innerHTML = `<option value="">Khách lẻ</option>` +
    C.map(c => `<option value="${c.id}" ${String(c.id) === String(selected) ? "selected" : ""}>${c.code ? esc(c.code) + " · " : ""}${esc(c.name)}${c.phone ? " · " + esc(c.phone) : ""}</option>`).join("");
  showCusInfo();
}
function showCusInfo() {
  const c = C.find(x => x.id === +$("cus").value), box = $("cusInfo");
  const parts = c ? [c.code && `Mã KH: <b class="font-num">${esc(c.code)}</b>`, c.tax_code && `MST: <b class="font-num">${esc(c.tax_code)}</b>`, c.phone && `SĐT: <b class="font-num">${esc(c.phone)}</b>`, c.address && `Địa chỉ: ${esc(c.address)}`].filter(Boolean) : [];
  box.innerHTML = parts.join("<br>");
  box.classList.toggle("hide", !parts.length);
}
function posCustomerForm() {
  modal(`
    <div class="space-y-4">
      ${sect("Thông tin khách hàng")}
      <div class="grid grid-cols-2 gap-4">
        ${fld(`Mã khách hàng ${autoBadge}`, `<input id="ncc" readonly placeholder="Đang tạo mã...">`)}
        ${fld("Tên khách hàng", `<input id="ncn" placeholder="Tên khách hoặc công ty">`, { req: true })}
      </div>
      ${sect("Liên hệ & xuất hóa đơn")}
      <div class="grid grid-cols-2 gap-4">
        ${fld("Mã số thuế", `<input id="nct" placeholder="10 hoặc 13 chữ số">`)}
        ${fld("Số điện thoại", `<input id="ncp" placeholder="09xx xxx xxx">`)}
        ${fld("Địa chỉ", `<input id="nca" placeholder="Số nhà, đường, quận/huyện, tỉnh/thành">`, { cls: "col-span-2" })}
      </div>
      <p class="text-xs text-ink-300">Khách mới sẽ được lưu vào danh sách khách hàng và chọn luôn cho đơn này.</p>
      <button onclick="savePosCustomer()" class="btn btn-primary w-full py-3">Lưu &amp; chọn khách này</button>
    </div>`, { title: "Khách hàng mới", wide: "lg" });
  loadNextCode("customer", "ncc");
  setTimeout(() => $("ncn") && $("ncn").focus(), 50);
}
async function savePosCustomer() {
  if (!$("ncn").value.trim()) return toast("Vui lòng nhập tên khách hàng", "err");
  try {
    const r = await api("/customers", { method: "POST", body: JSON.stringify({
      name: $("ncn").value.trim(), address: $("nca").value, tax_code: $("nct").value, phone: $("ncp").value,
    })});
    C = await api("/customers");
    closeModal(); fillCus(r.id); toast("Đã thêm khách hàng vào danh sách");
  } catch (e) { toast(e.message, "err"); }
}
function setLineDisc(id, v) {
  const line = cart.find(a => a.id === id), p = P.find(a => a.id === id);
  if (!line) return;
  line.disc = Math.min(100, Math.max(0, +v || 0));
  const el = $("lt" + id);
  if (el) el.textContent = money(lineNet(p.price, line.qty, line.disc));
  drawSummary();
}
function cartSub() {
  let gross = 0, net = 0;
  cart.forEach(x => { const p = P.find(a => a.id === x.id); gross += p.price * x.qty; net += lineNet(p.price, x.qty, x.disc); });
  return { gross, net };
}
function calcTotals(sub) {
  const pct = Math.min(100, Math.max(0, +$("discPct").value || 0));
  const discount = Math.min(sub, Math.round(sub * pct / 100));
  const after = sub - discount;
  const ship = Math.max(0, +$("ship").value || 0);
  return { pct, discount, after, ship, total: after + ship };
}
function drawCart() {
  if (!$("cart")) return;
  $("cart").innerHTML = cart.length ? cart.map(x => {
    const p = P.find(a => a.id === x.id);
    return `<div class="py-2 border-b border-ink-50 last:border-0">
      <div class="flex items-center gap-2 text-sm">
        <span class="flex-1 truncate">${esc(p.name)} <span class="font-num text-[11px] text-ink-300">${esc(p.code)}</span></span>
        <button onclick="cartQty(${x.id},-1)" class="w-6 h-6 rounded-md bg-ink-50 text-ink-500 hover:bg-ink-100">−</button>
        <input id="q${x.id}" type="number" min="1" max="${p.stock}" value="${x.qty}" oninput="setQty(${x.id}, this.value)" onchange="fixQty(${x.id})" class="!w-14 !px-1 !py-1 text-center font-num !text-sm">
        <button onclick="cartQty(${x.id},1)" class="w-6 h-6 rounded-md bg-ink-50 text-ink-500 hover:bg-ink-100">+</button>
        <span id="lt${x.id}" class="font-num w-24 text-right">${money(lineNet(p.price, x.qty, x.disc))}</span>
      </div>
      <div class="flex items-center justify-between mt-1.5 text-xs text-ink-300">
        <span class="font-num">${money(p.price)} / sp</span>
        <label class="flex items-center gap-1.5">Chiết khấu
          <input type="number" min="0" max="100" placeholder="0" value="${x.disc || ""}" oninput="setLineDisc(${x.id}, this.value)" class="!w-16 !py-1 !px-2 !text-xs text-right font-num">%
        </label>
      </div>
    </div>`;
  }).join("") : `<p class="text-sm text-ink-300 text-center py-4">Chưa có sản phẩm trong giỏ.</p>`;
  drawSummary();
}
function drawSummary() {
  if (!$("sumSub")) return;
  const c = cartSub(), t = calcTotals(c.net), itemDisc = c.gross - c.net;
  $("sumSub").textContent = money(c.gross);
  $("sumItemRow").classList.toggle("hide", itemDisc <= 0);
  $("sumItemDisc").textContent = "-" + money(itemDisc);
  $("sumDiscRow").classList.toggle("hide", t.discount <= 0);
  $("sumDiscLabel").textContent = "Chiết khấu cả đơn" + (t.pct ? ` (${t.pct}%)` : "");
  $("sumDisc").textContent = "-" + money(t.discount);
  $("sumAfter").textContent = money(t.after);
  $("sumShip").textContent = money(t.ship);
  $("sumTotal").textContent = money(t.total);
  const cash = +$("cash").value || 0, chEl = $("sumChange");
  if ($("pay").value === "cash" && cash > 0) { chEl.classList.remove("hide"); chEl.querySelector("span:last-child").textContent = money(Math.max(0, cash - t.total)); }
  else chEl.classList.add("hide");
}
function checkout() {
  if (!cart.length) return toast("Giỏ hàng đang trống", "err");
  const c = cartSub(), t = calcTotals(c.net), cash = +$("cash").value || 0;
  const cid = $("cus").value ? +$("cus").value : null;
  pending = {
    gross: c.gross, itemDisc: c.gross - c.net, sub: c.net,
    pct: t.pct, discount: t.discount, after: t.after, ship: t.ship, total: t.total, cash, cid,
    cname: cid ? C.find(c => c.id === cid).name : "Khách lẻ",
    cinfo: cid ? C.find(c => c.id === cid) : null,
    pay: $("pay").value,
    lines: cart.map(x => { const p = P.find(a => a.id === x.id); return { name: p.name, code: p.code, qty: x.qty, price: p.price, disc: x.disc || 0, net: lineNet(p.price, x.qty, x.disc) }; }),
    items: cart.map(x => ({ product_id: x.id, qty: x.qty, discount_pct: x.disc || 0 })),
    orderId: null, change: 0, time: new Date(),
  };
  renderCheckout();
}

function renderCheckout() {
  const o = pending, done = !!o.orderId, isCash = o.pay === "cash";
  const cashBlock = !isCash ? "" : done
    ? `<div class="flex justify-between text-ink-300"><span>Tiền khách đưa</span><span>${money(o.cash)}</span></div>
       <div class="flex justify-between text-leaf-600"><span>Tiền thừa</span><span>${money(o.change)}</span></div>`
    : `<div class="flex items-center justify-between gap-3 pt-2">
         <span class="text-ink-300 font-body text-sm">Tiền khách đưa</span>
         <input id="mcash" type="number" value="${o.cash || ""}" placeholder="0" oninput="updateModalCash()" class="!w-40 text-right font-num">
       </div>
       <div class="flex justify-between text-leaf-600"><span>Tiền thừa</span><span id="mchange">${money(Math.max(0, o.cash - o.total))}</span></div>
       <p id="mwarn" class="text-brick-500 text-xs font-body text-right min-h-[16px]">${o.cash < o.total ? "Tiền khách đưa chưa đủ" : ""}</p>`;

  modal(`
    <div class="flex justify-between text-sm mb-1"><span class="text-ink-300">Khách hàng</span><span class="font-600">${esc(o.cname)}</span></div>
    ${o.cinfo && o.cinfo.tax_code ? `<div class="flex justify-between text-sm mb-1"><span class="text-ink-300">Mã số thuế</span><span class="font-num font-600">${esc(o.cinfo.tax_code)}</span></div>` : ""}
    ${o.cinfo && o.cinfo.address ? `<div class="flex justify-between text-sm mb-1 gap-4"><span class="text-ink-300">Địa chỉ</span><span class="text-right">${esc(o.cinfo.address)}</span></div>` : ""}
    <div class="flex justify-between text-sm mb-1"><span class="text-ink-300">Thanh toán</span><span class="font-600">${payLabel(o.pay)}</span></div>
    ${done ? `<div class="flex justify-between text-sm mb-1"><span class="text-ink-300">Mã đơn</span><span class="font-num font-600">#${o.orderId}</span></div>` : ""}
    <div class="ticket-edge h-px my-3"></div>
    <div class="space-y-1.5 mb-3">${o.lines.map(l => `
      <div class="flex justify-between text-sm gap-3">
        <span>${esc(l.name)} <span class="font-num text-[11px] text-ink-300">${esc(l.code || "")}</span> <span class="text-ink-300">× ${l.qty}</span>${l.disc ? `<span class="pill bg-brick-50 text-brick-500 ml-1.5">-${l.disc}%</span>` : ""}</span>
        <span class="font-num whitespace-nowrap">${l.disc ? `<s class="text-ink-300 mr-1.5">${money(l.price * l.qty)}</s>` : ""}${money(l.net)}</span>
      </div>`).join("")}</div>
    <div class="ticket-edge h-px my-3"></div>
    <div class="space-y-1 text-sm font-num">
      <div class="flex justify-between text-ink-300"><span>Tạm tính</span><span>${money(o.gross)}</span></div>
      ${o.itemDisc > 0 ? `<div class="flex justify-between text-brick-500"><span>Chiết khấu mặt hàng</span><span>-${money(o.itemDisc)}</span></div>` : ""}
      ${o.discount > 0 ? `<div class="flex justify-between text-brick-500"><span>Chiết khấu cả đơn${o.pct ? ` (${o.pct}%)` : ""}</span><span>-${money(o.discount)}</span></div>` : ""}
      <div class="flex justify-between text-ink-900"><span>Sau chiết khấu</span><span>${money(o.after)}</span></div>
      <div class="flex justify-between text-ink-300"><span>Phí ship</span><span>${money(o.ship)}</span></div>
      <div class="flex justify-between font-head font-800 text-lg pt-2 border-t border-ink-100"><span class="font-body font-600 text-sm">Tổng cộng</span><span>${money(o.total)}</span></div>
      ${cashBlock}
    </div>
    ${done ? "" : `<label class="flex items-center gap-2 text-sm text-ink-500 mt-4 cursor-pointer select-none">
      <input type="checkbox" ${autoXl() ? "checked" : ""} onchange="setAutoXl(this.checked)" class="w-4 h-4 accent-[#13213B]">Tự động tải file Excel sau khi thanh toán</label>`}
    ${done
      ? `<div class="grid grid-cols-3 gap-3 mt-4">
           <button onclick="printReceipt()" class="btn btn-ghost">In hóa đơn</button>
           <button onclick="exportOrder(${o.orderId})" class="btn btn-ghost">Xuất Excel</button>
           <button onclick="closeModal()" class="btn btn-primary">Đơn mới</button>
         </div>`
      : `<div class="grid grid-cols-2 gap-3 mt-4">
           <button onclick="printReceipt()" class="btn btn-ghost">In hóa đơn</button>
           <button onclick="exportDraft()" class="btn btn-ghost">Xuất Excel</button>
         </div>
         <button id="mconfirm" onclick="confirmPayment()" class="btn btn-amber w-full mt-3 py-3">Xác nhận thanh toán</button>`}
  `, { title: done ? "Thanh toán thành công" : "Xác nhận đơn hàng" });
}

function autoXl() { try { return localStorage.sbh_autoxl === "1"; } catch (e) { return false; } }
function setAutoXl(v) { try { localStorage.sbh_autoxl = v ? "1" : "0"; } catch (e) {} }
async function exportOrder(id) {
  try { await downloadFile(`/orders/${id}/export`, `hoa_don_${id}.xlsx`); toast("Đã tải file Excel hóa đơn"); }
  catch (e) { toast(e.message, "err"); }
}

async function exportDraft() {
  const o = pending;
  try {
    await downloadFile("/orders/draft-export", "phieu_tam_tinh.xlsx", {
      method: "POST",
      body: JSON.stringify({ customer_id: o.cid, customer_name: o.cname, payment: o.pay, discount: o.discount, shipping: o.ship, items: o.items }),
    });
    toast("Đã tải phiếu tạm tính (Excel)");
  } catch (e) { toast(e.message, "err"); }
}

function updateModalCash() {
  pending.cash = +$("mcash").value || 0;
  $("mchange").textContent = money(Math.max(0, pending.cash - pending.total));
  $("mwarn").textContent = pending.cash < pending.total ? "Tiền khách đưa chưa đủ" : "";
}

async function confirmPayment() {
  const o = pending;
  if (o.pay === "cash" && o.cash < o.total) return toast("Tiền khách đưa chưa đủ", "err");
  const btn = $("mconfirm"); if (btn) btn.disabled = true;
  try {
    const r = await api("/orders", { method: "POST", body: JSON.stringify({
      customer_id: o.cid, customer_name: o.cname, payment: o.pay,
      subtotal: o.sub, discount: o.discount, shipping: o.ship, total: o.total, cash_received: o.cash,
      items: o.items,
    })});
    o.orderId = r.id; o.change = r.change; o.time = new Date(); if (r.total !== undefined) o.total = r.total;
    toast(`Đã thanh toán đơn #${r.id}`);
    renderCheckout();
    if (autoXl()) exportOrder(r.id);
  } catch (e) { toast(e.message, "err"); if (btn) btn.disabled = false; }
}

function printReceipt() {
  const o = pending;
  const row = (a, b, bold) => `<tr><td${bold ? ' class="b"' : ""}>${a}</td><td class="r${bold ? " b" : ""}">${b}</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Hóa đơn</title><style>
    @page{size:80mm auto;margin:4mm}
    body{font-family:'Courier New',monospace;font-size:12px;color:#000;width:72mm;margin:0 auto}
    h1{font-size:16px;text-align:center;margin:0}
    .c{text-align:center}.r{text-align:right}.b{font-weight:bold;font-size:14px}
    table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}
    hr{border:0;border-top:1px dashed #000;margin:6px 0}
    .m{font-size:11px}
  </style></head><body>
    <h1>SỔ BÁN HÀNG</h1>
    <p class="c m">${o.orderId ? "HÓA ĐƠN BÁN HÀNG" : "PHIẾU TẠM TÍNH"}</p>
    <hr>
    <div class="m">${o.orderId ? `Mã đơn: #${o.orderId}<br>` : ""}Ngày: ${o.time.toLocaleString("vi-VN")}<br>Khách hàng: ${esc(o.cname)}<br>${o.cinfo && o.cinfo.tax_code ? "MST: " + esc(o.cinfo.tax_code) + "<br>" : ""}${o.cinfo && o.cinfo.address ? "Địa chỉ: " + esc(o.cinfo.address) + "<br>" : ""}Thanh toán: ${payLabel(o.pay)}</div>
    <hr>
    <table>${o.lines.map(l => `<tr><td colspan="2">${esc(l.code ? l.code + " - " + l.name : l.name)}</td></tr><tr><td class="m">${l.qty} x ${money(l.price)}${l.disc ? ` (CK ${l.disc}%)` : ""}</td><td class="r">${money(l.net)}</td></tr>`).join("")}</table>
    <hr>
    <table>
      ${row("Tạm tính", money(o.gross))}
      ${o.itemDisc > 0 ? row("CK mặt hàng", "-" + money(o.itemDisc)) : ""}
      ${o.discount > 0 ? row("CK cả đơn" + (o.pct ? " (" + o.pct + "%)" : ""), "-" + money(o.discount)) : ""}
      ${row("Sau chiết khấu", money(o.after))}
      ${row("Phí ship", money(o.ship))}
      ${row("TỔNG CỘNG", money(o.total), true)}
      ${o.pay === "cash" && o.cash ? row("Tiền khách đưa", money(o.cash)) + row("Tiền thừa", money(Math.max(0, o.cash - o.total))) : ""}
    </table>
    <hr>
    <p class="c m">Cảm ơn quý khách!</p>
  </body></html>`;
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  f.srcdoc = html;
  f.onload = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000); };
  document.body.appendChild(f);
}

/* ===================== orders ===================== */
let ordFilter = { from: "", to: "", q: "" }, ordTimer = null, ordSeq = 0;
function ordQuery() {
  const p = new URLSearchParams();
  if (ordFilter.from) p.set("date_from", ordFilter.from);
  if (ordFilter.to) p.set("date_to", ordFilter.to);
  if (ordFilter.q) p.set("q", ordFilter.q);
  const s = p.toString();
  return s ? "?" + s : "";
}
function searchOrdersSoon() { clearTimeout(ordTimer); ordTimer = setTimeout(() => filterOrders(), 300); }
function filterOrders(clear) {
  if (clear) { ordFilter = { from: "", to: "", q: "" }; $("ofrom").value = ""; $("oto").value = ""; $("oq").value = ""; }
  else ordFilter = { from: $("ofrom").value, to: $("oto").value, q: $("oq").value.trim() };
  if (ordFilter.from && ordFilter.to && ordFilter.from > ordFilter.to) return toast("Ngày bắt đầu phải trước ngày kết thúc", "err");
  loadOrders().catch(e => toast(e.message, "err"));
}
async function exportOrders() {
  try { await downloadFile("/orders/export" + ordQuery(), "don_hang.xlsx"); toast("Đã tải file Excel danh sách đơn hàng"); }
  catch (e) { toast(e.message, "err"); }
}
async function orders() {
  $("main").innerHTML = `
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div class="flex-1 min-w-[240px]"><label class="text-[11px] font-600 text-ink-500 mb-1 block">Tìm đơn</label>
        <input id="oq" type="search" value="${esc(ordFilter.q)}" placeholder="Mã đơn, tên khách, mã số thuế, SĐT, ghi chú..." oninput="searchOrdersSoon()" onkeydown="if(event.key==='Enter'){clearTimeout(ordTimer);filterOrders()}"></div>
      <div><label class="text-[11px] font-600 text-ink-500 mb-1 block">Từ ngày</label><input id="ofrom" type="date" value="${ordFilter.from}" onchange="filterOrders()" class="!w-44"></div>
      <div><label class="text-[11px] font-600 text-ink-500 mb-1 block">Đến ngày</label><input id="oto" type="date" value="${ordFilter.to}" onchange="filterOrders()" class="!w-44"></div>
      <button id="ordClear" onclick="filterOrders(true)" class="hide text-sm font-600 text-ink-500 hover:text-ink-900 py-2.5">Xóa lọc</button>
      <span id="ordSummary" class="text-sm text-ink-500 py-2.5"></span>
      <button onclick="exportOrders()" class="btn btn-primary">Xuất Excel</button>
    </div>
    <div class="card overflow-x-auto">
      <table class="w-full">
        <thead><tr><th class="th">#</th><th class="th">Khách hàng</th><th class="th">Mã số thuế</th><th class="th">Thanh toán</th><th class="th">Tổng tiền</th><th class="th">Lợi nhuận</th><th class="th">Thời gian</th><th class="th"></th></tr></thead>
        <tbody id="ordBody"></tbody>
      </table>
    </div>`;
  await loadOrders();
}
async function loadOrders() {
  const seq = ++ordSeq;
  const a = await api("/orders" + ordQuery());
  if (seq !== ordSeq || !$("ordBody")) return; // bỏ kết quả cũ nếu đã có lần tìm mới hơn
  const sum = a.reduce((t, o) => t + o.total, 0);
  $("ordClear").classList.toggle("hide", !(ordFilter.from || ordFilter.to || ordFilter.q));
  $("ordSummary").innerHTML = `${a.length} đơn · <span class="font-num font-600 text-ink-900">${money(sum)}</span>`;
  $("ordBody").innerHTML = a.length ? a.map(o => `
    <tr class="hover:bg-ink-50/60 cursor-pointer" onclick="orderDetail(${o.id})">
      <td class="td font-num text-ink-300">#${o.id}</td>
      <td class="td font-600">${esc(o.customer_name)}</td>
      <td class="td font-num text-ink-500">${esc(o.tax_code) || "—"}</td>
      <td class="td">${payLabel(o.payment)}</td>
      <td class="td font-num">${money(o.total)}</td>
      <td class="td font-num ${o.profit >= 0 ? "text-leaf-600" : "text-brick-500"}">${money(o.profit)}</td>
      <td class="td text-ink-300">${dt(o.created_at)}</td>
      <td class="td text-right whitespace-nowrap space-x-3">${me.role === "admin" ? `<button onclick="event.stopPropagation();orderEdit(${o.id})" class="text-xs font-600 text-ink-500 hover:text-ink-900">Sửa</button><button onclick="event.stopPropagation();deleteOrder(${o.id})" class="text-xs font-600 text-brick-500 hover:text-brick-600">Xóa</button>` : ""}</td>
    </tr>`).join("") : `<tr><td class="td text-center text-ink-300 py-8" colspan="8">${ordFilter.q || ordFilter.from || ordFilter.to ? "Không tìm thấy đơn hàng phù hợp." : "Chưa có đơn hàng nào."}</td></tr>`;
}
function payLabel(p) { return { cash: "Tiền mặt", transfer: "Chuyển khoản", card: "Quẹt thẻ" }[p] || p; }
async function orderDetail(id) {
  const o = await api(`/orders/${id}`);
  const gross = o.items.reduce((t, i) => t + i.price * i.qty, 0);
  const itemDisc = Math.max(0, gross - o.subtotal);
  const pctTxt = o.subtotal > 0 && o.discount > 0 ? ` (${(o.discount / o.subtotal * 100).toFixed(1).replace(/\.0$/, "")}%)` : "";
  modal(`
    <div class="text-sm mb-3 space-y-1">
      <div class="flex justify-between"><span class="text-ink-300">Khách hàng</span><span class="font-600">${esc(o.customer_name)}</span></div>
      ${o.customer && o.customer.tax_code ? `<div class="flex justify-between"><span class="text-ink-300">Mã số thuế</span><span class="font-num font-600">${esc(o.customer.tax_code)}</span></div>` : ""}
      ${o.customer && o.customer.address ? `<div class="flex justify-between gap-4"><span class="text-ink-300">Địa chỉ</span><span class="text-right">${esc(o.customer.address)}</span></div>` : ""}
    </div>
    <div class="space-y-1.5 mb-3">${o.items.map(i => `
      <div class="flex justify-between text-sm gap-3">
        <span>${esc(i.name)} × ${i.qty}${i.discount_pct ? `<span class="pill bg-brick-50 text-brick-500 ml-1.5">-${i.discount_pct}%</span>` : ""}</span>
        <span class="font-num whitespace-nowrap">${money(lineNet(i.price, i.qty, i.discount_pct))}</span>
      </div>`).join("")}</div>
    <div class="ticket-edge h-px my-3"></div>
    <div class="space-y-1 text-sm font-num">
      <div class="flex justify-between text-ink-300"><span>Tạm tính</span><span>${money(gross)}</span></div>
      ${itemDisc > 0 ? `<div class="flex justify-between text-brick-500"><span>Chiết khấu mặt hàng</span><span>-${money(itemDisc)}</span></div>` : ""}
      ${o.discount > 0 ? `<div class="flex justify-between text-brick-500"><span>Chiết khấu cả đơn${pctTxt}</span><span>-${money(o.discount)}</span></div>` : ""}
      <div class="flex justify-between text-ink-900"><span>Sau chiết khấu</span><span>${money(o.subtotal - o.discount)}</span></div>
      <div class="flex justify-between text-ink-300"><span>Phí ship</span><span>${money(o.shipping)}</span></div>
      <div class="flex justify-between font-head font-800 text-base pt-2 border-t border-ink-100"><span class="font-body font-600 text-sm">Tổng cộng</span><span>${money(o.total)}</span></div>
      <div class="flex justify-between text-leaf-600"><span>Lợi nhuận</span><span>${money(o.profit)}</span></div>
    </div>
    <p class="text-xs text-ink-300 mt-4">Đơn #${o.id} · ${payLabel(o.payment)} · ${dt(o.created_at)}</p>
    <div class="grid ${me.role === "admin" ? "grid-cols-3" : "grid-cols-1"} gap-3 mt-4">
      <button onclick="exportOrder(${o.id})" class="btn btn-ghost">Xuất Excel</button>
      ${me.role === "admin" ? `<button onclick="orderEdit(${o.id})" class="btn btn-ghost">Sửa đơn</button><button onclick="deleteOrder(${o.id})" class="btn btn-danger">Xóa đơn</button>` : ""}
    </div>
  `, { title: "Chi tiết đơn hàng" });
}

/* ---- sửa / xóa đơn hàng (Admin) ---- */
let eId = null, eLines = [], eOrig = {}, eKeepName = "";
async function deleteOrder(id) {
  if (!confirm(`Xóa đơn hàng #${id}?\n\nSố lượng sản phẩm trong đơn sẽ được hoàn lại kho. Thao tác không thể hoàn tác.`)) return;
  try {
    await api(`/orders/${id}`, { method: "DELETE" });
    closeModal(); toast(`Đã xóa đơn #${id} và hoàn lại kho`);
    if (currentPage === "orders") loadOrders();
  } catch (e) { toast(e.message, "err"); }
}
async function orderEdit(id) {
  let o, prods, custs;
  try { [o, prods, custs] = await Promise.all([api(`/orders/${id}`), api("/products"), api("/customers")]); }
  catch (e) { return toast(e.message, "err"); }
  P = prods; C = custs;
  o.items.forEach(i => { if (!P.find(p => p.id === i.product_id)) P.push({ id: i.product_id, code: "—", name: i.name, price: i.price, cost: 0, stock: 0, min_stock: 0, category: "" }); });
  eId = id; eOrig = {};
  o.items.forEach(i => { if (!(i.product_id in eOrig)) eOrig[i.product_id] = i.price; });
  eLines = o.items.map(i => ({ product_id: i.product_id, qty: i.qty, disc: i.discount_pct || 0 }));
  const orphan = !o.customer_id && o.customer_name && o.customer_name !== "Khách lẻ";
  eKeepName = orphan ? o.customer_name : "";
  modal(`
    <div class="space-y-4">
      ${sect("Thông tin đơn hàng")}
      <div class="grid grid-cols-2 gap-4">
        ${fld("Khách hàng", `<select id="ecus"><option value="">Khách lẻ</option>
            ${orphan ? `<option value="__keep" selected>${esc(o.customer_name)} (không còn trong danh sách)</option>` : ""}
            ${C.map(c => `<option value="${c.id}" ${c.id === o.customer_id ? "selected" : ""}>${c.code ? esc(c.code) + " · " : ""}${esc(c.name)}</option>`).join("")}</select>`)}
        ${fld("Thanh toán", `<select id="epay">${[["cash", "Tiền mặt"], ["transfer", "Chuyển khoản"], ["card", "Quẹt thẻ"]].map(([v, t]) => `<option value="${v}" ${o.payment === v ? "selected" : ""}>${t}</option>`).join("")}</select>`)}
        ${fld("Ghi chú", `<input id="enote" value="${esc(o.note || "")}" placeholder="Ghi chú đơn hàng (tuỳ chọn)">`, { cls: "col-span-2" })}
      </div>
      ${sect("Sản phẩm")}
      <div>
        <div class="grid grid-cols-12 gap-2 text-[11px] font-600 text-ink-500 mb-1.5"><span class="col-span-5">Sản phẩm</span><span class="col-span-1 text-center">SL</span><span class="col-span-2">CK (%)</span><span class="col-span-3 text-right">Thành tiền</span></div>
        <div id="el"></div>
        <datalist id="editProds">${P.map(p => `<option value="${esc(p.code)} — ${esc(p.name)}"></option>`).join("")}</datalist>
        <button onclick="addEditLine()" class="text-sm font-600 text-ink-500 hover:text-ink-900 mt-1">+ Thêm dòng</button>
      </div>
      ${sect("Tiền")}
      <div class="grid grid-cols-2 gap-4">
        ${fld("Chiết khấu cả đơn (đ)", `<input id="edisc" type="number" min="0" value="${o.discount || 0}" oninput="updateEditTotal()">`)}
        ${fld("Phí ship (đ)", `<input id="eship" type="number" min="0" value="${o.shipping || 0}" oninput="updateEditTotal()">`)}
      </div>
      <div class="space-y-1 pt-3 border-t border-ink-100 text-sm font-num">
        <div class="flex justify-between text-ink-300"><span>Tạm tính (sau CK mặt hàng)</span><span id="esub">0 đ</span></div>
        <div class="flex justify-between text-brick-500"><span>Chiết khấu cả đơn</span><span id="edv">-0 đ</span></div>
        <div class="flex justify-between items-center"><span class="font-body font-600">Tổng cộng</span><span id="etotal" class="font-head font-800 text-lg">0 đ</span></div>
      </div>
      <p class="text-xs text-ink-300">Lưu thay đổi sẽ tự điều chỉnh tồn kho theo chênh lệch số lượng. Sản phẩm đã có trong đơn giữ nguyên giá bán lúc bán.</p>
      <button onclick="saveOrderEdit()" class="btn btn-primary w-full py-3">Lưu thay đổi</button>
    </div>`, { title: `Sửa đơn hàng #${id}`, wide: true });
  drawEditLines();
}
function editPrice(l) { return l.product_id in eOrig ? eOrig[l.product_id] : ((P.find(p => p.id === l.product_id) || {}).price || 0); }
function drawEditLines() {
  $("el").innerHTML = eLines.map((l, i) => `
    <div class="grid grid-cols-12 gap-2 items-center mb-2">
      <input class="col-span-5" list="editProds" value="${esc(prodLabel(l.product_id))}" placeholder="Gõ tên hoặc mã sản phẩm..." onfocus="this.select()" onchange="pickEditProduct(${i}, this.value)">
      <input class="col-span-1 !px-1 text-center" type="number" min="1" value="${l.qty}" oninput="setEdit(${i},'qty',this.value)">
      <input class="col-span-2" type="number" min="0" max="100" value="${l.disc || ""}" placeholder="0" oninput="setEdit(${i},'disc',this.value)">
      <span id="et${i}" class="col-span-3 text-right text-sm font-num">${l.product_id ? money(lineNet(editPrice(l), l.qty, l.disc)) : "—"}</span>
      <button onclick="delEditLine(${i})" class="col-span-1 text-ink-300 hover:text-brick-500" title="Xóa dòng">✕</button>
    </div>`).join("");
  updateEditTotal();
}
function pickEditProduct(i, text) {
  const l = eLines[i];
  if (!text.trim()) { l.product_id = null; return drawEditLines(); }
  const p = findProductByText(text);
  if (!p) toast("Không tìm thấy sản phẩm, hãy gõ tên hoặc mã rồi chọn trong danh sách", "err");
  else l.product_id = p.id;
  drawEditLines();
}
function setEdit(i, k, v) {
  const l = eLines[i];
  l[k] = k === "disc" ? Math.min(100, Math.max(0, +v || 0)) : Math.max(0, Math.floor(+v) || 0);
  if (l.product_id && $("et" + i)) $("et" + i).textContent = money(lineNet(editPrice(l), l.qty, l.disc));
  updateEditTotal();
}
function addEditLine() {
  eLines.push({ product_id: null, qty: 1, disc: 0 });
  drawEditLines();
  const ins = $("el").querySelectorAll("input[list]");
  if (ins.length) ins[ins.length - 1].focus();
}
function delEditLine(i) {
  if (eLines.length === 1) eLines[0] = { product_id: null, qty: 1, disc: 0 }; else eLines.splice(i, 1);
  drawEditLines();
}
function updateEditTotal() {
  const sub = eLines.reduce((t, l) => l.product_id ? t + lineNet(editPrice(l), l.qty, l.disc) : t, 0);
  const disc = Math.min(sub, Math.max(0, +$("edisc").value || 0)), ship = Math.max(0, +$("eship").value || 0);
  $("esub").textContent = money(sub);
  $("edv").textContent = "-" + money(disc);
  $("etotal").textContent = money(sub - disc + ship);
}
async function saveOrderEdit() {
  const lines = eLines.filter(l => l.product_id);
  if (!lines.length) return toast("Đơn hàng cần ít nhất một sản phẩm", "err");
  if (lines.some(l => !(l.qty > 0))) return toast("Số lượng mỗi dòng phải lớn hơn 0", "err");
  const cv = $("ecus").value;
  const cid = cv && cv !== "__keep" ? +cv : null;
  const cname = cv === "__keep" ? eKeepName : (cid ? C.find(c => c.id === cid).name : "Khách lẻ");
  try {
    await api(`/orders/${eId}`, { method: "PUT", body: JSON.stringify({
      customer_id: cid, customer_name: cname, payment: $("epay").value, note: $("enote").value,
      discount: +$("edisc").value || 0, shipping: +$("eship").value || 0,
      items: lines.map(l => ({ product_id: l.product_id, qty: l.qty, discount_pct: l.disc })),
    })});
    closeModal(); toast(`Đã cập nhật đơn #${eId}`);
    if (currentPage === "orders") loadOrders();
  } catch (e) { toast(e.message, "err"); }
}

/* ===================== customers ===================== */
async function customers() {
  C = await api("/customers");
  $("main").innerHTML = `
    <div class="flex justify-end mb-4"><button onclick="customerForm()" class="btn btn-primary">+ Khách hàng mới</button></div>
    <div class="card overflow-x-auto"><table class="w-full">
      <thead><tr><th class="th">Mã KH</th><th class="th">Tên khách hàng</th><th class="th">Mã số thuế</th><th class="th">Điện thoại</th><th class="th">Địa chỉ</th><th class="th"></th></tr></thead>
      <tbody>${C.length ? C.map(c => `
        <tr class="hover:bg-ink-50/60">
          <td class="td font-num text-ink-500">${esc(c.code) || "—"}</td>
          <td class="td font-600">${esc(c.name)}</td>
          <td class="td font-num">${esc(c.tax_code) || "—"}</td>
          <td class="td font-num">${esc(c.phone) || "—"}</td>
          <td class="td text-ink-500">${esc(c.address) || "—"}</td>
          <td class="td text-right whitespace-nowrap space-x-3"><button onclick="customerForm(${c.id})" class="text-xs font-600 text-ink-500 hover:text-ink-900">Sửa</button>${me.role === "admin" ? `<button onclick="deleteCustomer(${c.id})" class="text-xs font-600 text-brick-500 hover:text-brick-600">Xóa</button>` : ""}</td>
        </tr>`).join("") : `<tr><td class="td text-center text-ink-300 py-8" colspan="6">Chưa có khách hàng nào.</td></tr>`}</tbody>
    </table></div>`;
}
function customerForm(id) {
  const c = id ? C.find(x => x.id === id) : null;
  modal(`
    <div class="space-y-4">
      ${sect("Thông tin khách hàng")}
      <div class="grid grid-cols-2 gap-4">
        ${fld(`Mã khách hàng ${autoBadge}`, `<input id="cc" value="${c ? esc(c.code || "") : ""}" readonly placeholder="Đang tạo mã...">`)}
        ${fld("Tên khách hàng", `<input id="cn" value="${c ? esc(c.name) : ""}" placeholder="Tên khách hoặc công ty">`, { req: true })}
      </div>
      ${sect("Liên hệ & xuất hóa đơn")}
      <div class="grid grid-cols-2 gap-4">
        ${fld("Số điện thoại", `<input id="cp" value="${c ? esc(c.phone) : ""}" placeholder="09xx xxx xxx">`)}
        ${fld("Mã số thuế", `<input id="ctax" value="${c ? esc(c.tax_code || "") : ""}" placeholder="10 hoặc 13 chữ số">`, { hint: "Dùng khi xuất hóa đơn công ty" })}
        ${fld("Địa chỉ", `<input id="ca" value="${c ? esc(c.address) : ""}" placeholder="Số nhà, đường, quận/huyện, tỉnh/thành">`, { cls: "col-span-2" })}
      </div>
      ${fld("Ghi chú", `<input id="cnote" value="${c ? esc(c.note || "") : ""}" placeholder="Thông tin thêm (tuỳ chọn)">`)}
      <button onclick="saveCustomer(${id || "null"})" class="btn btn-primary w-full py-3">${c ? "Lưu thay đổi" : "Thêm khách hàng"}</button>
    </div>`, { title: c ? "Sửa khách hàng" : "Khách hàng mới", wide: "lg" });
  if (!c || !c.code) loadNextCode("customer", "cc");
}
async function deleteCustomer(id) {
  const c = C.find(x => x.id === id);
  const note = c.order_count ? `\n\n${c.order_count} đơn hàng của khách này vẫn được giữ lại (kèm tên khách) nhưng không còn liên kết với danh sách khách hàng.` : "";
  if (!confirm(`Xóa khách hàng "${c.name}"?${note}`)) return;
  try { await api(`/customers/${id}`, { method: "DELETE" }); toast("Đã xóa khách hàng"); customers(); }
  catch (e) { toast(e.message, "err"); }
}
async function saveCustomer(id) {
  if (!$("cn").value.trim()) return toast("Vui lòng nhập tên khách hàng", "err");
  const body = JSON.stringify({ name: $("cn").value, phone: $("cp").value, address: $("ca").value, tax_code: $("ctax").value, note: $("cnote").value });
  try {
    await api(id ? `/customers/${id}` : "/customers", { method: id ? "PUT" : "POST", body });
    closeModal(); toast("Đã lưu khách hàng"); customers();
  } catch (e) { toast(e.message, "err"); }
}

/* ===================== products ===================== */
let prodView = "items", prodQ = "", prodCat = "", catCache = [];

async function products() {
  [P, catCache] = await Promise.all([api("/products"), api("/categories")]);
  const tabs = `<div class="inline-flex bg-white border border-ink-100 rounded-xl p-1 mb-5">
    ${[["items", "Sản phẩm"], ["cats", "Danh mục"]].map(([k, l]) => `
      <button onclick="prodView='${k}';products()" class="px-4 py-2 rounded-lg text-sm font-600 ${prodView === k ? "bg-ink-900 text-white" : "text-ink-500 hover:text-ink-900"}">${l}</button>`).join("")}
  </div>`;
  $("main").innerHTML = tabs + (prodView === "cats" ? categoriesShell() : productsShell());
  if (prodView === "cats") drawCategories(); else drawProducts();
}
function productsShell() {
  return `
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div class="flex-1 min-w-[240px]"><label class="text-[11px] font-600 text-ink-500 mb-1 block">Tìm sản phẩm</label>
        <input id="pq" type="search" value="${esc(prodQ)}" placeholder="Tên sản phẩm hoặc mã..." oninput="drawProducts()"></div>
      <div><label class="text-[11px] font-600 text-ink-500 mb-1 block">Danh mục</label>
        <select id="pcf" onchange="drawProducts()" class="!w-48">
          <option value="">Tất cả danh mục</option>
          <option value="__none" ${prodCat === "__none" ? "selected" : ""}>Chưa phân loại</option>
          ${catCache.map(c => `<option value="${esc(c.name)}" ${c.name === prodCat ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
        </select></div>
      <span id="pSummary" class="text-sm text-ink-500 py-2.5"></span>
      <button onclick="productForm()" class="btn btn-primary">+ Sản phẩm mới</button>
    </div>
    <div class="card overflow-x-auto"><table class="w-full">
      <thead><tr><th class="th">Mã</th><th class="th">Tên sản phẩm</th><th class="th">Danh mục</th><th class="th">Giá bán</th><th class="th">Giá vốn</th><th class="th">Tồn kho</th><th class="th"></th></tr></thead>
      <tbody id="pBody"></tbody>
    </table></div>`;
}

/* ---- danh mục sản phẩm ---- */
function categoriesShell() {
  return `
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div class="flex-1 min-w-[240px]"><label class="text-[11px] font-600 text-ink-500 mb-1 block">Tìm danh mục</label>
        <input id="cq" type="search" placeholder="Tên danh mục..." oninput="drawCategories()"></div>
      <span id="cSummary" class="text-sm text-ink-500 py-2.5"></span>
      <button onclick="categoryForm()" class="btn btn-primary">+ Danh mục mới</button>
    </div>
    <div class="card overflow-x-auto"><table class="w-full">
      <thead><tr><th class="th">Tên danh mục</th><th class="th">Số sản phẩm</th><th class="th"></th></tr></thead>
      <tbody id="cBody"></tbody>
    </table></div>`;
}
function drawCategories() {
  if (!$("cBody")) return;
  const q = norm($("cq").value.trim());
  const list = q ? catCache.filter(c => norm(c.name).includes(q)) : catCache;
  const none = P.filter(p => !p.category).length;
  $("cSummary").textContent = q ? `${list.length} / ${catCache.length} danh mục` : `${catCache.length} danh mục`;
  $("cBody").innerHTML = (list.length ? list.map(c => `
    <tr class="hover:bg-ink-50/60">
      <td class="td font-600">${esc(c.name)}</td>
      <td class="td font-num">${c.count > 0 ? `<button onclick="viewCategory(${c.id})" class="text-ink-900 underline decoration-ink-100 hover:decoration-ink-900">${c.count}</button>` : `<span class="text-ink-300">0</span>`}</td>
      <td class="td text-right whitespace-nowrap space-x-3">
        <button onclick="categoryForm(${c.id})" class="text-xs font-600 text-ink-500 hover:text-ink-900">Sửa tên</button>
        <button onclick="deleteCategory(${c.id})" class="text-xs font-600 text-brick-500 hover:text-brick-600">Xóa</button>
      </td>
    </tr>`).join("") : `<tr><td class="td text-center text-ink-300 py-8" colspan="3">${q ? "Không tìm thấy danh mục phù hợp." : "Chưa có danh mục nào."}</td></tr>`)
    + (!q && none ? `<tr class="bg-ink-50/40"><td class="td text-ink-500">Chưa phân loại</td><td class="td font-num">${none}</td><td class="td"></td></tr>` : "");
}
function viewCategory(id) { prodCat = catCache.find(c => c.id === id).name; prodView = "items"; products(); }
function categoryForm(id) {
  const c = id ? catCache.find(x => x.id === id) : null;
  modal(`
    <div class="space-y-3">
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Tên danh mục</label>
        <input id="catn" value="${c ? esc(c.name) : ""}" placeholder="Ví dụ: Đồ uống, Thực phẩm khô..." onkeydown="if(event.key==='Enter')saveCategory(${id || "null"})"></div>
      ${c ? `<p class="text-xs text-ink-300">Đổi tên sẽ cập nhật cho ${c.count} sản phẩm đang thuộc danh mục này.</p>` : `<p class="text-xs text-ink-300">Danh mục mới sẽ dùng được ngay khi thêm hoặc sửa sản phẩm.</p>`}
      <button onclick="saveCategory(${id || "null"})" class="btn btn-primary w-full">${c ? "Lưu thay đổi" : "Thêm danh mục"}</button>
    </div>`, { title: c ? "Sửa danh mục" : "Danh mục mới" });
  setTimeout(() => $("catn") && $("catn").focus(), 50);
}
async function saveCategory(id) {
  if (!$("catn").value.trim()) return toast("Vui lòng nhập tên danh mục", "err");
  try {
    await api(id ? `/categories/${id}` : "/categories", { method: id ? "PUT" : "POST", body: JSON.stringify({ name: $("catn").value }) });
    closeModal(); toast("Đã lưu danh mục"); products();
  } catch (e) { toast(e.message, "err"); }
}
async function deleteCategory(id) {
  const c = catCache.find(x => x.id === id);
  if (!confirm(`Xóa danh mục "${c.name}"?`)) return;
  try { await api(`/categories/${id}`, { method: "DELETE" }); toast("Đã xóa danh mục"); products(); }
  catch (e) { toast(e.message, "err"); }
}

/* ---- chọn / tạo nhanh danh mục trong form sản phẩm (giống "+ Khách mới") ---- */
function catOptions(sel) {
  const names = catCache.map(c => c.name);
  if (sel && !names.includes(sel)) names.push(sel);
  return `<option value="">— Chưa phân loại —</option>` + names.map(n => `<option value="${esc(n)}" ${n === sel ? "selected" : ""}>${esc(n)}</option>`).join("");
}
function toggleNewCat() {
  const row = $("newCatRow");
  row.classList.toggle("hide");
  if (!row.classList.contains("hide")) $("newCat").focus();
}
async function saveNewCat() {
  const name = $("newCat").value.trim();
  if (!name) return toast("Vui lòng nhập tên danh mục", "err");
  const ex = catCache.find(c => c.name.toLowerCase() === name.toLowerCase());
  try {
    let chosen = ex && ex.name;
    if (!ex) {
      const r = await api("/categories", { method: "POST", body: JSON.stringify({ name }) });
      catCache.push({ id: r.id, name: r.name, count: 0 });
      chosen = r.name;
    }
    $("pcat").innerHTML = catOptions(chosen);
    $("newCat").value = ""; $("newCatRow").classList.add("hide");
    toast(ex ? "Danh mục đã có, đã chọn sẵn" : "Đã thêm danh mục mới");
  } catch (e) { toast(e.message, "err"); }
}
function drawProducts() {
  if (!$("pBody")) return;
  prodQ = $("pq").value.trim();
  prodCat = $("pcf") ? $("pcf").value : prodCat;
  const q = norm(prodQ);
  const base = prodCat ? P.filter(p => (prodCat === "__none" ? !p.category : p.category === prodCat)) : P;
  const list = q ? base.filter(p => norm(p.code + " " + p.name + " " + p.category).includes(q)) : base;
  $("pSummary").textContent = q || prodCat ? `${list.length} / ${P.length} sản phẩm` : `${P.length} sản phẩm`;
  $("pBody").innerHTML = list.length ? list.map(p => `
    <tr class="hover:bg-ink-50/60">
      <td class="td font-num text-ink-300">${esc(p.code)}</td>
      <td class="td font-600">${esc(p.name)}</td>
      <td class="td text-ink-500">${esc(p.category) || "—"}</td>
      <td class="td font-num">${money(p.price)}</td>
      <td class="td font-num text-ink-300">${money(p.cost)}</td>
      <td class="td">${p.stock <= p.min_stock ? `<span class="pill bg-brick-50 text-brick-500">${p.stock}</span>` : p.stock}</td>
      <td class="td text-right space-x-3 whitespace-nowrap">
        <button onclick="productForm(${p.id})" class="text-xs font-600 text-ink-500 hover:text-ink-900">Sửa</button>
        <button onclick="deleteProduct(${p.id})" class="text-xs font-600 text-brick-500 hover:text-brick-600">Ẩn</button>
      </td>
    </tr>`).join("") : `<tr><td class="td text-center text-ink-300 py-8" colspan="7">${q || prodCat ? "Không tìm thấy sản phẩm phù hợp." : "Chưa có sản phẩm nào."}</td></tr>`;
}
function productForm(id) {
  const p = id ? P.find(x => x.id === id) : null;
  modal(`
    <div class="space-y-4">
      ${sect("Thông tin chung")}
      <div class="grid grid-cols-2 gap-4">
        ${fld("Tên sản phẩm", `<input id="pn" value="${p ? esc(p.name) : ""}" placeholder="Ví dụ: Cà phê rang xay 500g">`, { req: true, cls: "col-span-2" })}
        ${fld(`Mã sản phẩm ${autoBadge}`, `<input id="pc" value="${p ? esc(p.code) : ""}" readonly placeholder="Đang tạo mã...">`, { hint: p ? "" : "Mã được tạo tự động khi lưu" })}
        ${fld("Danh mục", `<div class="flex gap-2">
            <select id="pcat">${catOptions(p ? p.category : (prodCat && prodCat !== "__none" ? prodCat : ""))}</select>
            <button type="button" onclick="toggleNewCat()" class="btn btn-ghost !px-3 whitespace-nowrap">+ Mới</button>
          </div>
          <div id="newCatRow" class="hide flex gap-2 mt-2">
            <input id="newCat" placeholder="Tên danh mục mới" onkeydown="if(event.key==='Enter')saveNewCat()">
            <button type="button" onclick="saveNewCat()" class="btn btn-primary !px-3">Lưu</button>
          </div>`)}
      </div>
      ${sect("Giá bán & tồn kho")}
      <div class="grid grid-cols-2 gap-4">
        ${fld("Giá bán (đ)", `<input id="pp" type="number" min="0" value="${p ? p.price : ""}" placeholder="0">`, { req: true })}
        ${fld("Giá vốn (đ)", `<input id="po" type="number" min="0" value="${p ? p.cost : ""}" placeholder="0">`)}
        ${fld("Tồn kho ban đầu", `<input id="ps" type="number" min="0" value="${p ? p.stock : 0}" ${p ? "disabled" : ""}>`, { hint: p ? "Điều chỉnh số lượng ở mục Kho hàng" : "" })}
        ${fld("Tồn kho tối thiểu", `<input id="pmin" type="number" min="0" value="${p ? p.min_stock : 5}">`, { hint: "Cảnh báo khi tồn bằng hoặc thấp hơn mức này" })}
      </div>
      <button onclick="saveProduct(${p ? p.id : "null"})" class="btn btn-primary w-full py-3">${p ? "Lưu thay đổi" : "Thêm sản phẩm"}</button>
    </div>
  `, { title: p ? "Sửa sản phẩm" : "Sản phẩm mới", wide: "lg" });
  if (!p) loadNextCode("product", "pc");
}
async function saveProduct(id) {
  if (!$("pn").value.trim()) return toast("Vui lòng nhập tên sản phẩm", "err");
  try {
    if (id) {
      await api(`/products/${id}`, { method: "PUT", body: JSON.stringify({
        name: $("pn").value, category: $("pcat").value, price: +$("pp").value, cost: +$("po").value, min_stock: +$("pmin").value,
      })});
    } else {
      await api("/products", { method: "POST", body: JSON.stringify({
        code: "", name: $("pn").value, category: $("pcat").value,
        price: +$("pp").value, cost: +$("po").value, stock: +$("ps").value, min_stock: +$("pmin").value,
      })});
    }
    closeModal(); toast("Đã lưu sản phẩm"); products();
  } catch (e) { toast(e.message, "err"); }
}
async function deleteProduct(id) {
  if (!confirm("Ẩn sản phẩm này khỏi danh sách bán hàng?")) return;
  await api(`/products/${id}`, { method: "DELETE" });
  toast("Đã ẩn sản phẩm"); products();
}

/* ===================== mua hàng từ đại lý ===================== */
let buyView = "orders", agentCache = [], buyLines = [], buyEditId = null;

let buyQ = "", agentQ = "", buyTimer = null, buySeq = 0;

async function purchases() {
  const tabs = `<div class="inline-flex bg-white border border-ink-100 rounded-xl p-1 mb-5">
    ${[["orders", "Phiếu mua hàng"], ["agents", "Danh sách đại lý"]].map(([k, l]) => `
      <button onclick="buyView='${k}';purchases()" class="px-4 py-2 rounded-lg text-sm font-600 ${buyView === k ? "bg-ink-900 text-white" : "text-ink-500 hover:text-ink-900"}">${l}</button>`).join("")}
  </div>`;
  $("main").innerHTML = tabs + (buyView === "agents" ? agentsShell() : purchaseShell());
  if (buyView === "agents") { agentCache = await api("/suppliers"); drawAgents(); }
  else await loadPurchases();
}

/* ---- đại lý ---- */
function agentsShell() {
  return `
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div class="flex-1 min-w-[240px]"><label class="text-[11px] font-600 text-ink-500 mb-1 block">Tìm đại lý</label>
        <input id="aq" type="search" value="${esc(agentQ)}" placeholder="Tên đại lý, mã số, mã số thuế, SĐT, địa chỉ..." oninput="drawAgents()"></div>
      <span id="aSummary" class="text-sm text-ink-500 py-2.5"></span>
      <button onclick="agentForm()" class="btn btn-primary">+ Đại lý mới</button>
    </div>
    <div class="card overflow-x-auto"><table class="w-full">
      <thead><tr><th class="th">Mã số</th><th class="th">Tên đại lý</th><th class="th">Mã số thuế</th><th class="th">Địa chỉ</th><th class="th">SĐT</th><th class="th"></th></tr></thead>
      <tbody id="aBody"></tbody>
    </table></div>`;
}
function drawAgents() {
  if (!$("aBody")) return;
  agentQ = $("aq").value.trim();
  const q = norm(agentQ);
  const list = q ? agentCache.filter(a => norm([a.code, a.name, a.tax_code, a.phone, a.address].join(" ")).includes(q)) : agentCache;
  $("aSummary").textContent = q ? `${list.length} / ${agentCache.length} đại lý` : `${agentCache.length} đại lý`;
  $("aBody").innerHTML = list.length ? list.map(a => `
    <tr class="hover:bg-ink-50/60">
      <td class="td font-num text-ink-500">${esc(a.code)}</td>
      <td class="td font-600">${esc(a.name)}</td>
      <td class="td font-num">${esc(a.tax_code) || "—"}</td>
      <td class="td text-ink-500">${esc(a.address) || "—"}</td>
      <td class="td font-num">${esc(a.phone) || "—"}</td>
      <td class="td text-right whitespace-nowrap space-x-3">
        <button onclick="agentForm(${a.id})" class="text-xs font-600 text-ink-500 hover:text-ink-900">Sửa</button>
        <button onclick="deleteAgent(${a.id})" class="text-xs font-600 text-brick-500 hover:text-brick-600">Ẩn</button>
      </td>
    </tr>`).join("") : `<tr><td class="td text-center text-ink-300 py-8" colspan="6">${q ? "Không tìm thấy đại lý phù hợp." : "Chưa có đại lý nào."}</td></tr>`;
}
function agentForm(id) {
  const a = id ? agentCache.find(x => x.id === id) : null;
  modal(`
    <div class="space-y-4">
      ${sect("Thông tin đại lý")}
      <div class="grid grid-cols-2 gap-4">
        ${fld("Mã số đại lý", `<input id="ac" value="${a ? esc(a.code) : ""}" placeholder="Để trống để tự tạo (DL001...)">`)}
        ${fld("Mã số thuế", `<input id="at" value="${a ? esc(a.tax_code) : ""}" placeholder="10 hoặc 13 chữ số">`)}
        ${fld("Tên đại lý", `<input id="an" value="${a ? esc(a.name) : ""}" placeholder="Tên đại lý hoặc công ty">`, { req: true, cls: "col-span-2" })}
      </div>
      ${sect("Liên hệ")}
      <div class="grid grid-cols-2 gap-4">
        ${fld("Số điện thoại", `<input id="ap" value="${a ? esc(a.phone) : ""}" placeholder="09xx xxx xxx">`)}
        ${fld("Địa chỉ", `<input id="aa" value="${a ? esc(a.address) : ""}" placeholder="Số nhà, đường, quận/huyện, tỉnh/thành">`, { cls: "col-span-2" })}
      </div>
      <button onclick="saveAgent(${id || "null"})" class="btn btn-primary w-full py-3">${a ? "Lưu thay đổi" : "Thêm đại lý"}</button>
    </div>`, { title: a ? "Sửa đại lý" : "Đại lý mới", wide: "lg" });
}
async function saveAgent(id) {
  if (!$("an").value.trim()) return toast("Vui lòng nhập tên đại lý", "err");
  const body = JSON.stringify({ code: $("ac").value, name: $("an").value, tax_code: $("at").value, address: $("aa").value, phone: $("ap").value });
  try {
    await api(id ? `/suppliers/${id}` : "/suppliers", { method: id ? "PUT" : "POST", body });
    closeModal(); toast("Đã lưu đại lý"); purchases();
  } catch (e) { toast(e.message, "err"); }
}
async function deleteAgent(id) {
  if (!confirm("Ẩn đại lý này? Các phiếu mua hàng cũ vẫn được giữ nguyên.")) return;
  try { await api(`/suppliers/${id}`, { method: "DELETE" }); toast("Đã ẩn đại lý"); purchases(); }
  catch (e) { toast(e.message, "err"); }
}

/* ---- phiếu mua hàng ---- */
function purchaseShell() {
  return `
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div class="flex-1 min-w-[240px]"><label class="text-[11px] font-600 text-ink-500 mb-1 block">Tìm phiếu mua hàng</label>
        <input id="bq" type="search" value="${esc(buyQ)}" placeholder="Tên đại lý, mã số thuế, sản phẩm (tên hoặc mã), số phiếu, ghi chú..." oninput="searchBuySoon()"></div>
      <button id="bClear" onclick="clearBuySearch()" class="hide text-sm font-600 text-ink-500 hover:text-ink-900 py-2.5">Xóa lọc</button>
      <span id="bSummary" class="text-sm text-ink-500 py-2.5"></span>
      <button onclick="purchaseForm()" class="btn btn-amber">+ Tạo phiếu mua hàng</button>
    </div>
    <div class="card overflow-x-auto"><table class="w-full">
      <thead><tr><th class="th">#</th><th class="th">Thời gian</th><th class="th">Đại lý</th><th class="th">Mã số thuế</th><th class="th">Số mặt hàng</th><th class="th">VAT</th><th class="th">Tổng thanh toán</th><th class="th"></th></tr></thead>
      <tbody id="bBody"></tbody>
    </table></div>`;
}
function searchBuySoon() {
  clearTimeout(buyTimer);
  buyTimer = setTimeout(() => { buyQ = $("bq").value.trim(); loadPurchases().catch(e => toast(e.message, "err")); }, 300);
}
function clearBuySearch() { buyQ = ""; $("bq").value = ""; loadPurchases().catch(e => toast(e.message, "err")); }
async function loadPurchases() {
  const seq = ++buySeq;
  const a = await api("/purchases" + (buyQ ? "?q=" + encodeURIComponent(buyQ) : ""));
  if (seq !== buySeq || !$("bBody")) return; // bỏ kết quả cũ nếu đã có lần tìm mới hơn
  $("bClear").classList.toggle("hide", !buyQ);
  $("bSummary").innerHTML = `${a.length} phiếu · <span class="font-num font-600 text-ink-900">${money(a.reduce((t, r) => t + r.total, 0))}</span>`;
  $("bBody").innerHTML = a.length ? a.map(r => `
    <tr class="hover:bg-ink-50/60 cursor-pointer" onclick="purchaseDetail(${r.id})">
      <td class="td font-num text-ink-300">#${r.id}</td>
      <td class="td text-ink-500">${dt(r.created_at)}</td>
      <td class="td font-600">${esc(r.supplier_name)}</td>
      <td class="td font-num text-ink-500">${esc(r.tax_code) || "—"}</td>
      <td class="td font-num">${r.item_count}</td>
      <td class="td font-num text-ink-500">${r.vat_amount ? money(r.vat_amount) : "—"}</td>
      <td class="td font-num">${money(r.total)}</td>
      <td class="td text-right whitespace-nowrap space-x-3"><button onclick="event.stopPropagation();purchaseForm(${r.id})" class="text-xs font-600 text-ink-500 hover:text-ink-900">Sửa</button><button onclick="event.stopPropagation();deletePurchase(${r.id})" class="text-xs font-600 text-brick-500 hover:text-brick-600">Xóa</button></td>
    </tr>`).join("") : `<tr><td class="td text-center text-ink-300 py-8" colspan="8">${buyQ ? "Không tìm thấy phiếu mua hàng phù hợp." : "Chưa có phiếu mua hàng nào."}</td></tr>`;
}
async function purchaseForm(editId) {
  let ag, prods, d = null;
  try { [ag, prods, d] = await Promise.all([api("/suppliers"), api("/products"), editId ? api(`/purchases/${editId}`) : null]); }
  catch (e) { return toast(e.message, "err"); }
  buyEditId = editId || null;
  if (d && d.supplier.id && !ag.find(a => a.id === d.supplier.id)) ag.push(d.supplier); // đại lý đã ẩn vẫn hiện để sửa phiếu cũ
  if (!ag.length) { toast("Hãy thêm đại lý trước khi tạo phiếu mua hàng", "err"); buyView = "agents"; return purchases(); }
  if (!prods.length) return toast("Chưa có sản phẩm nào để nhập", "err");
  agentCache = ag; P = prods;
  if (d) d.items.forEach(i => { if (!P.find(p => p.id === i.product_id)) P.push({ id: i.product_id, code: "—", name: i.name, price: 0, cost: i.unit_cost, stock: 0, min_stock: 0, category: "" }); });
  buyLines = d ? d.items.map(i => ({ product_id: i.product_id, qty: i.qty, cost: i.unit_cost, vat: i.vat_rate || d.vat_rate || 0 })) : [newBuyLine()];
  modal(`
    <div class="space-y-3">
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Đại lý</label>
        <select id="pag" onchange="showAgentInfo()">${ag.map(a => `<option value="${a.id}" ${d && a.id === d.supplier.id ? "selected" : ""}>${esc(a.code)} — ${esc(a.name)}</option>`).join("")}</select>
        <div id="pinfo" class="mt-2 text-xs text-ink-500 bg-ink-50 rounded-lg px-3 py-2 leading-relaxed"></div>
      </div>
      <div>
        <div class="grid grid-cols-12 gap-2 text-[11px] font-600 text-ink-500 mb-1.5"><span class="col-span-4">Sản phẩm</span><span class="col-span-1 text-center">SL</span><span class="col-span-2">Giá nhập (đ)</span><span class="col-span-2">VAT</span><span class="col-span-2 text-right">Thành tiền</span></div>
        <div id="pl"></div>
        <datalist id="buyProds">${prods.map(p => `<option value="${esc(p.code)} — ${esc(p.name)}"></option>`).join("")}</datalist>
        <button onclick="addBuyLine()" class="text-sm font-600 text-ink-500 hover:text-ink-900 mt-1">+ Thêm dòng</button>
      </div>
      <input id="pnote" value="${d ? esc(d.note || "") : ""}" placeholder="Ghi chú (số hóa đơn đại lý, ...)">
      <label class="flex items-center gap-2 text-sm text-ink-500 cursor-pointer select-none"><input type="checkbox" id="pvatIncl" class="w-4 h-4 accent-[#13213B]" onchange="updateBuyTotal()">Giá nhập đã gồm VAT (áp dụng cho tất cả dòng)</label>
      <div class="space-y-1 pt-3 border-t border-ink-100 text-sm font-num">
        <div class="flex justify-between text-ink-300"><span>Tiền hàng</span><span id="pgoods">0 đ</span></div>
        <div id="pvatRow" class="flex justify-between text-ink-300 hide"><span id="pvatLabel">Thuế VAT</span><span id="pvatAmt">0 đ</span></div>
        <div class="flex justify-between items-center"><span class="font-body font-600">Tổng thanh toán</span><span id="ptotal" class="font-head font-800 text-lg">0 đ</span></div>
      </div>
      <p class="text-xs text-ink-300">${d ? "Lưu thay đổi sẽ điều chỉnh tồn kho theo chênh lệch số lượng và tính lại giá vốn bình quân của các sản phẩm liên quan." : "Lưu phiếu sẽ cộng số lượng vào tồn kho và cập nhật giá vốn sản phẩm theo bình quân gia quyền (giá vốn tính theo giá chưa VAT)."}</p>
      <button onclick="submitPurchase()" class="btn btn-amber w-full py-3">${d ? "Lưu thay đổi" : "Lưu phiếu &amp; nhập kho"}</button>
    </div>`, { title: d ? `Sửa phiếu mua hàng #${editId}` : "Phiếu mua hàng từ đại lý", wide: true });
  if (d) $("pvatIncl").checked = !!d.vat_inclusive;
  else { try { $("pvatIncl").checked = localStorage.sbh_pvatincl === "1"; } catch (e) {} }
  showAgentInfo(); drawBuyLines();
}
function showAgentInfo() {
  const a = agentCache.find(x => x.id === +$("pag").value);
  $("pinfo").innerHTML = a ? `Mã số thuế: <b class="font-num">${esc(a.tax_code) || "—"}</b> · SĐT: <b class="font-num">${esc(a.phone) || "—"}</b><br>Địa chỉ: ${esc(a.address) || "—"}` : "";
}
function lastBuyVat() { try { return +localStorage.sbh_pvat || 0; } catch (e) { return 0; } }
function newBuyLine() { return { product_id: null, qty: 1, cost: 0, vat: lastBuyVat() }; } // dòng mới: ô sản phẩm để trống
function prodLabel(id) { const p = P.find(x => x.id === id); return p ? `${p.code} — ${p.name}` : ""; }
function buyLineVat(l, incl) { // VAT của từng dòng, làm tròn từng dòng (khớp server)
  const goods = l.qty * l.cost;
  return l.vat > 0 ? Math.round(incl ? goods * l.vat / (100 + l.vat) : goods * l.vat / 100) : 0;
}
function drawBuyLines() {
  $("pl").innerHTML = buyLines.map((l, i) => `
    <div class="grid grid-cols-12 gap-2 items-center mb-2">
      <input class="col-span-4" list="buyProds" value="${esc(prodLabel(l.product_id))}" placeholder="Gõ tên hoặc mã sản phẩm..." onfocus="this.select()" onchange="pickBuyProduct(${i}, this.value)">
      <input class="col-span-1 !px-1 text-center" type="number" min="1" value="${l.qty}" oninput="setBuy(${i},'qty',this.value)">
      <input class="col-span-2" type="number" min="0" value="${l.cost || ""}" placeholder="0" oninput="setBuy(${i},'cost',this.value)">
      <select class="col-span-2 !px-2" onchange="setBuy(${i},'vat',this.value)">${[[0, "Không"], [5, "5%"], [8, "8%"], [10, "10%"]].map(([v, t]) => `<option value="${v}" ${l.vat === v ? "selected" : ""}>${t}</option>`).join("")}</select>
      <span id="bl${i}" class="col-span-2 text-right text-sm font-num">${money(l.qty * l.cost)}</span>
      <button onclick="delBuyLine(${i})" class="col-span-1 text-ink-300 hover:text-brick-500" title="Xóa dòng">✕</button>
    </div>`).join("");
  updateBuyTotal();
}
function pickBuyProduct(i, text) {
  const l = buyLines[i];
  if (!text.trim()) { l.product_id = null; return drawBuyLines(); }
  const p = findProductByText(text);
  if (!p) toast("Không tìm thấy sản phẩm, hãy gõ tên hoặc mã rồi chọn trong danh sách", "err");
  else { l.product_id = p.id; l.cost = p.cost || 0; }
  drawBuyLines();
}
function setBuy(i, k, v) {
  const l = buyLines[i];
  if (k === "vat") { l.vat = +v || 0; try { localStorage.sbh_pvat = String(l.vat); } catch (e) {} }
  else l[k] = Math.max(0, +v || 0);
  $("bl" + i).textContent = money(l.qty * l.cost);
  updateBuyTotal();
}
function addBuyLine() {
  buyLines.push(newBuyLine());
  drawBuyLines();
  const ins = $("pl").querySelectorAll("input[list]");
  if (ins.length) ins[ins.length - 1].focus();
}
function delBuyLine(i) {
  if (buyLines.length === 1) { buyLines[0] = newBuyLine(); return drawBuyLines(); }
  buyLines.splice(i, 1); drawBuyLines();
}
function buyVatText(rates, incl) {
  const r = [...new Set(rates)];
  return `Thuế VAT${r.length === 1 ? " " + r[0] + "%" : ""}${incl ? " (đã gồm trong giá)" : ""}`;
}
function updateBuyTotal() {
  const incl = $("pvatIncl").checked;
  const goods = buyLines.reduce((t, l) => t + l.qty * l.cost, 0);
  const vat = buyLines.reduce((t, l) => t + buyLineVat(l, incl), 0);
  const rates = buyLines.filter(l => l.vat > 0 && l.qty * l.cost > 0).map(l => l.vat);
  $("pgoods").textContent = money(goods);
  $("pvatRow").classList.toggle("hide", vat <= 0);
  $("pvatLabel").textContent = buyVatText(rates, incl);
  $("pvatAmt").textContent = money(vat);
  $("ptotal").textContent = money(goods + (incl ? 0 : vat));
  try { localStorage.sbh_pvatincl = incl ? "1" : "0"; } catch (e) {}
}
async function submitPurchase() {
  const lines = buyLines.filter(l => l.product_id); // bỏ qua dòng chưa chọn sản phẩm
  if (!lines.length) return toast("Vui lòng chọn ít nhất một sản phẩm", "err");
  if (lines.some(l => !(l.qty > 0))) return toast("Số lượng mỗi dòng phải lớn hơn 0", "err");
  try {
    const r = await api(buyEditId ? `/purchases/${buyEditId}` : "/purchases", { method: buyEditId ? "PUT" : "POST", body: JSON.stringify({
      supplier_id: +$("pag").value, note: $("pnote").value, vat_inclusive: $("pvatIncl").checked,
      items: lines.map(l => ({ product_id: l.product_id, qty: l.qty, unit_cost: l.cost, vat_rate: l.vat })),
    })});
    closeModal(); toast(buyEditId ? `Đã cập nhật phiếu mua #${buyEditId}` : `Đã lưu phiếu mua #${r.id} và nhập kho`);
    buyView = "orders"; purchases();
  } catch (e) { toast(e.message, "err"); }
}
async function purchaseDetail(id) {
  const r = await api(`/purchases/${id}`), s = r.supplier;
  const rates = r.items.filter(i => i.vat_rate > 0).map(i => i.vat_rate);
  if (!rates.length && r.vat_rate > 0) rates.push(r.vat_rate); // phiếu cũ tính VAT cả phiếu
  modal(`
    <div class="text-sm space-y-1 mb-3">
      <div class="font-head font-700 text-base">${esc(s.name)}</div>
      <div class="text-ink-500">Mã số: <span class="font-num">${esc(s.code) || "—"}</span> · MST: <span class="font-num">${esc(s.tax_code) || "—"}</span></div>
      <div class="text-ink-500">SĐT: <span class="font-num">${esc(s.phone) || "—"}</span></div>
      <div class="text-ink-500">Địa chỉ: ${esc(s.address) || "—"}</div>
    </div>
    <div class="ticket-edge h-px my-3"></div>
    <div class="space-y-1.5 mb-3">${r.items.map(i => `
      <div class="flex justify-between text-sm gap-3"><span>${esc(i.name)} <span class="text-ink-300">× ${i.qty} · ${money(i.unit_cost)}${i.vat_rate ? ` · VAT ${i.vat_rate}%` : ""}</span></span><span class="font-num whitespace-nowrap">${money(i.qty * i.unit_cost)}</span></div>`).join("")}</div>
    <div class="space-y-1 text-sm font-num pt-2 border-t border-ink-100">
      <div class="flex justify-between text-ink-300"><span>Tiền hàng</span><span>${money(r.goods_total)}</span></div>
      ${r.vat_amount > 0 ? `<div class="flex justify-between text-ink-300"><span>${buyVatText(rates, r.vat_inclusive)}</span><span>${money(r.vat_amount)}</span></div>` : ""}
      <div class="flex justify-between font-head font-800 text-base pt-1"><span class="font-body font-600 text-sm">Tổng thanh toán</span><span>${money(r.total)}</span></div>
    </div>
    ${r.note ? `<p class="text-sm text-ink-500 mt-3">Ghi chú: ${esc(r.note)}</p>` : ""}
    <p class="text-xs text-ink-300 mt-4">Phiếu #${r.id} · ${dt(r.created_at)}</p>
    <div class="grid grid-cols-2 gap-3 mt-4">
      <button onclick="purchaseForm(${r.id})" class="btn btn-ghost">Sửa phiếu</button>
      <button onclick="deletePurchase(${r.id})" class="btn btn-danger">Xóa phiếu</button>
    </div>
  `, { title: "Chi tiết phiếu mua hàng" });
}
async function deletePurchase(id) {
  if (!confirm(`Xóa phiếu mua hàng #${id}?\n\nSố lượng đã nhập từ phiếu này sẽ bị trừ khỏi tồn kho và giá vốn bình quân được tính lại. Thao tác không thể hoàn tác.`)) return;
  try {
    await api(`/purchases/${id}`, { method: "DELETE" });
    closeModal(); toast(`Đã xóa phiếu mua #${id}`);
    if (currentPage === "purchases") purchases();
  } catch (e) { toast(e.message, "err"); }
}

/* ===================== stock ===================== */
let stockView = "levels", stockHist = [], stockQ = "", histQ = "", stockSel = null;

async function stock() {
  [P, stockHist] = await Promise.all([api("/products"), api("/stock/history")]);
  drawStock();
}
function stockLabel(t) { return { import: "Nhập kho", remove: "Xuất kho", adjust: "Điều chỉnh", sale: "Bán hàng", purchase: "Mua từ đại lý", return: "Hoàn kho (sửa/xóa đơn)" }[t] || t; }

function drawStock() {
  const out = P.filter(p => p.stock <= 0).length, low = P.filter(p => p.stock > 0 && p.stock <= p.min_stock).length;
  const value = P.reduce((t, p) => t + p.stock * p.cost, 0);
  const tabs = `<div class="inline-flex bg-white border border-ink-100 rounded-xl p-1 mb-5">
    ${[["levels", "Tồn kho"], ["history", "Lịch sử nhập xuất"]].map(([k, l]) => `
      <button onclick="stockView='${k}';drawStock()" class="px-4 py-2 rounded-lg text-sm font-600 ${stockView === k ? "bg-ink-900 text-white" : "text-ink-500 hover:text-ink-900"}">${l}</button>`).join("")}
  </div>`;
  $("main").innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
      ${statCard("Sản phẩm", P.length, "box")}
      ${statCard("Sắp hết hàng", low, "stock", low ? "amber" : "leaf")}
      ${statCard("Hết hàng", out, "box", out ? "brick" : "leaf")}
      ${statCard("Giá trị tồn (giá vốn)", money(value), "wallet")}
    </div>
    ${tabs}
    ${stockView === "levels" ? levelsShell() : historyShell()}`;
  if (stockView === "levels") drawLevels(); else drawHistory();
}

/* ---- tồn kho ---- */
function levelsShell() {
  return `
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div class="flex-1 min-w-[240px]"><label class="text-[11px] font-600 text-ink-500 mb-1 block">Tìm sản phẩm</label>
        <input id="slq" type="search" value="${esc(stockQ)}" placeholder="Tên sản phẩm hoặc mã..." oninput="drawLevels()"></div>
      <span id="slSummary" class="text-sm text-ink-500 py-2.5"></span>
      <button onclick="stockForm()" class="btn btn-amber">+ Nhập / xuất / điều chỉnh</button>
    </div>
    <div class="card overflow-x-auto"><table class="w-full">
      <thead><tr><th class="th">Mã</th><th class="th">Tên sản phẩm</th><th class="th">Tồn kho</th><th class="th">Tối thiểu</th><th class="th">Giá trị tồn</th><th class="th">Trạng thái</th><th class="th"></th></tr></thead>
      <tbody id="slBody"></tbody>
    </table></div>`;
}
function stockStatus(p) {
  if (p.stock <= 0) return `<span class="pill bg-brick-50 text-brick-500">Hết hàng</span>`;
  if (p.stock <= p.min_stock) return `<span class="pill bg-amber-50 text-amber-600">Sắp hết</span>`;
  return `<span class="pill bg-leaf-50 text-leaf-600">Còn hàng</span>`;
}
function drawLevels() {
  if (!$("slBody")) return;
  stockQ = $("slq").value.trim();
  const q = norm(stockQ);
  const list = q ? P.filter(p => norm(p.code + " " + p.name + " " + p.category).includes(q)) : P;
  $("slSummary").textContent = q ? `${list.length} / ${P.length} sản phẩm` : `${P.length} sản phẩm`;
  $("slBody").innerHTML = list.length ? list.map(p => `
    <tr class="hover:bg-ink-50/60">
      <td class="td font-num text-ink-300">${esc(p.code)}</td>
      <td class="td font-600">${esc(p.name)}</td>
      <td class="td font-num font-600">${p.stock}</td>
      <td class="td font-num text-ink-300">${p.min_stock}</td>
      <td class="td font-num text-ink-500">${money(p.stock * p.cost)}</td>
      <td class="td">${stockStatus(p)}</td>
      <td class="td text-right"><button onclick="stockForm(${p.id})" class="text-xs font-600 text-ink-500 hover:text-ink-900 whitespace-nowrap">Nhập / xuất</button></td>
    </tr>`).join("") : `<tr><td class="td text-center text-ink-300 py-8" colspan="7">${q ? "Không tìm thấy sản phẩm phù hợp." : "Chưa có sản phẩm nào."}</td></tr>`;
}

/* ---- lịch sử ---- */
function historyShell() {
  return `
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div class="flex-1 min-w-[240px]"><label class="text-[11px] font-600 text-ink-500 mb-1 block">Tìm trong lịch sử</label>
        <input id="shq" type="search" value="${esc(histQ)}" placeholder="Tên hoặc mã sản phẩm, loại thao tác, ghi chú..." oninput="drawHistory()"></div>
      <span id="shSummary" class="text-sm text-ink-500 py-2.5"></span>
    </div>
    <div class="card overflow-x-auto"><table class="w-full">
      <thead><tr><th class="th">Thời gian</th><th class="th">Sản phẩm</th><th class="th">Thao tác</th><th class="th">Số lượng</th><th class="th">Ghi chú</th></tr></thead>
      <tbody id="shBody"></tbody>
    </table></div>`;
}
function drawHistory() {
  if (!$("shBody")) return;
  histQ = $("shq").value.trim();
  const q = norm(histQ);
  const list = q ? stockHist.filter(h => norm(`${h.product} ${h.code || ""} ${stockLabel(h.movement_type)} ${h.note || ""}`).includes(q)) : stockHist;
  $("shSummary").textContent = q ? `${list.length} / ${stockHist.length} dòng` : `${stockHist.length} dòng gần nhất`;
  $("shBody").innerHTML = list.length ? list.map(h => `
    <tr class="hover:bg-ink-50/60">
      <td class="td text-ink-300 font-num whitespace-nowrap">${dt(h.created_at)}</td>
      <td class="td"><span class="font-600">${esc(h.product)}</span>${h.code ? ` <span class="font-num text-xs text-ink-300">${esc(h.code)}</span>` : ""}</td>
      <td class="td">${stockLabel(h.movement_type)}</td>
      <td class="td font-num font-600 ${h.qty >= 0 ? "text-leaf-600" : "text-brick-500"}">${h.qty >= 0 ? "+" : ""}${h.qty}</td>
      <td class="td text-ink-500">${esc(h.note) || "—"}</td>
    </tr>`).join("") : `<tr><td class="td text-center text-ink-300 py-8" colspan="5">${q ? "Không tìm thấy dòng phù hợp." : "Chưa có lịch sử kho."}</td></tr>`;
}

/* ---- form nhập / xuất / điều chỉnh ---- */
function findProductByText(text) {
  const t = norm((text || "").trim());
  if (!t) return null;
  let p = P.find(x => norm(`${x.code} — ${x.name}`) === t) || P.find(x => norm(x.code) === t);
  if (!p) { const hits = P.filter(x => norm(x.code + " " + x.name).includes(t)); if (hits.length === 1) p = hits[0]; }
  return p || null;
}
function stockForm(id) {
  stockSel = id || null;
  modal(`
    <div class="space-y-3">
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Sản phẩm</label>
        <input id="sp" list="stockProds" value="${id ? esc(prodLabel(id)) : ""}" placeholder="Gõ tên hoặc mã sản phẩm..." onfocus="this.select()" onchange="pickStockProduct(this.value)">
        <datalist id="stockProds">${P.map(p => `<option value="${esc(p.code)} — ${esc(p.name)}"></option>`).join("")}</datalist>
      </div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Thao tác</label>
        <select id="st" onchange="stockPreview()">
          <option value="import">Nhập kho (cộng thêm)</option>
          <option value="remove">Xuất kho (trừ đi)</option>
          <option value="adjust">Điều chỉnh về số lượng thực tế</option>
        </select></div>
      <div><label id="sqLabel" class="text-xs font-600 text-ink-500 mb-1 block">Số lượng</label><input id="sq" type="number" min="0" placeholder="0" oninput="stockPreview()"></div>
      <p id="sinfo" class="text-sm text-ink-500 bg-ink-50 rounded-lg px-3 py-2 min-h-[38px]"></p>
      <input id="snote" placeholder="Ghi chú (tuỳ chọn)">
      <button onclick="saveStock()" class="btn btn-amber w-full">Lưu thay đổi kho</button>
    </div>`, { title: "Nhập / xuất / điều chỉnh kho" });
  stockPreview();
  setTimeout(() => $(id ? "sq" : "sp") && $(id ? "sq" : "sp").focus(), 50);
}
function pickStockProduct(text) {
  const p = findProductByText(text);
  if (!p && text.trim()) toast("Không tìm thấy sản phẩm, hãy gõ tên hoặc mã rồi chọn trong danh sách", "err");
  stockSel = p ? p.id : null;
  $("sp").value = p ? prodLabel(p.id) : "";
  stockPreview();
}
function stockPreview() {
  const p = P.find(x => x.id === stockSel), box = $("sinfo"), type = $("st").value;
  $("sqLabel").textContent = type === "adjust" ? "Số lượng tồn thực tế" : "Số lượng";
  if (!p) { box.textContent = "Chọn sản phẩm để xem tồn kho hiện tại."; return; }
  const raw = $("sq").value, n = Math.floor(+raw);
  let msg = `Tồn hiện tại: <b class="font-num">${p.stock}</b>`;
  if (raw !== "" && n >= 0) {
    const after = type === "import" ? p.stock + n : type === "remove" ? p.stock - n : n;
    msg += ` → sau khi lưu: <b class="font-num ${after < 0 ? "text-brick-500" : "text-ink-900"}">${after}</b>${after < 0 ? " (không đủ hàng để xuất)" : ""}`;
  }
  box.innerHTML = msg;
}
async function saveStock() {
  if (!stockSel) return toast("Vui lòng chọn sản phẩm", "err");
  const raw = $("sq").value, qty = Math.floor(+raw), type = $("st").value;
  if (raw === "" || !(qty >= 0)) return toast("Vui lòng nhập số lượng hợp lệ", "err");
  if (type !== "adjust" && qty < 1) return toast("Số lượng phải lớn hơn 0", "err");
  try {
    await api("/stock", { method: "POST", body: JSON.stringify({ product_id: stockSel, qty, movement_type: type, note: $("snote").value }) });
    closeModal(); toast("Đã cập nhật tồn kho"); stock();
  } catch (e) { toast(e.message, "err"); }
}

/* ===================== expenses ===================== */
async function expenses() {
  const a = await api("/expenses");
  $("main").innerHTML = `
    <div class="grid lg:grid-cols-3 gap-5">
      <div class="card p-5">
        <h3 class="font-head font-700 mb-3">Thêm khoản chi</h3>
        <div class="space-y-3">
          <input id="et" placeholder="Nội dung chi">
          <input id="ea" type="number" placeholder="Số tiền">
          <input id="en" placeholder="Ghi chú (tuỳ chọn)">
          <button onclick="addE()" class="btn btn-primary w-full">Thêm khoản chi</button>
        </div>
      </div>
      <div class="card overflow-x-auto lg:col-span-2">
        <table class="w-full"><thead><tr><th class="th">Nội dung</th><th class="th">Số tiền</th><th class="th">Thời gian</th><th class="th"></th></tr></thead>
        <tbody>${a.length ? a.map(e => `
          <tr class="hover:bg-ink-50/60">
            <td class="td font-600">${esc(e.title)}${e.note ? `<div class="text-xs text-ink-300 font-normal">${esc(e.note)}</div>` : ""}</td>
            <td class="td font-num text-brick-500">-${money(e.amount)}</td>
            <td class="td text-ink-300">${dt(e.created_at)}</td>
            <td class="td text-right"><button onclick="deleteExpense(${e.id})" class="text-xs font-600 text-ink-300 hover:text-brick-500">Xoá</button></td>
          </tr>`).join("") : `<tr><td class="td text-center text-ink-300 py-8" colspan="4">Chưa có khoản chi nào.</td></tr>`}</tbody></table>
      </div>
    </div>`;
}
async function addE() {
  if (!$("et").value.trim() || !(+$("ea").value > 0)) return toast("Nhập nội dung và số tiền hợp lệ", "err");
  await api("/expenses", { method: "POST", body: JSON.stringify({ title: $("et").value, amount: +$("ea").value, note: $("en").value }) });
  toast("Đã thêm khoản chi"); expenses();
}
async function deleteExpense(id) {
  if (!confirm("Xoá khoản chi này?")) return;
  await api(`/expenses/${id}`, { method: "DELETE" }); toast("Đã xoá"); expenses();
}

/* ===================== users ===================== */
const PERMS = [["dashboard", "Tổng quan"], ["pos", "Bán hàng"], ["orders", "Đơn hàng"], ["customers", "Khách hàng"]];
let userCache = [];

async function users() {
  userCache = await api("/users");
  $("main").innerHTML = `
    <div class="flex justify-end mb-4"><button onclick="userForm()" class="btn btn-primary">+ Tài khoản mới</button></div>
    <div class="card overflow-x-auto"><table class="w-full">
      <thead><tr><th class="th">Tài khoản</th><th class="th">Họ tên</th><th class="th">Vai trò</th><th class="th">Quyền truy cập</th><th class="th">Trạng thái</th><th class="th"></th></tr></thead>
      <tbody>${userCache.map(u => {
        const self = u.id === me.id;
        const perms = u.role === "admin" ? "Toàn quyền" : (u.permissions.map(k => (PERMS.find(p => p[0] === k) || [0, k])[1]).join(", ") || "—");
        return `<tr class="hover:bg-ink-50/60">
          <td class="td font-num">${esc(u.username)}${self ? ` <span class="pill bg-ink-50 text-ink-500 ml-1">Bạn</span>` : ""}</td>
          <td class="td font-600">${esc(u.full_name) || "—"}</td>
          <td class="td">${u.role === "admin" ? "Quản trị viên" : "Nhân viên"}</td>
          <td class="td text-ink-500 text-xs max-w-[220px]">${perms}</td>
          <td class="td"><span class="pill ${u.active ? "bg-leaf-50 text-leaf-600" : "bg-brick-50 text-brick-500"}">${u.active ? "Hoạt động" : "Đã khóa"}</span></td>
          <td class="td text-right whitespace-nowrap space-x-3">
            <button onclick="userForm(${u.id})" class="text-xs font-600 text-ink-500 hover:text-ink-900">Sửa</button>
            ${self ? "" : `<button onclick="toggleUser(${u.id},${!u.active})" class="text-xs font-600 text-ink-500 hover:text-ink-900">${u.active ? "Khóa" : "Mở khóa"}</button>
            <button onclick="deleteUser(${u.id})" class="text-xs font-600 text-brick-500 hover:text-brick-600">Xóa</button>`}
          </td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
}

function userForm(id) {
  const u = id ? userCache.find(x => x.id === id) : null;
  const self = !!u && u.id === me.id;
  const role = u ? u.role : "employee";
  const perms = u && u.role !== "admin" ? u.permissions : PERMS.map(p => p[0]);
  modal(`
    <div class="space-y-3">
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Tài khoản đăng nhập</label><input id="un" value="${u ? esc(u.username) : ""}" ${u ? "disabled class='opacity-60'" : ""}></div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Họ tên</label><input id="fn" value="${u ? esc(u.full_name) : ""}"></div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Vai trò</label>
        <select id="rl" onchange="togglePerms()" ${self ? "disabled" : ""}>
          <option value="employee" ${role === "employee" ? "selected" : ""}>Nhân viên</option>
          <option value="admin" ${role === "admin" ? "selected" : ""}>Quản trị viên</option>
        </select>
        ${self ? `<p class="text-xs text-ink-300 mt-1">Bạn không thể tự đổi vai trò của chính mình.</p>` : ""}
      </div>
      <div id="permBox" class="${role === "admin" ? "hide" : ""}">
        <label class="text-xs font-600 text-ink-500 mb-1.5 block">Quyền truy cập</label>
        <div class="grid grid-cols-2 gap-2">${PERMS.map(([k, label]) => `
          <label class="flex items-center gap-2 text-sm border border-ink-100 rounded-lg px-3 py-2 cursor-pointer">
            <input type="checkbox" class="permcb w-4 h-4 accent-[#13213B]" value="${k}" ${perms.includes(k) ? "checked" : ""}>${label}
          </label>`).join("")}</div>
      </div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">${u ? "Mật khẩu mới (để trống nếu không đổi)" : "Mật khẩu (tối thiểu 6 ký tự)"}</label><input id="pw" type="password" autocomplete="new-password"></div>
      <button onclick="saveUser(${id || "null"})" class="btn btn-primary w-full">${u ? "Lưu thay đổi" : "Tạo tài khoản"}</button>
    </div>`, { title: u ? "Sửa tài khoản" : "Tài khoản mới" });
}
function togglePerms() { $("permBox").classList.toggle("hide", $("rl").value === "admin"); }

async function saveUser(id) {
  const pw = $("pw").value, role = $("rl").value;
  const perms = [...document.querySelectorAll(".permcb:checked")].map(c => c.value);
  try {
    if (id) {
      if (pw && pw.length < 6) return toast("Mật khẩu mới tối thiểu 6 ký tự", "err");
      const body = { full_name: $("fn").value };
      if (!$("rl").disabled) { body.role = role; if (role === "employee") body.permissions = perms; }
      else if (userCache.find(x => x.id === id).role === "employee") body.permissions = perms;
      if (pw) body.password = pw;
      await api(`/users/${id}`, { method: "PUT", body: JSON.stringify(body) });
      toast("Đã cập nhật tài khoản");
    } else {
      if (!$("un").value.trim()) return toast("Vui lòng nhập tên đăng nhập", "err");
      if (pw.length < 6) return toast("Mật khẩu tối thiểu 6 ký tự", "err");
      await api("/users", { method: "POST", body: JSON.stringify({
        username: $("un").value.trim(), password: pw, full_name: $("fn").value, role,
        permissions: role === "admin" ? ["*"] : perms,
      })});
      toast("Đã tạo tài khoản");
    }
    closeModal(); users();
  } catch (e) { toast(e.message, "err"); }
}
async function toggleUser(id, active) {
  try {
    await api(`/users/${id}`, { method: "PUT", body: JSON.stringify({ active }) });
    toast(active ? "Đã mở khóa tài khoản" : "Đã khóa tài khoản"); users();
  } catch (e) { toast(e.message, "err"); }
}
async function deleteUser(id) {
  const u = userCache.find(x => x.id === id);
  if (!confirm(`Xóa tài khoản "${u.username}"? Thao tác này không thể hoàn tác.`)) return;
  try { await api(`/users/${id}`, { method: "DELETE" }); toast("Đã xóa tài khoản"); users(); }
  catch (e) { toast(e.message, "err"); }
}
