const express = require('express')
const router = express.Router()
const ctrl = require('../controllers/adminOrderDeliveryController')
const { authenticate, requireAdmin } = require('../middleware/auth')

router.use(authenticate, requireAdmin)
router.put('/:id/assign-rider', ctrl.assignRider)

module.exports = router