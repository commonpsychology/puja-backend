// src/routes/controllers/otpController.mjs
import { sendOTP, verifyOTP } from '../../utils/otpUtils.mjs'

// Extract real IP behind proxies (your server has trust proxy = 1)
function getIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  )
}

// ── POST /api/otp/send ────────────────────────────────────────
// Body: { user_id?, email?, phone?, otp_type, name?, channel? }
export async function handleSendOTP(req, res) {
  try {
    const {
      user_id,
      email,
      phone,
      otp_type,
      name,
      channel = 'email',
    } = req.body

    // Validate required fields
    if (!otp_type) {
      return res.status(400).json({ error: 'otp_type is required.' })
    }

    const validTypes = ['email_verify', 'phone_verify', 'staff_login', 'password_reset']
    if (!validTypes.includes(otp_type)) {
      return res.status(400).json({ error: `otp_type must be one of: ${validTypes.join(', ')}` })
    }

    const validChannels = ['email', 'sms', 'both']
    if (!validChannels.includes(channel)) {
      return res.status(400).json({ error: `channel must be one of: ${validChannels.join(', ')}` })
    }

    if ((channel === 'email' || channel === 'both') && !email) {
      return res.status(400).json({ error: 'email is required for email channel.' })
    }
    if ((channel === 'sms' || channel === 'both') && !phone) {
      return res.status(400).json({ error: 'phone is required for sms channel.' })
    }

    // Validate email format
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' })
    }

    await sendOTP({
      user_id,
      email:      email?.toLowerCase().trim() || null,
      phone:      phone || null,
      otp_type,
      name:       name || 'there',
      channel,
      ip_address: getIP(req),
      user_agent: req.headers['user-agent'] || null,
    })

    return res.status(200).json({
      success: true,
      message: channel === 'both'
        ? 'Verification codes sent to your email and phone.'
        : channel === 'sms'
        ? 'Verification code sent to your phone.'
        : 'Verification code sent to your email.',
    })

  } catch (err) {
    console.error('[OTP Send]', err.message)
    if (err.message.includes('Too many'))  return res.status(429).json({ error: err.message })
    if (err.message.includes('Invalid'))   return res.status(400).json({ error: err.message })
    return res.status(500).json({ error: err.message || 'Failed to send OTP.' })
  }
}

// ── POST /api/otp/verify ──────────────────────────────────────
// Body: { email?, phone?, otp_code, otp_type }
export async function handleVerifyOTP(req, res) {
  try {
    const { email, phone, otp_code, otp_type } = req.body

    if (!otp_code) return res.status(400).json({ error: 'otp_code is required.' })
    if (!otp_type) return res.status(400).json({ error: 'otp_type is required.' })
    if (!email && !phone) return res.status(400).json({ error: 'email or phone is required.' })

    if (!/^\d{6}$/.test(String(otp_code).trim())) {
      return res.status(400).json({ error: 'OTP must be exactly 6 digits.' })
    }

    const result = await verifyOTP({
      email:      email?.toLowerCase().trim() || null,
      phone:      phone || null,
      otp_code,
      otp_type,
      ip_address: getIP(req),
      user_agent: req.headers['user-agent'] || null,
    })

    return res.status(200).json(result)

  } catch (err) {
    console.error('[OTP Verify]', err.message)
    const status = err.message.includes('attempts') ? 429
                 : err.message.includes('expired')  ? 410
                 : 400
    return res.status(status).json({ error: err.message })
  }
}
