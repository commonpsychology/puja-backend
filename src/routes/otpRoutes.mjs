// src/routes/otpRoutes.mjs
import express   from 'express'
import rateLimit from 'express-rate-limit'
import { handleSendOTP, handleVerifyOTP } from './controllers/otpController.mjs'

const router = express.Router()

// Stricter rate limit specifically for OTP endpoints
// (on top of the global 200/15min limit in index.mjs)
const otpRateLimit = rateLimit({
  windowMs:        10 * 60 * 1000,   // 10 minutes
  max:             10,                // max 10 requests per IP per 10 min
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.ip,
  message:         { error: 'Too many OTP requests from this IP. Please wait 10 minutes.' },
})

const verifyRateLimit = rateLimit({
  windowMs:        15 * 60 * 1000,   // 15 minutes
  max:             20,                // max 20 verify attempts per IP per 15 min
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.ip,
  message:         { error: 'Too many verification attempts from this IP. Please wait 15 minutes.' },
})

// POST /api/otp/send
router.post('/send', otpRateLimit, handleSendOTP)

// POST /api/otp/verify
router.post('/verify', verifyRateLimit, handleVerifyOTP)

export default router
