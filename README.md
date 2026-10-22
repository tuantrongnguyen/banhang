# Sổ Bán Hàng V6 — bản giao diện chuyên nghiệp

Bản làm lại của ứng dụng quản lý bán hàng gốc (V5), giữ nguyên kiến trúc **FastAPI + SQLAlchemy + SQLite**,
viết lại toàn bộ giao diện cho chuyên nghiệp và dễ dùng hơn: sidebar điều hướng, biểu đồ doanh thu,
modal thêm/sửa dữ liệu, thông báo (toast), và bảng dữ liệu rõ ràng thay cho danh sách thô.

## Cài đặt (Windows)

```bat
python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
copy .env.example .env
python run.py
```

Mở trình duyệt: http://127.0.0.1:8000

Nếu `python` không nhận, thử `py -3.14` thay cho `python` ở bước tạo venv.

## macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
python run.py
```

## Tài khoản demo
- Quản trị viên: `admin` / `admin123`
- Nhân viên: `nhanvien` / `nv123`

Database SQLite được tạo tự động tại `data/shop.db` khi chạy lần đầu, kèm 3 sản phẩm mẫu.

## Những gì đã thay đổi so với bản gốc

**Giao diện**
- Sidebar điều hướng cố định theo quyền hạn, topbar hiển thị giờ hiện tại.
- Trang Tổng quan có biểu đồ doanh thu/lợi nhuận 7 ngày (Chart.js), top sản phẩm bán chạy, cảnh báo tồn kho thấp.
- Bán hàng (POS): lưới sản phẩm, giỏ hàng có nút tăng/giảm số lượng, tính tiền thừa tự động.
- Form thêm/sửa dữ liệu hiển thị dạng modal thay vì chèn thẳng vào trang.
- Thông báo dạng toast thay cho `alert()`.
- Font chữ Manrope (tiêu đề) + IBM Plex Sans (nội dung) + IBM Plex Mono (số liệu) hỗ trợ tốt tiếng Việt.

**Backend (API mới/bổ sung)**
- `PUT /api/products/{id}` — sửa sản phẩm, `DELETE /api/products/{id}` — ẩn sản phẩm (xoá mềm).
- `PUT /api/customers/{id}` — sửa thông tin khách hàng.
- `GET /api/orders/{id}` — xem chi tiết từng đơn hàng (danh sách mặt hàng).
- `GET /api/stock/history` — lịch sử nhập/xuất/điều chỉnh kho.
- `DELETE /api/expenses/{id}` — xoá khoản chi.
- `PUT /api/users/{id}` — khoá/mở khoá tài khoản, đổi vai trò.
- `GET /api/dashboard` trả thêm dữ liệu biểu đồ 7 ngày, top sản phẩm, danh sách hàng sắp hết.

Toàn bộ logic phân quyền (admin / nhân viên theo `permissions`), mã hoá mật khẩu bằng `bcrypt`,
xác thực bằng JWT, và cơ chế backup/restore SQLite được giữ nguyên như bản gốc.

## Backup / Restore

```bash
python backup.py
python restore.py backups/shop_YYYYMMDD_HHMMSS.db
```

Cũng có thể bấm "Sao lưu" qua API `/api/backup` nếu bạn nối thêm nút trong giao diện quản trị.
