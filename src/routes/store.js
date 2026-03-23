const express = require('express')
const { authenticate } = require('../middleware/auth')
const {
  listProducts,
  getProduct,
  listCategories,
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  listOrders,
  getOrder,
  createOrder,
} = require('./controllers/storeController')

const router = express.Router()

// ── Products & Categories (public) ───────────────────────────
router.get('/categories',     listCategories)
router.get('/products',       listProducts)
router.get('/products/:id',   getProduct)

// ── Cart (protected) ─────────────────────────────────────────
router.get('/cart',                authenticate, getCart)
router.post('/cart',               authenticate, addToCart)
router.patch('/cart/:productId',   authenticate, updateCartItem)
router.delete('/cart/:productId',  authenticate, removeFromCart)
router.delete('/cart',             authenticate, clearCart)

// ── Wishlist (protected) ──────────────────────────────────────
router.get('/wishlist',            authenticate, getWishlist)
router.post('/wishlist',           authenticate, addToWishlist)
router.delete('/wishlist/:productId', authenticate, removeFromWishlist)

// ── Orders (protected) ───────────────────────────────────────
router.get('/orders',              authenticate, listOrders)
router.post('/orders',             authenticate, createOrder)
router.get('/orders/:id',          authenticate, getOrder)

module.exports = router