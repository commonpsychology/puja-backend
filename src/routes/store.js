// routes/store.js
const express = require('express')
const router  = express.Router()
const ctrl    = require('./controllers/storeController')
const { authenticate } = require('../middleware/auth')

// Public browsing
router.get('/categories', ctrl.getCategories)
router.get('/products', ctrl.getProducts)
router.get('/products/:id', ctrl.getProductDetail)

// Requires login
router.post('/products/:id/reviews', authenticate, ctrl.addReview)
router.get('/cart', authenticate, ctrl.getCart)
router.post('/cart', authenticate, ctrl.addToCart)
router.put('/cart/:productId', authenticate, ctrl.updateCartItem)
router.delete('/cart/:productId', authenticate, ctrl.removeCartItem)
router.delete('/cart', authenticate, ctrl.clearCart)
router.post('/orders', authenticate, ctrl.createOrder)

module.exports = router
