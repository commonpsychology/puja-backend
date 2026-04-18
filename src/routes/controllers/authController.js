/* eslint-disable no-undef */
const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const crypto   = require('crypto')
const { validationResult } = require('express-validator')
const { createClient }     = require('@supabase/supabase-js')

// ── Supabase client (service role — bypasses RLS, server only) ────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Token config ──────────────────────────────────────────────────────────────
const ACCESS_TOKEN_EXPIRY     = '15m'
const REFRESH_TOKEN_EXPIRY    = '7d'
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000   // 7 days in ms
const EMAIL_TOKEN_EXPIRY_MS   = 24 * 60 * 60 * 1000        // 24 hours
const RESET_TOKEN_EXPIRY_MS   = 60 * 60 * 1000             // 1 hour

const signAccessToken  = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET,         { expiresIn: ACCESS_TOKEN_EXPIRY })

const signRefreshToken = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY })

// ── Helpers ───────────────────────────────────────────────────────────────────
const sha256 = (str) => crypto.createHash('sha256').update(str).digest('hex')

const validate = (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    res.status(422).json({ success: false, errors: errors.array() })
    return false
  }
  return true
}

// Safe profile shape — never expose password_hash
const safeProfile = (p) => ({
  id:              p.id,
  fullName:        p.full_name,
  displayName:     p.display_name,
  email:           p.email,
  avatarUrl:       p.avatar_url,
  role:            p.role,
  isEmailVerified: p.is_email_verified,
  isActive:        p.is_active,
  createdAt:       p.created_at,
})

// =============================================================================
// POST /auth/register
// =============================================================================
const register = async (req, res) => {
  if (!validate(req, res)) return

const { name, email, password, phone } = req.body

  // 1. Duplicate email check
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle()

  if (existing) {
    return res.status(409).json({
      success: false,
      message: 'An account with this email already exists.',
    })
  }

  // 2. Hash password
  const password_hash = await bcrypt.hash(password, 12)

  // 3. Create profile
  const { data: profile, error: profileError } = await supabase
  .from('profiles')
  .insert({
    full_name:         name,
    email:             email.toLowerCase(),
    password_hash,
    phone:             phone || null,   // ← ADD THIS LINE
    role:              'client',
    is_email_verified: true,
    is_active:         true,
  })
  .select()
  .single()

  if (profileError) {
    console.error('register error:', profileError)
    return res.status(500).json({ success: false, message: 'Could not create account. Please try again.' })
  }

  // 4. Generate verification token and store HASH in email_verifications table
  const rawToken    = crypto.randomBytes(32).toString('hex')
  const tokenHash   = sha256(rawToken)
  const expiresAt   = new Date(Date.now() + EMAIL_TOKEN_EXPIRY_MS)

  const { error: tokenError } = await supabase
    .from('email_verifications')
    .insert({ user_id: profile.id, token: tokenHash, expires_at: expiresAt })

  if (tokenError) {
    console.error('email_verifications insert error:', tokenError)
    // Profile was created — still return success but log the issue
  }

  // 5. Send verification email (replace log with your email service)
  const verifyUrl = `${process.env.APP_URL}/auth/verify-email?token=${rawToken}`
  console.log(`[DEV] Email verify URL for ${email}: ${verifyUrl}`)
  // await sendEmail({ to: email, subject: 'Verify your Puja Samargi account', verifyUrl })

  return res.status(201).json({
    success: true,
    message: 'Account created. Please check your email to verify your account.',
    user: safeProfile(profile),
  })
}

// =============================================================================
// POST /auth/login
// =============================================================================
const login = async (req, res) => {
  if (!validate(req, res)) return

  const { email, password } = req.body
  const INVALID = 'Invalid email or password.'

  // 1. Fetch profile (need password_hash so select *)
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle()

  if (error || !profile) {
    return res.status(401).json({ success: false, message: INVALID })
  }

  // 2. Verify password
  const valid = await bcrypt.compare(password, profile.password_hash)
  if (!valid) {
    return res.status(401).json({ success: false, message: INVALID })
  }

  // 3. Check active status
  if (!profile.is_active) {
    return res.status(403).json({ success: false, message: 'Your account has been deactivated. Please contact support.' })
  }

  // 4. Require email verification
  // if (!profile.is_email_verified) {
  //   return res.status(403).json({
  //     success: false,
  //     message: 'Please verify your email before logging in.',
  //   })
  // }

  // 5. Sign tokens
  const tokenPayload = { sub: profile.id, email: profile.email, role: profile.role }
  const accessToken  = signAccessToken(tokenPayload)
  const refreshToken = signRefreshToken(tokenPayload)

  // 6. Store hashed refresh token in refresh_tokens table
  const { error: rtError } = await supabase
    .from('refresh_tokens')
    .insert({
      user_id:     profile.id,
      token_hash:  sha256(refreshToken),
      device_info: req.headers['user-agent'] || null,
      ip_address:  req.ip || null,
      expires_at:  new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    })

  if (rtError) {
    console.error('refresh_tokens insert error:', rtError)
    return res.status(500).json({ success: false, message: 'Login failed. Please try again.' })
  }

  return res.status(200).json({
    success:      true,
    message:      'Logged in successfully.',
    accessToken,
    refreshToken,
    user:         safeProfile(profile),
  })
}

