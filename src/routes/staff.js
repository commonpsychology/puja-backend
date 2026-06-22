const express = require('express')
const { listStaff } = require('./controllers/staffController')

const router = express.Router()

router.get('/', listStaff)

module.exports = router