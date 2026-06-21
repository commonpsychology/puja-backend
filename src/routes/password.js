const express = require('express')
const rateLimit = require('express-rate-limit')

const {
  updatePasswordPublic,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPasswordWithToken,
} = require('./controllers/passwordController')

const router = express.Router()

// Limits guessing attempts against a single email/IP pair. Without this,
// /update and /forgot/verify-otp are brute-forceable since neither requires
// a login token anymore — an attacker can just try passwords/codes.
const guessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 8,                   // 8 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.' },
})

const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 OTP requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
})

// 🔓 Public — forgot-password flow (user is not logged in)
router.post('/forgot/request-otp', otpRequestLimiter, requestPasswordResetOtp)
router.post('/forgot/verify-otp', guessLimiter, verifyPasswordResetOtp)
router.post('/forgot/reset', resetPasswordWithToken)

// 🔓 Public — update password via email + current password (no login required)
router.patch('/update', guessLimiter, updatePasswordPublic)

module.exports = router