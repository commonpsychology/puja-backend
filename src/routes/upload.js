/* eslint-disable no-undef */
// src/routes/upload.js
// Handles avatar uploads via Supabase Storage
// Add to index.js: app.use('/api/upload', require('./routes/upload'))

const express  = require('express')
const router   = express.Router()
const multer   = require('multer')
const { createClient } = require('@supabase/supabase-js')
const { authenticate } = require('./middleware/auth')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Use memory storage so we can pipe to Supabase
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are allowed.'))
  },
})

// POST /api/upload/avatar
router.post('/avatar', authenticate, upload.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' })

    const userId   = req.user.sub
    const ext      = req.file.mimetype.split('/')[1].replace('jpeg','jpg')
    const fileName = `${userId}-${Date.now()}.${ext}`

    // Upload to Supabase Storage bucket 'avatars'
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      })

    if (uploadError) throw uploadError

    // Get the public URL
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(fileName)

    // Update the profile
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', userId)

    if (updateError) throw updateError

    return res.json({ success: true, avatarUrl: publicUrl })
  } catch (err) {
    next(err)
  }
})

module.exports = router

// ── npm package needed ──────────────────────────────────────
// npm install multer
// Then add to index.js:
// app.use('/api/upload', require('./routes/upload'))