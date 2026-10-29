#!/usr/bin/env python3
"""Seed a realistic 70-day history for the demo cafe so every analytics card
tells a story. Simulates individual customers with visit habits rather than
sprinkling random rows: the KPIs, heatmap, comeback rate, visit rhythm and
reward usage all fall out of the same simulated behaviour, so they agree with
each other the way real data does.

Idempotent: wipes its own demo rows (demo users carry the 0912 999 1xxx phone
prefix) before re-seeding.
"""
import sqlite3, random, string, sys, datetime as dt

DB   = "/Users/amirhoseinjavadi/aurora-stamp-card/backend/pb_data/data.db"
CAFE = "wn13tj9sg36cl4o"
REQ  = 8
PHONE_PREFIX = "9129991"          # demo customers: 0912 999 1xxx
random.seed(20261005)

IRAN = dt.timedelta(hours=3, minutes=30)
NOW  = dt.datetime.utcnow()
def pbdate(d): return d.strftime("%Y-%m-%d %H:%M:%S.") + "%03dZ" % (d.microsecond // 1000)
def rid(n=15): return "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(n))

con = sqlite3.connect(DB)
cur = con.cursor()

# ---------- clean previous demo run ----------
old = [r[0] for r in cur.execute("select id from users where phone like ?", (PHONE_PREFIX + "%",))]
if old:
    q = ",".join("?" * len(old))
    cur.execute(f"delete from stamp_events where user in ({q})", old)
    cur.execute(f"delete from discounts    where user in ({q})", old)
    cur.execute(f"delete from memberships  where user in ({q})", old)
    cur.execute(f"delete from users        where id   in ({q})", old)
cur.execute("delete from reward_options where cafe=? and id like 'demo%'", (CAFE,))

pwhash = cur.execute("select password from users where role='customer' limit 1").fetchone()[0]

# ---------- reward pool ----------
# (id, deal, description, weight, expiry_amount, expiry_unit, redeem_probability)
existing = cur.execute("select id, deal from reward_options where cafe=? and active=1", (CAFE,)).fetchone()
REWARDS = [
    (existing[0], existing[1], 3, 14, 0.74),
    ("demo" + rid(11), "قهوه رایگان",          2, 30, 0.93),
    ("demo" + rid(11), "کیک رایگان",           2, 14, 0.86),
    ("demo" + rid(11), "20% تخفیف",            2,  7, 0.81),
    ("demo" + rid(11), "نوشیدنی دوم نیم‌بها",  1, 14, 0.62),
]
DESC = {"قهوه رایگان": "جایزه ویژه ✨", "کیک رایگان": "با هر کارت کامل",
        "20% تخفیف": "روی کل سفارش", "نوشیدنی دوم نیم‌بها": "برای همراهتان"}
UNIT = {7: ("1", "week"), 14: ("2", "week"), 30: ("1", "month")}
for rw in REWARDS[1:]:
    amt, unit = UNIT[rw[3]]
    cur.execute("insert into reward_options (id,cafe,deal,description,active,weight,expiry_amount,expiry_unit,created,updated)"
                " values (?,?,?,?,1,?,?,?,?,?)",
                (rw[0], CAFE, rw[1], DESC.get(rw[1], ""), rw[2], int(amt), unit,
                 pbdate(NOW - dt.timedelta(days=110)), pbdate(NOW - dt.timedelta(days=110))))
POOL = [rw for rw in REWARDS for _ in range(rw[2])]

# ---------- when people actually come in (Iran local) ----------
# rows = Sat..Fri, cols = the six 3-hour slots the heatmap uses.
# Morning rush + an evening peak that tops out on Thursday (weekend eve).
SLOTS = [(7, 10), (10, 13), (13, 16), (16, 19), (19, 23), (23, 25)]
WEEK = {  # python weekday(): Mon=0 .. Sun=6
    5: [20, 14, 12, 17, 22,  3],  # Sat
    6: [19, 14, 12, 16, 19,  2],  # Sun
    0: [18, 13, 11, 16, 19,  2],  # Mon
    1: [19, 14, 13, 17, 21,  3],  # Tue
    2: [21, 15, 14, 20, 27,  4],  # Wed
    3: [23, 16, 16, 25, 40,  9],  # Thu  <- busiest
    4: [10, 14, 17, 21, 25,  5],  # Fri
}
DAY_PULL = {5: 0.88, 6: 0.84, 0: 0.90, 1: 0.97, 2: 1.15, 3: 1.40, 4: 1.00}  # Mon=0 .. Sun=6
def shift_to_busy_day(day_local):
    # a visit due on a quiet day often slides to the day the cafe is busy —
    # this is what gives the heatmap a real weekly shape instead of flat noise
    for _ in range(3):
        if random.random() < DAY_PULL[day_local.weekday()] / 1.40: return day_local
        day_local = day_local + dt.timedelta(days=1)
    return day_local

def visit_time(day_local):
    day_local = shift_to_busy_day(day_local)
    w = WEEK[day_local.weekday()]
    i = random.choices(range(6), weights=w)[0]
    lo, hi = SLOTS[i]
    local = day_local.replace(hour=0, minute=0, second=0, microsecond=0) \
        + dt.timedelta(hours=lo) + dt.timedelta(minutes=random.randint(0, (hi - lo) * 60 - 1))
    return local - IRAN                                    # -> UTC

# ---------- customer simulation ----------
NAMES = ["سارا","امیر","مریم","رضا","نگین","پویا","الهام","حسین","شیما","کاوه","نیلوفر","آرش",
         "پریسا","مهدی","رویا","سینا","ترانه","بهزاد","مینا","فرهاد","سمیرا","یاسین","لیلا",
         "کیان","هستی","بابک","نازنین","وحید","شادی","ایمان","رها","سپهر","آیدا","دانیال"]
HABITS = [("loyal", 2.6, 0.9), ("regular", 5.0, 1.6), ("casual", 11.0, 3.5), ("oneoff", None, None)]
MIX_OLD = [0.21, 0.30, 0.25, 0.24]   # joined >45d ago: a quarter never came back
MIX_NEW = [0.42, 0.33, 0.17, 0.08]   # joined since:   the cafe keeps them now

people, seq = [], 0
for d_ago in range(110, -1, -1):                           # joins grow over the period
    rate = 1.7 + 1.5 * (1 - d_ago / 110.0)
    for _ in range(max(0, int(random.gauss(rate, 0.9) + 0.5))):
        mix = MIX_OLD if d_ago > 45 else MIX_NEW
        kind = random.choices([h[0] for h in HABITS], weights=mix)[0]
        people.append({"d_ago": d_ago, "kind": kind, "seq": seq}); seq += 1

users, members, events, discounts = [], [], [], []
for p in people:
    uid = rid()
    phone = PHONE_PREFIX + "%03d" % (p["seq"] % 1000)
    if p["seq"] >= 1000: continue                          # keep phones unique
    name = random.choice(NAMES)
    join_local = (NOW + IRAN) - dt.timedelta(days=p["d_ago"])
    join = visit_time(join_local)
    if join > NOW: join = NOW - dt.timedelta(hours=2)

    # visit series
    times = [join]
    hab = next(h for h in HABITS if h[0] == p["kind"])
    if hab[1] is not None:
        t = join
        while True:
            gap = max(0.4, random.gauss(hab[1], hab[2]))
            # the café got stickier over the last three weeks: people come back sooner
            age = (NOW - t).days
            if age < 8: gap *= 0.60           # this week, sooner still
            elif age < 25: gap *= 0.70        # people come back sooner lately
            elif age > 45: gap *= 1.12        # ...they used to drift
            t = t + dt.timedelta(days=gap)
            if t > NOW: break
            if random.random() < 0.045: break               # lapsed for good
            times.append(visit_time(t + IRAN))
    times = sorted(x for x in times if x <= NOW)
    if times and (NOW - times[-1]).days > 35 and random.random() < 0.42:
        t = NOW - dt.timedelta(days=random.uniform(6, 22))
        while t <= NOW:
            times.append(visit_time(t + IRAN))
            t += dt.timedelta(days=max(0.5, random.gauss(hab[1] or 9.0, 1.5)))
        times = sorted(x for x in times if x <= NOW)

    users.append((uid, phone + "@phone.loytap", name, phone, "customer", pwhash, rid(50), pbdate(join)))
    for t in times:
        events.append((rid(), CAFE, uid, "manual", "", pbdate(t)))

    total = len(times)
    cycles, left = divmod(total, REQ)
    members.append((rid(), CAFE, uid, cycles, left, str([random.randint(0, 99) for _ in range(left)]),
                    REQ, pbdate(join), pbdate(times[-1])))

    # one reward per completed card, issued at the stamp that finished it
    for c in range(cycles):
        issued = times[(c + 1) * REQ - 1]
        rw = random.choice(POOL)
        due = issued + dt.timedelta(days=rw[3])
        status, redeemed_at = "active", ""
        if random.random() < rw[4]:
            when = issued + dt.timedelta(days=random.uniform(0.3, min(rw[3], 6)))
            if when <= NOW: status, redeemed_at = "redeemed", pbdate(when)
            elif due <= NOW: status = "expired"
        elif due <= NOW:
            status = "expired"
        discounts.append((rid(), CAFE, uid, rw[1], DESC.get(rw[1], ""),
                          "LOY" + "".join(random.choice(string.ascii_uppercase + string.digits) for _ in range(6)),
                          pbdate(due), status, redeemed_at, rw[0], pbdate(issued)))

cur.executemany("insert into users (id,email,name,phone,role,password,tokenKey,created,updated,verified,emailVisibility,avatar)"
                " values (?,?,?,?,?,?,?,?,?,1,0,'')", [u + (u[7],) for u in users])
cur.executemany("insert into memberships (id,cafe,user,cycles,stamp_count,stamps,card_required,created,updated)"
                " values (?,?,?,?,?,?,?,?,?)", members)
cur.executemany("insert into stamp_events (id,cafe,user,source,tag,created) values (?,?,?,?,?,?)", events)
cur.executemany("insert into discounts (id,cafe,user,deal,description,code,due_date,status,redeemed_at,reward_option,created,"
                "one_time,redeemed_by) values (?,?,?,?,?,?,?,?,?,?,?,1,'')", discounts)
con.commit()

print(f"customers {len(users)}   stamps {len(events)}   rewards {len(discounts)}   "
      f"redeemed {sum(1 for d in discounts if d[7]=='redeemed')}   "
      f"active {sum(1 for d in discounts if d[7]=='active')}   "
      f"expired {sum(1 for d in discounts if d[7]=='expired')}")
con.close()
