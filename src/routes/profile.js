const express = require('express')
const { authenticate } = require('../middleware/auth')
const {
  getProfile,
  updateProfile,
  changePassword,
  uploadAvatar,
  deleteAccount,
} = require('./controllers/profileController')

const router = express.Router()

router.use(authenticate)

router.get('/',               getProfile)
router.put('/',               updateProfile)
router.post('/change-password', changePassword)
router.post('/avatar',        uploadAvatar)
router.delete('/',            deleteAccount)

module.exports = router