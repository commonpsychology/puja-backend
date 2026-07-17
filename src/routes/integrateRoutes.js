const express = require('express')
const { createIntegration, listIntegrations } = require('./controllers/integrateController')

const router = express.Router()

router.post('/', createIntegration)
router.get('/', listIntegrations)

module.exports = router