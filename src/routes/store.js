// routes/store.js
const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/storeController')
const { authenticate } = require('../middleware/auth') // adjust path to your existing auth middleware

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


// ============================================================
// routes/adminProducts.js
// ============================================================
const express2 = require('express')
const router2  = express2.Router()
const multer   = require('multer')
const upload   = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })
const adminCtrl = require('../controllers/adminProductsController')
const { authenticate: auth2, requireAdmin } = require('../middleware/auth')

router2.use(auth2, requireAdmin) // every route below requires admin/staff

router2.get('/products', adminCtrl.list)
router2.post('/products', adminCtrl.create)
router2.put('/products/:id', adminCtrl.update)
router2.delete('/products/:id', adminCtrl.remove)
router2.post('/products/:id/images', upload.array('images', 6), adminCtrl.uploadImages)
router2.delete('/products/:id/images', adminCtrl.removeImage)

router2.get('/product-categories', adminCtrl.listCategories)
router2.post('/product-categories', adminCtrl.createCategory)
router2.put('/product-categories/:id', adminCtrl.updateCategory)
router2.delete('/product-categories/:id', adminCtrl.deleteCategory)

router2.get('/product-reviews', adminCtrl.listReviews)
router2.put('/product-reviews/:id', adminCtrl.setReviewApproval)
router2.delete('/product-reviews/:id', adminCtrl.deleteReview)

module.exports = router2

// ============================================================
// In your main app.js / server.js, mount these:
//
//   const storeRoutes         = require('./routes/store')
//   const adminProductsRoutes = require('./routes/adminProducts')
//   app.use('/api/store', storeRoutes)
//   app.use('/api/admin', adminProductsRoutes)
//
// (adminProductsRoutes uses paths like /products, /product-categories,
//  /product-reviews — these live alongside your other /api/admin/* routes.)
// ============================================================