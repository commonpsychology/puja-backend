const express = require('express')
const router = express.Router()
const ctrl = require('./controllers/adminDeliveryRidersController')
const { authenticate, requireAdmin } = require('../middleware/auth')

router.use(authenticate, requireAdmin)

router.get('/', ctrl.list)
router.post('/', ctrl.create)
router.put('/:id', ctrl.update)
router.delete('/:id', ctrl.remove)
router.post('/:id/set-password', ctrl.setPassword)

module.exports = router