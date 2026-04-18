// src/routes/galleryRoute.js
const express = require('express')
const router  = express.Router()
const ctrl    = require('./controllers/gallery_Controller')  // ← FIXED
const {
  upload,
  submitGalleryPhoto,
  getGallerySubmissions,
  updateGallerySubmission,
  deleteGallerySubmission,
  downloadGallerySubmission,
} = require('./controllers/volunteerGalleryController')
const { protect, isAdmin } = require('../middleware/auth')


// ── Public ─────────────────────────────────────────────────────────────────
router.get('/',            ctrl.getItems)
router.get('/categories',  ctrl.getCategories)   // MUST stay before /:id
router.post('/submit',     upload.single('photo'), submitGalleryPhoto)  // ← THE FIX
router.post('/admin-upload', protect, isAdmin, upload.single('photo'), ctrl.adminUploadItem)
router.get('/:id',         ctrl.getItemById)

// ── Admin — gallery items ───────────────────────────────────────────────────
router.post(  '/',    protect, isAdmin, ctrl.createItem)
router.put(   '/:id', protect, isAdmin, ctrl.updateItem)
router.delete('/:id', protect, isAdmin, ctrl.deleteItem)

// ── Admin — photo submissions ───────────────────────────────────────────────
router.get(   '/submissions',              protect, isAdmin, getGallerySubmissions)
router.patch( '/submissions/:id',          protect, isAdmin, updateGallerySubmission)
router.delete('/submissions/:id',          protect, isAdmin, deleteGallerySubmission)
router.get(   '/submissions/:id/download', protect, isAdmin, downloadGallerySubmission)
router.post('/replace-photo', protect, isAdmin, upload.single('photo'), ctrl.replacePhoto)
module.exports = router