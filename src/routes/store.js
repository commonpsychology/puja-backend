// routes/store.js
const express = require('express')
const router  = express.Router()
const ctrl    = require('./controllers/storeController')
const { authenticate } = require('../middleware/auth')

// Public browsing
router.get('/categories', ctrl.getCategories)
router.get('/products', ctrl.getProducts)
router.get('/products/:id', ctrl.getProductDetail)
router.get('/products/:id/reviews', ctrl.getProductReviews)

// Requires login
router.post('/products/:id/reviews', authenticate, ctrl.addReview)
router.get('/cart', authenticate, ctrl.getCart)
router.post('/cart', authenticate, ctrl.addToCart)
router.put('/cart/:productId', authenticate, ctrl.updateCartItem)
router.delete('/cart/:productId', authenticate, ctrl.removeCartItem)
router.delete('/cart', authenticate, ctrl.clearCart)

// Orders — list before creating/detail, order doesn't matter here since
// GET and POST on the same path are distinct routes, but keeping /orders
// above /orders/:id for readability
router.get('/orders', authenticate, ctrl.getOrders)
router.post('/orders', authenticate, ctrl.createOrder)
router.get('/orders/:id', authenticate, ctrl.getOrderById)

module.exports = router