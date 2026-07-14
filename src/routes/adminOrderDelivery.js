const express = require('express')
const router = express.Router()
const ctrl = require('./controllers/adminOrderDeliveryController')
   const { authenticate, isAdmin } = require('../middleware/auth')

router.use(authenticate, isAdmin)
router.put('/:id/assign-rider', ctrl.assignRider)

module.exports = router