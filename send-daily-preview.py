#!/usr/bin/env python3
"""Send the daily-summary email template to yourself, so you can see how it
actually lands in Gmail — fonts, RTL column order, the lot.

This is a design preview only. It sends the demo data baked into
daily-email-preview.html; nothing touches the database and nothing goes to a
café owner. Delete this script once the template is ported into the hook.

The Gmail app password is read from a hidden prompt (or GMAIL_APP_PASSWORD if
you'd rather export it). It is never written to disk and never echoed.

    ./send-daily-preview.py                      # to the default address
    ./send-daily-preview.py someone@example.com  # somewhere else
"""

import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from getpass import getpass
from pathlib import Path

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SENDER_ADDR = "reloy.ir@gmail.com"
SENDER_NAME = "Reloy"
SUBJECT = "گزارش فعالیت روزانه شما"
DEFAULT_TO = "amirhosein.javadi2022@gmail.com"

TEMPLATE = Path(__file__).resolve().parent / "daily-email-preview.html"

# What a text-only client sees. Mirrors the HTML, same order, same numbers.
PLAIN = """گزارش فعالیت روزانه شما
کافه فیلوبار — یکشنبه، 26 مهر 1405

در ادامه خلاصه‌ای از فعالیت‌های ثبت‌شده در مجموعه شما طی روز گذشته را مشاهده می‌کنید.

نام / ساعت / مانده تا جایزه / اولین بار
سارا / 09:15 / 7 / بله
امیر / 11:02 / 3 / -
مینا / 13:48 / تکمیل شد / -
رضا / 17:30 / 7 / بله
سارا / 20:55 / 1 / -

در مجموع 5 مهر ثبت شد — 2 مشتری برای اولین بار.
"""


def main() -> int:
    to_addr = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TO

    if not TEMPLATE.exists():
        print(f"template not found: {TEMPLATE}", file=sys.stderr)
        return 1
    html = TEMPLATE.read_text(encoding="utf-8")

    password = os.environ.get("GMAIL_APP_PASSWORD") or getpass(
        f"Gmail app password for {SENDER_ADDR} (hidden): "
    )
    if not password.strip():
        print("no password given — nothing sent", file=sys.stderr)
        return 1

    msg = EmailMessage()
    msg["Subject"] = SUBJECT
    msg["From"] = f"{SENDER_NAME} <{SENDER_ADDR}>"
    msg["To"] = to_addr
    msg.set_content(PLAIN)
    msg.add_alternative(html, subtype="html")

    print(f"connecting to {SMTP_HOST}:{SMTP_PORT} …")
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as s:
            s.starttls(context=ssl.create_default_context())
            s.login(SENDER_ADDR, password.strip())
            s.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        print(
            "Gmail rejected the login. That password must be an App Password "
            "(16 characters, from Google Account > Security > App passwords), "
            "not your normal Gmail password.",
            file=sys.stderr,
        )
        return 1
    except (OSError, smtplib.SMTPException) as err:
        print(f"could not send: {err}", file=sys.stderr)
        return 1

    print(f"sent to {to_addr} — check the inbox.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
