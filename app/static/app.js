/* ===================== state & helpers ===================== */
let token = "", me = null, P = [], C = [], cart = [], currentPage = "home", pending = null;
const $ = (x) => document.getElementById(x);
const money = (x) => Number(x || 0).toLocaleString("vi-VN") + "\u00A0đ";
const dt = (iso) => new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts = {}) {
  opts.headers = Object.assign(
    { "Content-Type": "application/json" },
    opts.headers || {},
    token ? { Authorization: "Bearer " + token } : {}
  );
  const r = await fetch("/api" + path, opts);
  const d = await r.json().catch(() => ({}));
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
  const w = wide ? "max-w-2xl" : "max-w-md";
  $("modalRoot").innerHTML = `
    <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4" id="mb" onclick="if(event.target.id==='mb')closeModal()">
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

/* ===================== icons ===================== */
const ICONS = {
  home: "M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1Z",
  pos: "M4 7h16l-1.5 9.5a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7L4 7Zm3-3h10M9 11v3M15 11v3",
  users: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm9 1a2.5 2.5 0 1 0 0-5M3 20c0-3.3 2.2-6 5.5-6s5.5 2.7 5.5 6M15.5 14c3 0 5.5 2.6 5.5 6",
  orders: "M6 3h9l3 3v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm9 0v3h3M8 11h8M8 15h8M8 7h4",
  box: "M3.5 7.5 12 3l8.5 4.5L12 12 3.5 7.5Zm0 0V16L12 20.5m0-8.5V20.5m8.5-13V16L12 20.5",
  stock: "M4 20V10m5 10V4m5 16v-7m5 7V8",
  wallet: "M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2h-5a3 3 0 0 0 0 6h5v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm16 3a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-4a2 2 0 0 1 0-4h4Z",
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
  stock: ["Kho hàng", "Nhập, xuất và điều chỉnh tồn kho"],
  expenses: ["Chi phí", "Theo dõi các khoản chi vận hành"],
  users: ["Tài khoản", "Quản lý người dùng hệ thống"],
};
function goto(page) {
  currentPage = page;
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.k === page));
  const meta = PAGE_META[page] || ["", ""];
  $("pageTitle").textContent = meta[0]; $("pageSub").textContent = meta[1];
  ({ home, pos, orders, customers, products, stock, expenses, users })[page]();
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
        <input id="q" type="search" placeholder="Tìm theo tên hoặc mã sản phẩm..." oninput="drawP()">
        <div id="plist" class="grid sm:grid-cols-2 gap-2.5 mt-3 max-h-[60vh] overflow-y-auto pr-1"></div>
      </div>
      <div class="lg:col-span-2">
        <div class="card p-4 sticky top-20">
          <h3 class="font-head font-700 mb-3">Hóa đơn</h3>
          <div id="cart" class="space-y-2 max-h-[30vh] overflow-y-auto mb-2"></div>
          <div class="ticket-edge h-px my-3"></div>
          <select id="cus" class="mb-2">
            <option value="">Khách lẻ</option>
            ${C.map(c => `<option value="${c.id}">${esc(c.name)}${c.phone ? " · " + esc(c.phone) : ""}</option>`).join("")}
          </select>
          <div class="grid grid-cols-2 gap-2 mb-2">
            <input id="discount" type="number" placeholder="Giảm giá"  oninput="drawCart()">
            <input id="ship" type="number" placeholder="Phí ship"  oninput="drawCart()">
          </div>
          <select id="pay" onchange="drawCart()" class="mb-2">
            <option value="cash">Tiền mặt</option>
            <option value="transfer">Chuyển khoản</option>
            <option value="card">Quẹt thẻ</option>
          </select>
          <input id="cash" type="number" placeholder="Tiền khách đưa" oninput="drawCart()" class="mb-3">
          <div class="space-y-1 text-sm font-num mb-3">
            <div class="flex justify-between text-ink-300"><span>Tạm tính</span><span id="sumSub">0đ</span></div>
            <div class="flex justify-between text-ink-900 font-head font-800 text-lg pt-1 border-t border-ink-100"><span class="font-body font-600 text-sm">Tổng cộng</span><span id="sumTotal">0đ</span></div>
            <div id="sumChange" class="flex justify-between text-leaf-600 hide"><span>Tiền thừa</span><span></span></div>
          </div>
          <button onclick="checkout()" class="btn btn-amber w-full py-3">Thanh toán</button>
        </div>
      </div>
    </div>`;
  drawP(); drawCart();
}
function drawP() {
  const q = ($("q")?.value || "").toLowerCase();
  const list = P.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
  $("plist").innerHTML = list.length ? list.map(p => `
    <button onclick="addToCart(${p.id})" class="text-left border border-ink-100 rounded-xl p-3 hover:border-ink-900 transition ${p.stock <= 0 ? 'opacity-40 pointer-events-none' : ''}">
      <div class="text-sm font-600 truncate">${esc(p.name)}</div>
      <div class="flex items-center justify-between mt-1.5">
        <span class="font-num text-sm text-ink-900">${money(p.price)}</span>
        <span class="text-xs text-ink-300">Tồn ${p.stock}</span>
      </div>
    </button>`).join("") : `<p class="text-sm text-ink-300 col-span-2 py-6 text-center">Không tìm thấy sản phẩm.</p>`;
}
function addToCart(id) {
  const line = cart.find(a => a.id === id), p = P.find(a => a.id === id);
  if (!line) cart.push({ id, qty: 1 });
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
function drawCart() {
  if (!$("cart")) return;
  let sub = 0;
  $("cart").innerHTML = cart.length ? cart.map(x => {
    const p = P.find(a => a.id === x.id); sub += p.price * x.qty;
    return `<div class="flex items-center gap-2 text-sm">
      <span class="flex-1 truncate">${esc(p.name)}</span>
      <button onclick="cartQty(${x.id},-1)" class="w-6 h-6 rounded-md bg-ink-50 text-ink-500 hover:bg-ink-100">−</button>
      <span class="font-num w-5 text-center">${x.qty}</span>
      <button onclick="cartQty(${x.id},1)" class="w-6 h-6 rounded-md bg-ink-50 text-ink-500 hover:bg-ink-100">+</button>
      <span class="font-num w-20 text-right">${money(p.price * x.qty)}</span>
    </div>`;
  }).join("") : `<p class="text-sm text-ink-300 text-center py-4">Chưa có sản phẩm trong giỏ.</p>`;
  const discount = +$("discount").value || 0, ship = +$("ship").value || 0;
  const total = Math.max(0, sub - discount + ship);
  $("sumSub").textContent = money(sub);
  $("sumTotal").textContent = money(total);
  const cash = +$("cash").value || 0, change = cash - total;
  const chEl = $("sumChange");
  if ($("pay").value === "cash" && cash > 0) { chEl.classList.remove("hide"); chEl.querySelector("span:last-child").textContent = money(Math.max(0, change)); }
  else chEl.classList.add("hide");
}
function checkout() {
  if (!cart.length) return toast("Giỏ hàng đang trống", "err");
  const sub = cart.reduce((s, x) => s + P.find(p => p.id === x.id).price * x.qty, 0);
  const discount = +$("discount").value || 0, ship = +$("ship").value || 0;
  const total = Math.max(0, sub - discount + ship), cash = +$("cash").value || 0;
  const cid = $("cus").value ? +$("cus").value : null;
  pending = {
    sub, discount, ship, total, cash, cid,
    cname: cid ? C.find(c => c.id === cid).name : "Khách lẻ",
    pay: $("pay").value,
    lines: cart.map(x => { const p = P.find(a => a.id === x.id); return { name: p.name, qty: x.qty, price: p.price }; }),
    items: cart.map(x => ({ product_id: x.id, qty: x.qty })),
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
    <div class="flex justify-between text-sm mb-1"><span class="text-ink-300">Thanh toán</span><span class="font-600">${payLabel(o.pay)}</span></div>
    ${done ? `<div class="flex justify-between text-sm mb-1"><span class="text-ink-300">Mã đơn</span><span class="font-num font-600">#${o.orderId}</span></div>` : ""}
    <div class="ticket-edge h-px my-3"></div>
    <div class="space-y-1.5 mb-3">${o.lines.map(l => `
      <div class="flex justify-between text-sm gap-3"><span>${esc(l.name)} <span class="text-ink-300">× ${l.qty}</span></span><span class="font-num whitespace-nowrap">${money(l.price * l.qty)}</span></div>`).join("")}</div>
    <div class="ticket-edge h-px my-3"></div>
    <div class="space-y-1 text-sm font-num">
      <div class="flex justify-between text-ink-300"><span>Tạm tính</span><span>${money(o.sub)}</span></div>
      <div class="flex justify-between text-ink-300"><span>Giảm giá</span><span>-${money(o.discount)}</span></div>
      <div class="flex justify-between text-ink-300"><span>Phí ship</span><span>${money(o.ship)}</span></div>
      <div class="flex justify-between font-head font-800 text-lg pt-2 border-t border-ink-100"><span class="font-body font-600 text-sm">Tổng cộng</span><span>${money(o.total)}</span></div>
      ${cashBlock}
    </div>
    <div class="grid grid-cols-2 gap-3 mt-5">
      <button onclick="printReceipt()" class="btn btn-ghost">In hóa đơn</button>
      ${done
        ? `<button onclick="closeModal()" class="btn btn-primary">Đơn mới</button>`
        : `<button id="mconfirm" onclick="confirmPayment()" class="btn btn-amber">Xác nhận thanh toán</button>`}
    </div>
  `, { title: done ? "Thanh toán thành công" : "Xác nhận đơn hàng" });
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
    o.orderId = r.id; o.change = r.change; o.time = new Date();
    toast(`Đã thanh toán đơn #${r.id}`);
    renderCheckout();
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
    <div class="m">${o.orderId ? `Mã đơn: #${o.orderId}<br>` : ""}Ngày: ${o.time.toLocaleString("vi-VN")}<br>Khách hàng: ${esc(o.cname)}<br>Thanh toán: ${payLabel(o.pay)}</div>
    <hr>
    <table>${o.lines.map(l => `<tr><td colspan="2">${esc(l.name)}</td></tr><tr><td class="m">${l.qty} x ${money(l.price)}</td><td class="r">${money(l.price * l.qty)}</td></tr>`).join("")}</table>
    <hr>
    <table>
      ${row("Tạm tính", money(o.sub))}
      ${row("Giảm giá", "-" + money(o.discount))}
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
async function orders() {
  const a = await api("/orders");
  $("main").innerHTML = `<div class="card overflow-x-auto">
    <table class="w-full">
      <thead><tr><th class="th">#</th><th class="th">Khách hàng</th><th class="th">Thanh toán</th><th class="th">Tổng tiền</th><th class="th">Lợi nhuận</th><th class="th">Thời gian</th></tr></thead>
      <tbody>${a.length ? a.map(o => `
        <tr class="hover:bg-ink-50/60 cursor-pointer" onclick="orderDetail(${o.id})">
          <td class="td font-num text-ink-300">#${o.id}</td>
          <td class="td font-600">${esc(o.customer_name)}</td>
          <td class="td">${payLabel(o.payment)}</td>
          <td class="td font-num">${money(o.total)}</td>
          <td class="td font-num ${o.profit >= 0 ? 'text-leaf-600' : 'text-brick-500'}">${money(o.profit)}</td>
          <td class="td text-ink-300">${dt(o.created_at)}</td>
        </tr>`).join("") : `<tr><td class="td text-center text-ink-300 py-8" colspan="6">Chưa có đơn hàng nào.</td></tr>`}</tbody>
    </table></div>`;
}
function payLabel(p) { return { cash: "Tiền mặt", transfer: "Chuyển khoản", card: "Quẹt thẻ" }[p] || p; }
async function orderDetail(id) {
  const o = await api(`/orders/${id}`);
  modal(`
    <div class="flex justify-between text-sm mb-3">
      <span class="text-ink-300">Khách hàng</span><span class="font-600">${esc(o.customer_name)}</span>
    </div>
    <div class="space-y-1.5 mb-3">${o.items.map(i => `
      <div class="flex justify-between text-sm"><span>${esc(i.name)} × ${i.qty}</span><span class="font-num">${money(i.price * i.qty)}</span></div>`).join("")}</div>
    <div class="ticket-edge h-px my-3"></div>
    <div class="space-y-1 text-sm font-num">
      <div class="flex justify-between text-ink-300"><span>Tạm tính</span><span>${money(o.subtotal)}</span></div>
      <div class="flex justify-between text-ink-300"><span>Giảm giá</span><span>-${money(o.discount)}</span></div>
      <div class="flex justify-between text-ink-300"><span>Phí ship</span><span>${money(o.shipping)}</span></div>
      <div class="flex justify-between font-head font-800 text-base pt-2 border-t border-ink-100"><span class="font-body font-600 text-sm">Tổng cộng</span><span>${money(o.total)}</span></div>
      <div class="flex justify-between text-leaf-600"><span>Lợi nhuận</span><span>${money(o.profit)}</span></div>
    </div>
    <p class="text-xs text-ink-300 mt-4">Đơn #${o.id} · ${payLabel(o.payment)} · ${dt(o.created_at)}</p>
  `, { title: "Chi tiết đơn hàng" });
}

/* ===================== customers ===================== */
async function customers() {
  C = await api("/customers");
  $("main").innerHTML = `
    <div class="flex justify-end mb-4"><button onclick="customerForm()" class="btn btn-primary">+ Khách hàng mới</button></div>
    <div class="card overflow-x-auto"><table class="w-full">
      <thead><tr><th class="th">Tên khách hàng</th><th class="th">Điện thoại</th><th class="th">Địa chỉ</th><th class="th"></th></tr></thead>
      <tbody>${C.length ? C.map(c => `
        <tr class="hover:bg-ink-50/60">
          <td class="td font-600">${esc(c.name)}</td><td class="td font-num">${esc(c.phone) || "—"}</td><td class="td text-ink-500">${esc(c.address) || "—"}</td>
          <td class="td text-right"><button onclick='customerForm(${JSON.stringify(c)})' class="text-xs font-600 text-ink-500 hover:text-ink-900">Sửa</button></td>
        </tr>`).join("") : `<tr><td class="td text-center text-ink-300 py-8" colspan="4">Chưa có khách hàng nào.</td></tr>`}</tbody>
    </table></div>`;
}
function customerForm(c) {
  modal(`
    <div class="space-y-3">
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Tên khách hàng</label><input id="cn" value="${c ? esc(c.name) : ""}"></div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Điện thoại</label><input id="cp" value="${c ? esc(c.phone) : ""}"></div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Địa chỉ</label><input id="ca" value="${c ? esc(c.address) : ""}"></div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Ghi chú</label><input id="cnote" value="${c ? esc(c.note || "") : ""}"></div>
      <button onclick="saveCustomer(${c ? c.id : "null"})" class="btn btn-primary w-full">${c ? "Lưu thay đổi" : "Thêm khách hàng"}</button>
    </div>`, { title: c ? "Sửa khách hàng" : "Khách hàng mới" });
}
async function saveCustomer(id) {
  const body = JSON.stringify({ name: $("cn").value, phone: $("cp").value, address: $("ca").value, note: $("cnote").value });
  try {
    if (!$("cn").value.trim()) return toast("Vui lòng nhập tên khách hàng", "err");
    await api(id ? `/customers/${id}` : "/customers", { method: id ? "PUT" : "POST", body });
    closeModal(); toast("Đã lưu khách hàng"); customers();
  } catch (e) { toast(e.message, "err"); }
}

/* ===================== products ===================== */
async function products() {
  P = await api("/products");
  $("main").innerHTML = `
    <div class="flex justify-end mb-4"><button onclick="productForm()" class="btn btn-primary">+ Sản phẩm mới</button></div>
    <div class="card overflow-x-auto"><table class="w-full">
      <thead><tr><th class="th">Mã</th><th class="th">Tên sản phẩm</th><th class="th">Danh mục</th><th class="th">Giá bán</th><th class="th">Giá vốn</th><th class="th">Tồn kho</th><th class="th"></th></tr></thead>
      <tbody>${P.length ? P.map(p => `
        <tr class="hover:bg-ink-50/60">
          <td class="td font-num text-ink-300">${esc(p.code)}</td>
          <td class="td font-600">${esc(p.name)}</td>
          <td class="td text-ink-500">${esc(p.category) || "—"}</td>
          <td class="td font-num">${money(p.price)}</td>
          <td class="td font-num text-ink-300">${money(p.cost)}</td>
          <td class="td">${p.stock <= p.min_stock ? `<span class="pill bg-brick-50 text-brick-500">${p.stock}</span>` : p.stock}</td>
          <td class="td text-right space-x-3 whitespace-nowrap">
            <button onclick='productForm(${JSON.stringify(p)})' class="text-xs font-600 text-ink-500 hover:text-ink-900">Sửa</button>
            <button onclick="deleteProduct(${p.id})" class="text-xs font-600 text-brick-500 hover:text-brick-600">Ẩn</button>
          </td>
        </tr>`).join("") : `<tr><td class="td text-center text-ink-300 py-8" colspan="7">Chưa có sản phẩm nào.</td></tr>`}</tbody>
    </table></div>`;
}
function productForm(p) {
  modal(`
    <div class="grid grid-cols-2 gap-3">
      <div class="col-span-2"><label class="text-xs font-600 text-ink-500 mb-1 block">Tên sản phẩm</label><input id="pn" value="${p ? esc(p.name) : ""}"></div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Mã sản phẩm</label><input id="pc" value="${p ? esc(p.code) : ""}" ${p ? "disabled class='opacity-60'" : ""}></div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Danh mục</label><input id="pcat" value="${p ? esc(p.category) : ""}"></div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Giá bán</label><input id="pp" type="number" value="${p ? p.price : ""}"></div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Giá vốn</label><input id="po" type="number" value="${p ? p.cost : ""}"></div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Tồn kho ban đầu</label><input id="ps" type="number" value="${p ? p.stock : 0}" ${p ? "disabled class='opacity-60'" : ""}></div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Tồn kho tối thiểu</label><input id="pmin" type="number" value="${p ? p.min_stock : 5}"></div>
    </div>
    ${p ? `<p class="text-xs text-ink-300 mt-2">Điều chỉnh số lượng tồn kho ở mục Kho hàng.</p>` : ""}
    <button onclick="saveProduct(${p ? p.id : "null"})" class="btn btn-primary w-full mt-4">${p ? "Lưu thay đổi" : "Thêm sản phẩm"}</button>
  `, { title: p ? "Sửa sản phẩm" : "Sản phẩm mới" });
}
async function saveProduct(id) {
  try {
    if (id) {
      await api(`/products/${id}`, { method: "PUT", body: JSON.stringify({
        name: $("pn").value, category: $("pcat").value, price: +$("pp").value, cost: +$("po").value, min_stock: +$("pmin").value,
      })});
    } else {
      await api("/products", { method: "POST", body: JSON.stringify({
        code: $("pc").value, name: $("pn").value, category: $("pcat").value,
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

/* ===================== stock ===================== */
async function stock() {
  const [prods, history] = await Promise.all([api("/products"), api("/stock/history")]);
  P = prods;
  $("main").innerHTML = `
    <div class="grid lg:grid-cols-3 gap-5">
      <div class="card p-5">
        <h3 class="font-head font-700 mb-3">Nhập / xuất / điều chỉnh</h3>
        <div class="space-y-3">
          <select id="sp">${P.map(p => `<option value="${p.id}">${esc(p.code)} — ${esc(p.name)} (tồn ${p.stock})</option>`).join("")}</select>
          <select id="st">
            <option value="import">Nhập kho</option>
            <option value="remove">Xuất kho</option>
            <option value="adjust">Điều chỉnh về số lượng</option>
          </select>
          <input id="sq" type="number" placeholder="Số lượng">
          <input id="snote" placeholder="Ghi chú (tuỳ chọn)">
          <button onclick="saveStock()" class="btn btn-amber w-full">Lưu thay đổi kho</button>
        </div>
      </div>
      <div class="card p-5 lg:col-span-2">
        <h3 class="font-head font-700 mb-3">Lịch sử gần đây</h3>
        <div class="max-h-[420px] overflow-y-auto space-y-1">
          ${history.length ? history.map(h => `
            <div class="flex items-center justify-between text-sm py-2 border-b border-ink-50 last:border-0">
              <div><span class="font-600">${esc(h.product)}</span><span class="text-ink-300"> · ${stockLabel(h.movement_type)}${h.note ? " · " + esc(h.note) : ""}</span></div>
              <div class="flex items-center gap-3">
                <span class="font-num ${h.qty >= 0 ? 'text-leaf-600' : 'text-brick-500'}">${h.qty >= 0 ? "+" : ""}${h.qty}</span>
                <span class="text-xs text-ink-300 font-num">${dt(h.created_at)}</span>
              </div>
            </div>`).join("") : `<p class="text-sm text-ink-300">Chưa có lịch sử kho.</p>`}
        </div>
      </div>
    </div>`;
}
function stockLabel(t) { return { import: "Nhập kho", remove: "Xuất kho", adjust: "Điều chỉnh", sale: "Bán hàng" }[t] || t; }
async function saveStock() {
  const qty = +$("sq").value;
  if (!qty && qty !== 0) return toast("Vui lòng nhập số lượng", "err");
  try {
    await api("/stock", { method: "POST", body: JSON.stringify({ product_id: +$("sp").value, qty, movement_type: $("st").value, note: $("snote").value }) });
    toast("Đã cập nhật tồn kho"); stock();
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
async function users() {
  const a = await api("/users");
  $("main").innerHTML = `
    <div class="flex justify-end mb-4"><button onclick="userForm()" class="btn btn-primary">+ Tài khoản mới</button></div>
    <div class="card overflow-x-auto"><table class="w-full">
      <thead><tr><th class="th">Tài khoản</th><th class="th">Họ tên</th><th class="th">Vai trò</th><th class="th">Trạng thái</th><th class="th"></th></tr></thead>
      <tbody>${a.map(u => `
        <tr class="hover:bg-ink-50/60">
          <td class="td font-num">${esc(u.username)}</td><td class="td font-600">${esc(u.full_name)}</td>
          <td class="td">${u.role === "admin" ? "Quản trị viên" : "Nhân viên"}</td>
          <td class="td"><span class="pill ${u.active ? "bg-leaf-50 text-leaf-600" : "bg-brick-50 text-brick-500"}">${u.active ? "Hoạt động" : "Đã khoá"}</span></td>
          <td class="td text-right"><button onclick="toggleUser(${u.id},${!u.active})" class="text-xs font-600 text-ink-500 hover:text-ink-900">${u.active ? "Khoá" : "Mở khoá"}</button></td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}
function userForm() {
  modal(`
    <div class="space-y-3">
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Tài khoản đăng nhập</label><input id="un"></div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Mật khẩu</label><input id="pw" type="password"></div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Họ tên</label><input id="fn"></div>
      <div><label class="text-xs font-600 text-ink-500 mb-1 block">Vai trò</label>
        <select id="rl"><option value="employee">Nhân viên</option><option value="admin">Quản trị viên</option></select>
      </div>
      <button onclick="addU()" class="btn btn-primary w-full">Tạo tài khoản</button>
    </div>`, { title: "Tài khoản mới" });
}
async function addU() {
  if (!$("un").value.trim() || $("pw").value.length < 6) return toast("Tài khoản hợp lệ và mật khẩu ≥ 6 ký tự", "err");
  try {
    await api("/users", { method: "POST", body: JSON.stringify({
      username: $("un").value, password: $("pw").value, full_name: $("fn").value, role: $("rl").value,
      permissions: $("rl").value === "admin" ? ["*"] : ["dashboard", "pos", "customers", "orders"],
    })});
    closeModal(); toast("Đã tạo tài khoản"); users();
  } catch (e) { toast(e.message, "err"); }
}
async function toggleUser(id, active) {
  await api(`/users/${id}`, { method: "PUT", body: JSON.stringify({ active }) });
  toast(active ? "Đã mở khoá tài khoản" : "Đã khoá tài khoản"); users();
}
