import sqlite3
from datetime import datetime
from pathlib import Path

db = Path("data/shop.db")
out = Path("backups")
out.mkdir(exist_ok=True)
if not db.exists():
    raise SystemExit("Chưa có database: data/shop.db")
target = out / f"shop_{datetime.now():%Y%m%d_%H%M%S}.db"
src = sqlite3.connect(db)
dst = sqlite3.connect(target)
try:
    src.backup(dst)
finally:
    dst.close()
    src.close()
print("Backup OK:", target)
