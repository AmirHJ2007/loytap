#!/usr/bin/env python3
"""Seed the demo customer's wallet with more loyalty cards and more messages,
so the Messages tab can be looked at with real variety in it: long bodies that
clamp, short ones that don't, read and unread, rewards attached and not, and
four different cafe accents so the coloured header is actually exercised.

Local backend/pb_data only. Idempotent: every row it writes carries an id
prefix of its own and is deleted before a re-run, so the two hand-made
messages already in the database are left alone.

    pkill -f "backend/pocketbase serve"     # stop the server first
    python3 seed-messages.py
    ./dev.sh
"""
import sqlite3, random, string, datetime as dt

DB   = "/Users/amirhoseinjavadi/aurora-stamp-card/backend/pb_data/data.db"
USER = "vec2435pqawo7nv"          # بابک · 0912 999 1042
random.seed(20261009)

MSG_PREFIX, DSC_PREFIX, MEM_PREFIX = "msgsd", "dscsd", "memsd"

NOW = dt.datetime.utcnow()
def pbdate(d): return d.strftime("%Y-%m-%d %H:%M:%S.") + "%03dZ" % (d.microsecond // 1000)
def ago(days, hours=0): return pbdate(NOW - dt.timedelta(days=days, hours=hours))
def ahead(days): return pbdate(NOW + dt.timedelta(days=days))
def rid(prefix): return prefix + "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(15 - len(prefix)))
def code(): return "LOY" + "".join(random.choice(string.ascii_uppercase + string.digits) for _ in range(6))

# cafés the messages come from — picked for their accents, so the header band
# is a different colour on each card in the list
AURORA = "wn13tj9sg36cl4o"   # #171717  near-black
BLOOM  = "biu2vp7ft3aoagv"   # #1f7a4d  green
ALVIS  = "kfd1t13dfx6k8e2"   # #9a2b52  plum
FILO   = "qly9slrva99805q"   # #8a5628  brown

con = sqlite3.connect(DB)
cur = con.cursor()

# ---------- clean the previous run of THIS script ----------
cur.execute("delete from messages   where user=? and id like ?", (USER, MSG_PREFIX + "%"))
cur.execute("delete from discounts  where user=? and id like ?", (USER, DSC_PREFIX + "%"))
cur.execute("delete from memberships where user=? and id like ?", (USER, MEM_PREFIX + "%"))

# ---------- more loyalty cards in the wallet ----------
# (cafe, stamps on the card, days since they joined, days since the last stamp)
CARDS = [(BLOOM, 3, 54, 2), (ALVIS, 6, 120, 9), (FILO, 1, 11, 11)]
for cafe, n, joined, last in CARDS:
    req = cur.execute("select stamps_required from cafe_card where id=?", (cafe,)).fetchone()
    req = (req and req[0]) or 8
    stamps = [random.randint(0, 99) for _ in range(n)]
    cur.execute(
        "insert into memberships (id,user,cafe,stamp_count,stamps,cycles,card_required,created,updated)"
        " values (?,?,?,?,?,?,?,?,?)",
        (rid(MEM_PREFIX), USER, cafe, n, str(stamps).replace("'", '"'), 0, req, ago(joined), ago(last)))

# ---------- rewards that arrive attached to a message ----------
# (cafe, deal, description, days until it expires)
def mint(cafe, deal, desc, due_in):
    did = rid(DSC_PREFIX)
    cur.execute(
        "insert into discounts (id,user,cafe,code,deal,description,due_date,one_time,status,redeemed_at,redeemed_by,reward_option,created)"
        " values (?,?,?,?,?,?,?,1,'active','','','',?)",
        (did, USER, cafe, code(), deal, desc, ahead(due_in), ago(1)))
    return did

# ---------- the messages ----------
# (cafe, body, reward | None, read, days ago)
# Deliberately mixed: one body long enough to clamp and open, one short enough
# that no "read more" appears, one old enough to fall back to a date, and the
# oldest already read so the unread dot is not on every card.
MESSAGES = [
    (BLOOM,
     "صبح‌ها از ساعت ۸ بازیم ☀️ منتظرتونیم.",
     None, False, 0),

    (ALVIS,
     "بابک عزیز، یک جایزه برایتان کنار گذاشتیم 🎁 هر وقت سر زدید بگیریدش.",
     ("قهوه رایگان", "جایزه ویژه ✨", 30), False, 1),

    (BLOOM,
     "این هفته دانه‌ی تازه‌ی اتیوپی رسید — یرگاچف، با نت‌های یاس و مرکبات. "
     "تا جمعه هر کسی که کارت وفاداری‌مان را داشته باشد می‌تواند یک فنجان از "
     "آن را با نصف قیمت امتحان کند. اگر فیلتر دوست دارید پیشنهاد ما V60 است؛ "
     "اسپرسواش هم برای کسانی که شیر دوست دارند عالی درمی‌آید. یک کیک هم "
     "برایتان کنار گذاشته‌ایم.",
     ("کیک رایگان", "با هر کارت کامل", 14), True, 3),

    (FILO,
     "سه‌شنبه‌ها از این به بعد تا نیمه‌شب بازیم. اگر شب‌کار هستید، میز کنار "
     "پنجره معمولاً خالی است.",
     None, True, 5),

    (FILO,
     "نوشیدنی دوم برای همراهتان نیم‌بها 🥤",
     ("نوشیدنی دوم نیم‌بها", "برای همراهتان", 7), False, 0),

    (ALVIS,
     "سالی که گذشت را با شما گذراندیم — ممنون که بخشی از آن بودید. از امروز "
     "منوی زمستانی‌مان روی میزهاست: شکلات داغ با فلفل، لاته‌ی هل، و یک "
     "دمنوش ترش که خودمان هم به آن معتاد شده‌ایم. سری بزنید.",
     None, True, 9),
]

for cafe, body, reward, read, days in MESSAGES:
    did = mint(cafe, *reward) if reward else ""
    at = ago(days, hours=random.randint(1, 9))
    cur.execute(
        "insert into messages (id,user,cafe,body,discount,read,created,updated)"
        " values (?,?,?,?,?,?,?,?)",
        (rid(MSG_PREFIX), USER, cafe, body, did, 1 if read else 0, at, at))

con.commit()
n_msg = cur.execute("select count(*) from messages where user=?", (USER,)).fetchone()[0]
n_card = cur.execute("select count(*) from memberships where user=?", (USER,)).fetchone()[0]
print("seeded: %d messages (%d new), %d loyalty cards" % (n_msg, len(MESSAGES), n_card))
con.close()
