"""
Email service for CROWN restore-link notifications.
Uses Python's built-in smtplib with STARTTLS. All errors are logged and
swallowed so that a missing SMTP config never breaks the API.
"""
import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config import SMTP_FROM, SMTP_HOST, SMTP_PASS, SMTP_PORT, SMTP_USER

log = logging.getLogger(__name__)


def send_restore_email(to: str, restore_url: str, filename: str | None = None) -> bool:
    """
    Send an email with a restore link for a CROWN session.

    Returns True on success, False if SMTP is unconfigured or an error occurs.
    """
    if not SMTP_HOST:
        log.warning("[Email] SMTP_HOST not configured — skipping notification to %s", to)
        return False

    file_line = f"\nFile: {filename}" if filename else ""

    body_text = f"""Hello,

Your CROWN brain segmentation results are ready. Click the link below to access your session:

{restore_url}{file_line}

This link is valid for 6 hours. Your session data will be automatically deleted after 24 hours.
If you didn't request this link, you can safely ignore this email.

— CROWN Automated Notification
"""

    body_html = f"""<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#333;max-width:520px;margin:auto;padding:24px">
  <div style="margin-bottom:24px">
    <span style="font-family:monospace;font-weight:700;font-size:20px;letter-spacing:0.2em">CROWN</span>
    <span style="font-size:11px;color:#888;margin-left:8px">Whole-Head Segmentation</span>
  </div>
  <h2 style="font-size:18px;margin-bottom:8px">Your results are ready</h2>
  <p style="color:#555;margin-bottom:20px">
    Your brain segmentation session is available. Click below to view and download your results.
    {f'<br><span style="font-size:12px;color:#888">File: {filename}</span>' if filename else ""}
  </p>
  <a href="{restore_url}"
     style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;
            padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">
    Open my results →
  </a>
  <p style="margin-top:24px;font-size:12px;color:#999">
    This link is valid for <strong>6 hours</strong>. Your data is automatically deleted after 24 hours.
    If you didn't request this, you can ignore this email.
  </p>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "CROWN: Your brain segmentation results are ready"
    msg["From"]    = SMTP_FROM
    msg["To"]      = to
    msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_html, "html"))

    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.ehlo()
            server.starttls(context=ctx)
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_FROM, to, msg.as_string())
        log.info("[Email] Restore link sent to %s", to)
        return True
    except Exception as exc:
        log.error("[Email] Failed to send to %s: %s", to, exc)
        return False
