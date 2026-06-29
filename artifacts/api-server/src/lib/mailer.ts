import nodemailer from "nodemailer";

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;

const isConfigured = !!(GMAIL_USER && GMAIL_PASS);

const transporter = isConfigured
  ? nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_PASS,
      },
    })
  : null;

const FROM = `"Nexa Anime" <${GMAIL_USER ?? "noreply@nexaanime.com"}>`;

function baseTemplate(title: string, body: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #222;border-radius:16px;overflow:hidden;max-width:480px;width:100%;">
        <!-- Header -->
        <tr><td style="background:#111;padding:32px 40px 24px;border-bottom:1px solid #1a1a1a;text-align:center;">
          <p style="margin:0;font-size:22px;font-weight:700;color:#fff;letter-spacing:0.5px;">✦ Nexa Anime</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px;">
          ${body}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 40px 28px;border-top:1px solid #1a1a1a;text-align:center;">
          <p style="margin:0;font-size:12px;color:#444;">This email was sent by Nexa Anime. If you didn't request this, you can safely ignore it.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendMagicCodeEmail(to: string, displayName: string, code: string) {
  if (!transporter) {
    console.warn("[mailer] GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping magic code email");
    return;
  }
  const html = baseTemplate("Your Nexa Anime login code", `
    <p style="margin:0 0 8px;font-size:16px;color:#e0e0e0;">Hi <strong style="color:#fff;">${displayName}</strong>,</p>
    <p style="margin:0 0 28px;font-size:14px;color:#888;line-height:1.6;">Here's your one-time login code for Nexa Anime. It expires in <strong style="color:#ccc;">10 minutes</strong>.</p>
    <div style="background:#0a0a0a;border:1px solid #2a2a2a;border-radius:12px;padding:24px;text-align:center;margin:0 0 28px;">
      <p style="margin:0 0 8px;font-size:11px;color:#555;letter-spacing:3px;text-transform:uppercase;font-family:monospace;">Login Code</p>
      <p style="margin:0;font-size:36px;font-weight:800;color:#fff;letter-spacing:0.4em;font-family:'Courier New',monospace;">${code}</p>
    </div>
    <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">Enter this code on the login page to sign in. This code is single-use and will expire after 10 minutes.</p>
  `);

  await transporter.sendMail({ from: FROM, to, subject: `${code} — your Nexa Anime login code`, html });
}

export async function sendVerificationEmail(to: string, displayName: string, token: string, baseUrl: string) {
  if (!transporter) {
    console.warn("[mailer] GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping verification email");
    return;
  }
  const link = `${baseUrl}/verify-email/${token}`;
  const html = baseTemplate("Verify your Nexa Anime email", `
    <p style="margin:0 0 8px;font-size:16px;color:#e0e0e0;">Hi <strong style="color:#fff;">${displayName}</strong>,</p>
    <p style="margin:0 0 28px;font-size:14px;color:#888;line-height:1.6;">Welcome to Nexa Anime! Please verify your email address to unlock all features.</p>
    <div style="text-align:center;margin:0 0 28px;">
      <a href="${link}" style="display:inline-block;background:#fff;color:#000;font-weight:700;font-size:14px;padding:14px 36px;border-radius:10px;text-decoration:none;letter-spacing:0.3px;">Verify Email Address</a>
    </div>
    <p style="margin:0 0 8px;font-size:13px;color:#555;">Or paste this link in your browser:</p>
    <p style="margin:0;font-size:12px;color:#444;word-break:break-all;font-family:monospace;">${link}</p>
  `);

  await transporter.sendMail({ from: FROM, to, subject: "Verify your Nexa Anime email address", html });
}

export async function sendPasswordResetEmail(to: string, displayName: string, token: string, baseUrl: string) {
  if (!transporter) {
    console.warn("[mailer] GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping password reset email");
    return;
  }
  const link = `${baseUrl}/reset/${token}`;
  const html = baseTemplate("Reset your Nexa Anime password", `
    <p style="margin:0 0 8px;font-size:16px;color:#e0e0e0;">Hi <strong style="color:#fff;">${displayName}</strong>,</p>
    <p style="margin:0 0 28px;font-size:14px;color:#888;line-height:1.6;">We received a request to reset your password. Click the button below — the link expires in <strong style="color:#ccc;">24 hours</strong>.</p>
    <div style="text-align:center;margin:0 0 28px;">
      <a href="${link}" style="display:inline-block;background:#fff;color:#000;font-weight:700;font-size:14px;padding:14px 36px;border-radius:10px;text-decoration:none;letter-spacing:0.3px;">Reset Password</a>
    </div>
    <p style="margin:0 0 8px;font-size:13px;color:#555;">Or paste this link in your browser:</p>
    <p style="margin:0;font-size:12px;color:#444;word-break:break-all;font-family:monospace;">${link}</p>
    <p style="margin:24px 0 0;font-size:13px;color:#555;">If you didn't request a password reset, you can safely ignore this email.</p>
  `);

  await transporter.sendMail({ from: FROM, to, subject: "Reset your Nexa Anime password", html });
}
