"""
Email service for CROWN notifications (restore links, magic links, job completion).
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


def _send(msg: MIMEMultipart, to: str, label: str) -> bool:
    """Internal SMTP send helper."""
    if not SMTP_HOST:
        log.warning("[Email] SMTP_HOST not configured — skipping %s to %s", label, to)
        return False
    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.ehlo()
            server.starttls(context=ctx)
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_FROM, to, msg.as_string())
        log.info("[Email] %s sent to %s", label, to)
        return True
    except Exception as exc:
        log.error("[Email] Failed to send %s to %s: %s", label, to, exc)
        return False


def send_magic_link_email(to: str, magic_url: str) -> bool:
    """Send a workspace magic sign-in link. Valid for 15 minutes."""
    body_text = f"""Hello,

Click the link below to sign in to your CROWN workspace. This link is valid for 15 minutes and can only be used once.

{magic_url}

If you didn't request this, you can safely ignore this email.

— CROWN Automated Notification
"""

    body_html = f"""<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#333;max-width:520px;margin:auto;padding:24px">
  <div style="margin-bottom:24px">
    <span style="font-family:monospace;font-weight:700;font-size:20px;letter-spacing:0.2em">CROWN</span>
    <span style="font-size:11px;color:#888;margin-left:8px">Whole-Head Segmentation</span>
  </div>
  <h2 style="font-size:18px;margin-bottom:8px">Sign in to your workspace</h2>
  <p style="color:#555;margin-bottom:20px">
    Click the button below to sign in. This link is valid for <strong>15 minutes</strong>
    and can only be used once.
  </p>
  <a href="{magic_url}"
     style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;
            padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">
    Sign in to CROWN →
  </a>
  <p style="margin-top:24px;font-size:12px;color:#999">
    If you didn't request this sign-in link, you can safely ignore this email.
  </p>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "CROWN: Your sign-in link"
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_html, "html"))
    return _send(msg, to, "magic link")


def send_completion_email(
    to: str,
    session_id: str,
    job_type: str,
    completed_models: list[str],
    results_url: str,
) -> bool:
    """Send a job completion notification."""
    models_text = ", ".join(completed_models) if completed_models else "your job"
    models_html = "".join(f"<li>{m}</li>" for m in completed_models) if completed_models else "<li>Job complete</li>"

    body_text = f"""Hello,

Your {job_type} job has finished processing.

Models completed: {models_text}
Session ID: {session_id}

View your results: {results_url}

— CROWN Automated Notification
"""

    body_html = f"""<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#333;max-width:520px;margin:auto;padding:24px">
  <div style="margin-bottom:24px">
    <span style="font-family:monospace;font-weight:700;font-size:20px;letter-spacing:0.2em">CROWN</span>
    <span style="font-size:11px;color:#888;margin-left:8px">Whole-Head Segmentation</span>
  </div>
  <h2 style="font-size:18px;margin-bottom:8px">Your {job_type} is ready</h2>
  <p style="color:#555;margin-bottom:12px">The following models completed successfully:</p>
  <ul style="color:#333;margin-bottom:20px">{models_html}</ul>
  <p style="font-size:12px;color:#888;margin-bottom:20px">Session: <code>{session_id}</code></p>
  <a href="{results_url}"
     style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;
            padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">
    View results →
  </a>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"CROWN: {job_type} complete"
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_html, "html"))
    return _send(msg, to, f"{job_type} completion")
