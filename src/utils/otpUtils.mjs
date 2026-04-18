// src/utils/otpUtils.mjs
// Production OTP — custom domain SMTP + Sparrow SMS Nepal
// Security: crypto.randomInt, timing-safe compare, rate limiting,
//           attempt locking, audit logging, IP tracking

import nodemailer        from 'nodemailer'
import { createClient } from '@supabase/supabase-js'
import crypto            from 'crypto'

// ── Supabase (service role — full DB access, bypasses RLS) ────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ── Constants ─────────────────────────────────────────────────
const OTP_EXPIRY_MINUTES = 10
const MAX_ATTEMPTS       = 5
const RATE_LIMIT_COUNT   = 3    // max sends per window
const RATE_LIMIT_WINDOW  = 15   // minutes

// ── Custom domain SMTP transporter ───────────────────────────
// cPanel: host = mail.yourdomain.com, port = 587 or 465
// Zoho:   host = smtp.zoho.com,       port = 587
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
  pool:           true,
  maxConnections: 5,
})

transporter.verify((err) => {
  if (err) console.error('[OTP] SMTP error:', err.message)
  else     console.log('[OTP] SMTP ready —', process.env.SMTP_USER)
})



// ── Sparrow SMS ───────────────────────────────────────────────
// Signup: sparrowsms.com | Free: 50 SMS | ~Rs.2/SMS after
async function sendSparrowSMS(phone, message) {
  const params = new URLSearchParams({
    token: process.env.SPARROW_SMS_TOKEN,
    from:  process.env.SPARROW_SMS_FROM || 'PujaSam',
    to:    phone,
    text:  message,
  })
  const res  = await fetch(`https://api.sparrowsms.com/v2/sms/?${params}`, { method: 'GET' })
  const data = await res.json()
  if (!res.ok || data.response_code !== 200) {
    throw new Error(`SMS failed: ${data.message || JSON.stringify(data)}`)
  }
  return data
}

// ── Phone normalization ───────────────────────────────────────
export function normalizeNepaliPhone(raw) {
  let n = String(raw).replace(/[\s\-().+]/g, '')
  if (n.startsWith('00977'))     n = n.slice(5)
  else if (n.startsWith('+977')) n = n.slice(4)
  else if (n.startsWith('977') && n.length === 13) n = n.slice(3)
  if (!/^(97|98)\d{8}$/.test(n)) {
    throw new Error('Invalid Nepali mobile number. Must be 10 digits starting with 97 or 98.')
  }
  return n
}

export function validateNepaliPhone(phone) {
  try   { return { valid: true,  normalized: normalizeNepaliPhone(phone), error: null } }
  catch (e) { return { valid: false, normalized: null, error: e.message } }
}

export function formatNepaliPhone(p) {
  if (!p || p.length !== 10) return p
  return `${p.slice(0,4)}-${p.slice(4,7)}-${p.slice(7)}`
}

// ── Audit logger ──────────────────────────────────────────────
async function audit(payload) {
  try {
    await supabase.from('otp_audit_log').insert({
      ...payload,
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
    })
  } catch (e) { console.error('[OTP Audit]', e.message) }
}

// ── OTP generator (crypto-secure) ────────────────────────────
export function generateOTP() {
  return String(crypto.randomInt(100000, 999999))
}

