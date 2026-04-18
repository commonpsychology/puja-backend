// src/routes/profile.route.js
const express = require('express')
const router  = express.Router()
const { authenticate } = require('../middleware/auth')
const {
  getProfile,
  updateProfile,
  updateAvatar,
  changePassword,
} = require('./controllers/profile.controller')

router.get('/',           authenticate, getProfile)
router.put('/',           authenticate, updateProfile)
router.post('/avatar',    authenticate, updateAvatar)
router.post('/change-password', authenticate, changePassword)

module.exports = router