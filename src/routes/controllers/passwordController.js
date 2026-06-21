/* eslint-disable no-undef */
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const nodemailer = require('nodemailer')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SALT_ROUNDS = 10
const OTP_TTL_MIN = 10
const RESET_TOKEN_TTL_MIN = 15

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

function generateOtp() {
  // 6-digit numeric code, zero-padded
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0')
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex')
}

// Generic message used for both "email not found" and "password wrong" cases.
// Keeping this identical for both failure modes stops the endpoint from being
// usable to discover which emails are registered.
const GENERIC_AUTH_FAIL = 'Email or current password is incorrect.'

// ============================================================
// 🟢 UPDATE PASSWORD — PUBLIC, email + current password
// No login required. User proves identity by supplying their
// current password alongside their email.
//
// SECURITY NOTE: this endpoint is intentionally rate-limited at
// the route level (see passwordRoutes.js) because, unlike the
// JWT-protected version it replaces, anyone can attempt a
// password guess against any email address. Do not remove the
// rate limiter without adding an equivalent protection.
// ============================================================
const updatePasswordPublic = async (req, res) => {
  const { email, current, next } = req.body

  if (!email || !current || !next) {
    return res.status(400).json({ success: false, message: 'Email, current password, and new password are required.' })
  }
  if (next.length < 8) {
    return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' })
  }

  const normalizedEmail = email.toLowerCase().trim()

  try {
    const { data: userRow, error: fetchErr } = await supabase
      .from('profiles')
      .select('id, password_hash')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (fetchErr) throw fetchErr

    // Same generic response whether the email doesn't exist or the
    // password is wrong — see GENERIC_AUTH_FAIL above.
    if (!userRow) {
      return res.status(401).json({ success: false, message: GENERIC_AUTH_FAIL })
    }

    const matches = await bcrypt.compare(current, userRow.password_hash)
    if (!matches) {
      return res.status(401).json({ success: false, message: GENERIC_AUTH_FAIL })
    }

    const sameAsOld = await bcrypt.compare(next, userRow.password_hash)
    if (sameAsOld) {
      return res.status(400).json({ success: false, message: 'New password must be different from your current password.' })
    }

    const newHash = await bcrypt.hash(next, SALT_ROUNDS)

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ password_hash: newHash })
      .eq('id', userRow.id)

    if (updateErr) throw updateErr

    return res.json({ success: true, message: 'Password updated successfully.' })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
}

// ============================================================
// 🟢 FORGOT PASSWORD — STEP 1: request OTP
// ============================================================
const requestPasswordResetOtp = async (req, res) => {
  const { email } = req.body

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required.' })
  }

  try {
    const { data: userRow } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle()

    // Always respond success even if the email doesn't exist — prevents
    // attackers from using this endpoint to discover registered emails.
    if (!userRow) {
      return res.json({ success: true, message: 'If that email is registered, a code has been sent.' })
    }

    const otp = generateOtp()
    const otpHash = await bcrypt.hash(otp, SALT_ROUNDS)
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString()

    // Invalidate any previous unused OTPs for this email
    await supabase
      .from('password_reset_otps')
      .update({ used: true })
      .eq('email', userRow.email)
      .eq('used', false)

    const { error: insertErr } = await supabase
      .from('password_reset_otps')
      .insert({ email: userRow.email, otp_hash: otpHash, expires_at: expiresAt })

    if (insertErr) throw insertErr

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: userRow.email,
      subject: 'Your password reset code',
      text: `Your password reset code is ${otp}. It expires in ${OTP_TTL_MIN} minutes. If you didn't request this, you can ignore this email.`,
      html: `<p>Your password reset code is:</p><h2 style="letter-spacing:4px;">${otp}</h2><p>This code expires in ${OTP_TTL_MIN} minutes. If you didn't request this, you can safely ignore this email.</p>`,
    })

    return res.json({ success: true, message: 'If that email is registered, a code has been sent.' })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
}

// ============================================================
// 🟢 FORGOT PASSWORD — STEP 2: verify OTP, issue reset token
// ============================================================
const verifyPasswordResetOtp = async (req, res) => {
  const { email, otp } = req.body

  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and code are required.' })
  }

  try {
    const { data: record, error: fetchErr } = await supabase
      .from('password_reset_otps')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fetchErr) throw fetchErr

    if (!record) {
      return res.status(400).json({ success: false, message: 'No active code found. Please request a new one.' })
    }

    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: 'This code has expired. Please request a new one.' })
    }

    const matches = await bcrypt.compare(otp, record.otp_hash)
    if (!matches) {
      return res.status(400).json({ success: false, message: 'Incorrect code. Please try again.' })
    }

    const resetToken = generateResetToken()
    const resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60 * 1000).toISOString()

    const { error: updateErr } = await supabase
      .from('password_reset_otps')
      .update({ reset_token: resetToken, expires_at: resetTokenExpiresAt })
      .eq('id', record.id)

    if (updateErr) throw updateErr

    return res.json({ success: true, resetToken })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
}

// ============================================================
// 🟢 FORGOT PASSWORD — STEP 3: set new password using reset token
// ============================================================
const resetPasswordWithToken = async (req, res) => {
  const { email, resetToken, next } = req.body

  if (!email || !resetToken || !next) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' })
  }
  if (next.length < 8) {
    return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' })
  }

  try {
    const { data: record, error: fetchErr } = await supabase
      .from('password_reset_otps')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .eq('reset_token', resetToken)
      .eq('used', false)
      .maybeSingle()

    if (fetchErr) throw fetchErr

    if (!record) {
      return res.status(400).json({ success: false, message: 'Invalid or already-used reset session. Please start over.' })
    }

    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: 'Reset session expired. Please start over.' })
    }

    const { data: userRow, error: userErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle()

    if (userErr) throw userErr
    if (!userRow) {
      return res.status(404).json({ success: false, message: 'User not found.' })
    }

    const newHash = await bcrypt.hash(next, SALT_ROUNDS)

    const { error: pwUpdateErr } = await supabase
      .from('profiles')
      .update({ password_hash: newHash })
      .eq('id', userRow.id)

    if (pwUpdateErr) throw pwUpdateErr

    // Burn this OTP/token so it cannot be replayed
    await supabase
      .from('password_reset_otps')
      .update({ used: true })
      .eq('id', record.id)

    return res.json({ success: true, message: 'Password has been reset successfully.' })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
}

module.exports = {
  updatePasswordPublic,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPasswordWithToken,
}