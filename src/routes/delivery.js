const express = require('express')
const router = express.Router()
const ctrl = require('./controllers/deliveryController')
const { authenticateRider } = require('../middleware/deliveryAuth')

router.post('/login', ctrl.login)
router.get('/my-orders', authenticateRider, ctrl.myOrders)
router.put('/my-orders/:id', authenticateRider, ctrl.updateMyOrder)

module.exports = router