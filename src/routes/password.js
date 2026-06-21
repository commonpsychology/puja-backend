const express = require('express')
const { authenticate } = require('../middleware/auth')

const {
  updatePassword,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPasswordWithToken,
} = require('./controllers/passwordController')

const router = express.Router()

// 🔓 Public — forgot-password flow (profiles is not logged in)
router.post('/forgot/request-otp', requestPasswordResetOtp)
router.post('/forgot/verify-otp', verifyPasswordResetOtp)
router.post('/forgot/reset', resetPasswordWithToken)

// 🔐 Authenticated — change password while logged in
router.patch('/update', authenticate, updatePassword)

module.exports = router