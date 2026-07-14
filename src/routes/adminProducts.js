// routes/adminProducts.js
const express2 = require('express')
const router2  = express2.Router()
const multer   = require('multer')
const upload   = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })
const adminCtrl = require('./controllers/adminProductsController')
const { authenticate: auth2, isAdmin } = require('../middleware/auth')

router2.use(auth2, isAdmin) // every route below requires admin

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