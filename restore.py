import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("Dùng: python restore.py backups\\shop_YYYYMMDD_HHMMSS.db")
backup = Path(sys.argv[1])
db = Path("data/shop.db")
if not backup.exists():
    raise SystemExit("Không tìm thấy file backup")
db.parent.mkdir(exist_ok=True)
if db.exists():
    safety = db.with_name(f"shop_before_restore_{datetime.now():%Y%m%d_%H%M%S}.db")
    shutil.copy2(db, safety)
    print("Safety copy:", safety)
src = sqlite3.connect(backup)
dst = sqlite3.connect(db)
try:
    src.backup(dst)
finally:
    dst.close()
    src.close()
print("Restore OK")