// ── Email template ────────────────────────────────────────────
function emailHTML({ otp_type, otp, name }) {
  const isStaff = otp_type === 'staff_login'
  const color   = isStaff ? '#007BA8' : '#1a5c38'
  const accent  = isStaff ? '#00BFFF' : '#4caf50'

  const title = {
    email_verify:   'Verify Your Email Address',
    phone_verify:   'Verify Your Phone Number',
    staff_login:    'Staff Login Verification',
    password_reset: 'Reset Your Password',
  }[otp_type] || 'Verification Code'

  const body = {
    email_verify:   'Use the code below to verify your email and complete registration.',
    phone_verify:   'Use the code below to verify your Nepali mobile number.',
    staff_login:    "Use this code to complete your staff login. If this wasn't you, contact your administrator immediately.",
    password_reset: 'Use this code to reset your password. If you did not request this, ignore this email.',
  }[otp_type] || ''

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;">

  <tr><td style="background:linear-gradient(135deg,${color},${accent});border-radius:16px 16px 0 0;padding:36px 40px;text-align:center;">
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Puja Samargi</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:12px;letter-spacing:0.12em;text-transform:uppercase;">
      ${isStaff ? 'Staff Portal' : 'Mental Health Platform · Nepal'}
    </p>
  </td></tr>

  <tr><td style="background:#fff;padding:40px;">
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:600;">${title}</h2>
    <p style="margin:0 0 28px;color:#6b7280;line-height:1.75;font-size:15px;">
      Hi <strong style="color:#111827;">${name || 'there'}</strong>,<br>${body}
    </p>
    <table role="presentation" width="100%" style="margin-bottom:28px;">
      <tr><td style="background:#f9fafb;border:2px dashed ${accent};border-radius:14px;padding:28px;text-align:center;">
        <p style="margin:0 0 6px;font-size:11px;color:#9ca3af;letter-spacing:0.15em;text-transform:uppercase;font-weight:600;">Your verification code</p>
        <div style="font-size:42px;font-weight:800;letter-spacing:0.4em;color:${color};font-family:'Courier New',monospace;margin:4px 0;">${otp}</div>
        <p style="margin:10px 0 0;font-size:13px;color:#9ca3af;">Expires in <strong style="color:#6b7280;">${OTP_EXPIRY_MINUTES} minutes</strong></p>
      </td></tr>
    </table>
    <table role="presentation" width="100%" style="margin-bottom:24px;">
      <tr><td style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;padding:14px 18px;">
        <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6;">
          <strong>Security notice:</strong> Never share this code with anyone.
          Puja Samargi staff will <strong>never</strong> ask for your OTP.
        </p>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;color:#d1d5db;text-align:center;">Didn't request this? You can safely ignore this email.</p>
  </td></tr>

  <tr><td style="background:#f9fafb;border-radius:0 0 16px 16px;border-top:1px solid #e5e7eb;padding:24px 40px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.7;">
      &copy; ${new Date().getFullYear()} Puja Samargi &middot; Kathmandu, Nepal<br>
      This is an automated message &mdash; please do not reply.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

// ── SMS message ───────────────────────────────────────────────
function smsText(otp_type, otp) {
  const m = {
    email_verify:   `Puja Samargi code: ${otp}. Valid ${OTP_EXPIRY_MINUTES}min. Do not share.`,
    phone_verify:   `Puja Samargi verification: ${otp}. Valid ${OTP_EXPIRY_MINUTES}min. Do not share.`,
    staff_login:    `Puja Samargi staff login: ${otp}. Valid ${OTP_EXPIRY_MINUTES}min. Not you? Contact admin.`,
    password_reset: `Puja Samargi password reset: ${otp}. Valid ${OTP_EXPIRY_MINUTES}min. Do not share.`,
  }
  return m[otp_type] || `Your Puja Samargi code: ${otp}. Valid ${OTP_EXPIRY_MINUTES} minutes.`
}

// ================================================================
// MAIN: sendOTP
// channel: 'email' | 'sms' | 'both'
// ================================================================
export async function sendOTP({
  user_id    = null,
  email      = null,
  phone      = null,
  otp_type,
  name       = 'there',
  channel    = 'email',
  ip_address = null,
  user_agent = null,
}) {
  // Validate type
  const validTypes = ['email_verify','phone_verify','staff_login','password_reset']
  if (!validTypes.includes(otp_type)) throw new Error(`Invalid otp_type.`)

  // Validate channel requirements
  if ((channel === 'email' || channel === 'both') && !email)
    throw new Error('email is required for email channel.')
  if ((channel === 'sms' || channel === 'both') && !phone)
    throw new Error('phone is required for sms channel.')

  // Normalize phone
  let normalizedPhone = null
  if (phone) normalizedPhone = normalizeNepaliPhone(phone)

  // ── Rate limit ───────────────────────────────────────────────
  const since      = new Date(Date.now() - RATE_LIMIT_WINDOW * 60 * 1000).toISOString()
  const identifier = email || normalizedPhone

  const { count } = await supabase
    .from('otp_verifications')
    .select('*', { count: 'exact', head: true })
    .or(`email.eq.${identifier},phone.eq.${identifier}`)
    .eq('otp_type', otp_type)
    .gte('created_at', since)

  if ((count ?? 0) >= RATE_LIMIT_COUNT) {
    await audit({ user_id, email, phone: normalizedPhone, otp_type, action: 'rate_limited', ip_address, user_agent })
    throw new Error(`Too many requests. Wait ${RATE_LIMIT_WINDOW} minutes before requesting another code.`)
  }

  // ── Invalidate previous OTPs ─────────────────────────────────
  const orClause = [
    email           && `email.eq.${email}`,
    normalizedPhone && `phone.eq.${normalizedPhone}`,
  ].filter(Boolean).join(',')

  await supabase
    .from('otp_verifications')
    .update({ verified: true })
    .eq('otp_type', otp_type)
    .eq('verified', false)
    .or(orClause)

  // ── Generate & store ─────────────────────────────────────────
  const otp        = generateOTP()
  const expires_at = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString()

  const { data: otpRow, error: insertErr } = await supabase
    .from('otp_verifications')
    .insert({
      user_id:    user_id ? String(user_id) : null,
      email:      email || null,
      phone:      normalizedPhone || null,
      otp_code:   otp,
      otp_type,
      expires_at,
      ip_address,
      user_agent,
    })
    .select('id')
    .single()

  if (insertErr) throw new Error(`DB error: ${insertErr.message}`)

  // ── Send ─────────────────────────────────────────────────────
  const subjectMap = {
    email_verify:   '[Puja Samargi] Verify your email address',
    phone_verify:   '[Puja Samargi] Verify your phone number',
    staff_login:    '[Puja Samargi] Staff login verification code',
    password_reset: '[Puja Samargi] Reset your password',
  }

  const errors = []

  if (channel === 'email' || channel === 'both') {
    try {
      await transporter.sendMail({
        from:    `"Puja Samargi" <${process.env.SMTP_USER}>`,
        to:      email,
        subject: subjectMap[otp_type] || '[Puja Samargi] Your verification code',
        html:    emailHTML({ otp_type, otp, name }),
        text:    `Your Puja Samargi code: ${otp}\nExpires in ${OTP_EXPIRY_MINUTES} minutes. Do not share this code.`,
      })
      await audit({ otp_id: otpRow?.id, user_id, email, otp_type, action: 'sent', ip_address, user_agent, metadata: { channel: 'email' } })
    } catch (e) {
      errors.push(`Email: ${e.message}`)
      console.error('[OTP] Email failed:', e.message)
    }
  }

  if (channel === 'sms' || channel === 'both') {
    try {
await sendSparrowSMS(`977${normalizedPhone}`, smsText(otp_type, otp))
      await audit({ otp_id: otpRow?.id, user_id, phone: normalizedPhone, otp_type, action: 'sent', ip_address, user_agent, metadata: { channel: 'sms' } })
    } catch (e) {
      errors.push(`SMS: ${e.message}`)
      console.error('[OTP] SMS failed:', e.message)
    }
  }

  const allFailed = (channel === 'both' && errors.length >= 2) ||
                    (channel !== 'both' && errors.length >= 1)
  if (allFailed) throw new Error(`Failed to send OTP. ${errors.join(' ')}`)

  return { success: true, expires_in_minutes: OTP_EXPIRY_MINUTES }
}

// ================================================================
// MAIN: verifyOTP
// ================================================================
export async function verifyOTP({
  email      = null,
  phone      = null,
  otp_code,
  otp_type,
  ip_address = null,
  user_agent = null,
}) {
  if (!email && !phone) throw new Error('email or phone is required.')
  if (!otp_code)        throw new Error('otp_code is required.')
  if (!otp_type)        throw new Error('otp_type is required.')

  const code = String(otp_code).trim()
  if (!/^\d{6}$/.test(code)) throw new Error('OTP must be exactly 6 digits.')

  let normalizedPhone = null
  if (phone) {
    try { normalizedPhone = normalizeNepaliPhone(phone) }
    catch { throw new Error('Invalid phone number.') }
  }

  // ── Find latest valid OTP ────────────────────────────────────
  let query = supabase
    .from('otp_verifications')
    .select('*')
    .eq('otp_type', otp_type)
    .eq('verified', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)

  if (email)           query = query.eq('email', email)
  else if (normalizedPhone) query = query.eq('phone', normalizedPhone)

  const { data: row, error } = await query.single()

  if (error || !row) {
    await audit({ email, phone: normalizedPhone, otp_type, action: 'expired', ip_address, user_agent })
    throw new Error('OTP expired or not found. Please request a new code.')
  }

  // ── Attempt limit ────────────────────────────────────────────
  if (row.attempts >= MAX_ATTEMPTS) {
    await audit({ otp_id: row.id, email, phone: normalizedPhone, otp_type, action: 'failed', ip_address, user_agent, metadata: { reason: 'max_attempts' } })
    throw new Error('Too many incorrect attempts. Please request a new code.')
  }

  // ── Increment attempts ───────────────────────────────────────
  await supabase
    .from('otp_verifications')
    .update({ attempts: row.attempts + 1 })
    .eq('id', row.id)

  // ── Timing-safe comparison ───────────────────────────────────
  const a = Buffer.from(row.otp_code.padEnd(6, '0'))
  const b = Buffer.from(code.padEnd(6, '0'))
  const match = crypto.timingSafeEqual(a, b) && row.otp_code === code

  if (!match) {
    const remaining = MAX_ATTEMPTS - (row.attempts + 1)
    await audit({ otp_id: row.id, email, phone: normalizedPhone, otp_type, action: 'failed', ip_address, user_agent, metadata: { remaining } })
    throw new Error(
      remaining > 0
        ? `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
        : 'No attempts remaining. Please request a new code.'
    )
  }

  // ── Mark verified ────────────────────────────────────────────
  await supabase.from('otp_verifications').update({ verified: true }).eq('id', row.id)

  await audit({ otp_id: row.id, user_id: row.user_id, email, phone: normalizedPhone, otp_type, action: 'verified', ip_address, user_agent })

  // Cleanup old OTPs opportunistically (non-blocking)
;(async () => { try { await supabase.rpc('cleanup_expired_otps') } catch {} })()

  return { success: true, user_id: row.user_id, email: row.email, phone: row.phone, otp_type }
}