// =============================================================================
// POST /auth/refresh
// =============================================================================
const refresh = async (req, res) => {
  const { refreshToken } = req.body

  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'Refresh token is required.' })
  }

  // 1. Verify JWT signature
  let payload
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET)
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' })
  }

  // 2. Look up hashed token in DB
  const { data: stored, error } = await supabase
    .from('refresh_tokens')
    .select('*')
    .eq('token_hash', sha256(refreshToken))
    .eq('user_id', payload.sub)
    .maybeSingle()

  if (error || !stored) {
    return res.status(401).json({ success: false, message: 'Refresh token not recognised. Please log in again.' })
  }

  if (new Date(stored.expires_at) < new Date()) {
    await supabase.from('refresh_tokens').delete().eq('id', stored.id)
    return res.status(401).json({ success: false, message: 'Refresh token expired. Please log in again.' })
  }

  // 3. Rotate — delete old token, issue new pair
  await supabase.from('refresh_tokens').delete().eq('id', stored.id)

  const newAccessToken  = signAccessToken({ sub: payload.sub, email: payload.email, role: payload.role })
  const newRefreshToken = signRefreshToken({ sub: payload.sub, email: payload.email, role: payload.role })

  await supabase.from('refresh_tokens').insert({
    user_id:     payload.sub,
    token_hash:  sha256(newRefreshToken),
    device_info: req.headers['user-agent'] || null,
    ip_address:  req.ip || null,
    expires_at:  new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
  })

  return res.status(200).json({
    success:      true,
    accessToken:  newAccessToken,
    refreshToken: newRefreshToken,
  })
}

// POST /auth/check-credentials
// Validates email+password but issues NO tokens
const checkCredentials = async (req, res) => {
  const { email, password } = req.body
  const INVALID = 'Invalid email or password.'

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active, password_hash')
    .eq('email', email.toLowerCase())
    .maybeSingle()

  if (!profile) return res.status(401).json({ message: INVALID })

  const valid = await bcrypt.compare(password, profile.password_hash)
  if (!valid) return res.status(401).json({ message: INVALID })

  if (!profile.is_active) return res.status(403).json({ message: 'Account deactivated.' })

  if (!['admin', 'staff', 'therapist'].includes(profile.role))
    return res.status(403).json({ message: 'Staff access only.' })

  return res.status(200).json({
    success: true,
    user: {
      id:        profile.id,
      full_name: profile.full_name,
      email:     profile.email,
      role:      profile.role,
    }
  })
}



// =============================================================================
// POST /auth/logout
// =============================================================================
const logout = async (req, res) => {
  const { refreshToken } = req.body

  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'Refresh token is required.' })
  }

  await supabase
    .from('refresh_tokens')
    .delete()
    .eq('token_hash', sha256(refreshToken))

  return res.status(200).json({ success: true, message: 'Logged out successfully.' })
}

// =============================================================================
// POST /auth/logout-all  (protected — requires authenticate middleware)
// =============================================================================
const logoutAll = async (req, res) => {
  const userId = req.user?.sub

  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized.' })
  }

  const { error } = await supabase
    .from('refresh_tokens')
    .delete()
    .eq('user_id', userId)

  if (error) {
    return res.status(500).json({ success: false, message: 'Could not log out all devices.' })
  }

  return res.status(200).json({ success: true, message: 'Logged out from all devices.' })
}

// =============================================================================
// GET /auth/verify-email?token=...
// =============================================================================
const verifyEmail = async (req, res) => {
  const { token } = req.query

  if (!token) {
    return res.status(400).json({ success: false, message: 'Verification token is missing.' })
  }

  // Look up hashed token in email_verifications
  const { data: record, error } = await supabase
    .from('email_verifications')
    .select('*')
    .eq('token', sha256(token))
    .maybeSingle()

  if (error || !record) {
    return res.status(400).json({ success: false, message: 'Invalid verification link.' })
  }

  if (new Date(record.expires_at) < new Date()) {
    await supabase.from('email_verifications').delete().eq('id', record.id)
    return res.status(400).json({
      success: false,
      message: 'Verification link has expired. Please request a new one.',
    })
  }

  // Check if already verified
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_email_verified')
    .eq('id', record.user_id)
    .maybeSingle()

  if (profile?.is_email_verified) {
    await supabase.from('email_verifications').delete().eq('id', record.id)
    return res.status(200).json({ success: true, message: 'Email already verified. You can log in.' })
  }

  // Mark profile as verified
  await supabase
    .from('profiles')
    .update({ is_email_verified: true })
    .eq('id', record.user_id)

  // Delete used token
  await supabase.from('email_verifications').delete().eq('id', record.id)

  return res.status(200).json({ success: true, message: 'Email verified successfully. You can now log in.' })
}

