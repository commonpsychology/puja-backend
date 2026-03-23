/* eslint-disable no-undef */
const express = require('express')
const { body } = require('express-validator')
const rateLimit = require('express-rate-limit')
const {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  getMe,
} = require('./controllers/authController')
const { authenticate } = require('../middleware/auth')

const router = express.Router()

// ── Rate limiters ────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 5,
  message: { success: false, message: 'Too many email requests. Please try again in 1 hour.' },
})

// ── Validation rules ─────────────────────────────────────────
const registerRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required.')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters.'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Please enter a valid email address.')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required.')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
    .matches(/[0-9]/).withMessage('Password must contain at least one number.'),
]

const loginRules = [
  body('email')
    .trim().notEmpty().withMessage('Email is required.').isEmail().normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required.'),
]

const emailOnlyRules = [
  body('email')
    .trim().notEmpty().withMessage('Email is required.').isEmail().normalizeEmail(),
]

const resetPasswordRules = [
  body('token').trim().notEmpty().withMessage('Token is required.'),
  body('password')
    .notEmpty().withMessage('Password is required.')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
    .matches(/[0-9]/).withMessage('Password must contain at least one number.'),
]

// ── Routes ───────────────────────────────────────────────────

// Public
router.post('/register',             authLimiter,  registerRules,      register)
router.post('/login',                authLimiter,  loginRules,         login)
router.post('/refresh',              refresh)
router.post('/logout',               logout)
router.get ('/verify-email',         verifyEmail)
router.post('/resend-verification',  emailLimiter, emailOnlyRules,     resendVerification)
router.post('/forgot-password',      emailLimiter, emailOnlyRules,     forgotPassword)
router.post('/reset-password',       authLimiter,  resetPasswordRules, resetPassword)

// Protected
router.get ('/me',                   authenticate, getMe)
router.post('/logout-all',           authenticate, logoutAll)

module.exports = router