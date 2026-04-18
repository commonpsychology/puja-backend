const express = require('express')
const router = express.Router()
const { getPublicSocialWorkPrograms } = require('./controllers/adminController')

router.get('/', getPublicSocialWorkPrograms)

module.exports = router