// =============================================================================
// POST /auth/resend-verification
// =============================================================================
const resendVerification = async (req, res) => {
  if (!validate(req, res)) return

  const { email } = req.body

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, is_email_verified')
    .eq('email', email.toLowerCase())
    .maybeSingle()

  // Always 200 — no user enumeration
  if (!profile || profile.is_email_verified) {
    return res.status(200).json({
      success: true,
      message: 'If that email exists and is unverified, a new verification link has been sent.',
    })
  }

  // Delete any existing tokens for this user
  await supabase.from('email_verifications').delete().eq('user_id', profile.id)

  // Create new token
  const rawToken  = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_EXPIRY_MS)

  await supabase
    .from('email_verifications')
    .insert({ user_id: profile.id, token: sha256(rawToken), expires_at: expiresAt })

  const verifyUrl = `${process.env.APP_URL}/auth/verify-email?token=${rawToken}`
  console.log(`[DEV] Resend verify URL for ${email}: ${verifyUrl}`)
  // await sendEmail({ to: email, subject: 'Verify your Puja Samargi account', verifyUrl })

  return res.status(200).json({
    success: true,
    message: 'If that email exists and is unverified, a new verification link has been sent.',
  })
}

// =============================================================================
// POST /auth/forgot-password
// =============================================================================
const forgotPassword = async (req, res) => {
  if (!validate(req, res)) return

  const { email } = req.body

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle()

  // Always 200 — no user enumeration
  if (!profile) {
    return res.status(200).json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    })
  }

  // Delete any existing unused reset tokens for this user
  await supabase.from('password_resets').delete().eq('user_id', profile.id).is('used_at', null)

  // Create new reset token
  const rawToken  = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS)

  await supabase
    .from('password_resets')
    .insert({ user_id: profile.id, token: sha256(rawToken), expires_at: expiresAt })

  const resetUrl = `${process.env.APP_URL}/reset-password?token=${rawToken}`
  console.log(`[DEV] Password reset URL for ${email}: ${resetUrl}`)
  // await sendEmail({ to: email, subject: 'Reset your Puja Samargi password', resetUrl })

  return res.status(200).json({
    success: true,
    message: 'If an account with that email exists, a password reset link has been sent.',
  })
}

// =============================================================================
// POST /auth/reset-password
// =============================================================================
const resetPassword = async (req, res) => {
  if (!validate(req, res)) return

  const { token, password } = req.body

  // Look up hashed token in password_resets (must be unused)
  const { data: record, error } = await supabase
    .from('password_resets')
    .select('*')
    .eq('token', sha256(token))
    .is('used_at', null)
    .maybeSingle()

  if (error || !record) {
    return res.status(400).json({ success: false, message: 'Reset link is invalid or has already been used.' })
  }

  if (new Date(record.expires_at) < new Date()) {
    return res.status(400).json({
      success: false,
      message: 'Reset link has expired. Please request a new one.',
    })
  }

  // Hash new password
  const password_hash = await bcrypt.hash(password, 12)

  // Update password on profile
  await supabase
    .from('profiles')
    .update({ password_hash })
    .eq('id', record.user_id)

  // Mark token as used (used_at column exists in your schema)
  await supabase
    .from('password_resets')
    .update({ used_at: new Date() })
    .eq('id', record.id)

  // Invalidate all active sessions for security
  await supabase.from('refresh_tokens').delete().eq('user_id', record.user_id)

  return res.status(200).json({
    success: true,
    message: 'Password reset successfully. Please log in with your new password.',
  })
}

// =============================================================================
// GET /auth/me  (protected — requires authenticate middleware)
// =============================================================================
const getMe = async (req, res) => {
  const userId = req.user?.sub

  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized.' })
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, display_name, email, avatar_url, phone, role, is_email_verified, is_active, created_at')
    .eq('id', userId)
    .maybeSingle()

  if (error || !profile) {
    return res.status(404).json({ success: false, message: 'User not found.' })
  }

  return res.status(200).json({ success: true, user: safeProfile(profile) })
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  verifyEmail,
  checkCredentials,
  resendVerification,
  forgotPassword,
  resetPassword,
  getMe,
}