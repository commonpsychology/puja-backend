// src/routes/controllers/profile.controller.js
const { createClient } = require('@supabase/supabase-js')
const bcrypt           = require('bcryptjs')
const multer           = require('multer')

// Service role key — backend only, never exposed to frontend
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Multer — store file in memory so we can pass buffer to Supabase
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only JPG, PNG or WEBP allowed.'))
  },
})

const avatarUploadMiddleware = upload.single('avatar')

// GET /api/profile
async function getProfile(req, res) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single()
    if (error) throw error
    res.json({ user: data })
  } catch (err) {
    console.error('getProfile error:', err)
    res.status(500).json({ message: err.message || 'Could not fetch profile.' })
  }
}

// PUT /api/profile
async function updateProfile(req, res) {
  try {
    const { full_name, phone, date_of_birth, gender, address, city, bio, language, emergency_contact } = req.body
    const { data, error } = await supabase
      .from('profiles')
      .update({ full_name, phone, gender, address, city, bio, language, emergency_contact, date_of_birth: date_of_birth || null, updated_at: new Date().toISOString() })
      .eq('id', req.user.id)
      .select()
      .single()
    if (error) throw error
    res.json({ user: data })
  } catch (err) {
    console.error('updateProfile error:', err)
    res.status(500).json({ message: err.message || 'Could not update profile.' })
  }
}

// POST /api/profile/avatar — accepts multipart/form-data field "avatar"
async function updateAvatar(req, res) {
  avatarUploadMiddleware(req, res, async (multerErr) => {
    if (multerErr) return res.status(400).json({ message: multerErr.message || 'File upload error.' })
    if (!req.file)  return res.status(400).json({ message: 'No file uploaded. Send file as field "avatar".' })

    try {
      const userId   = req.user.id
      const ext      = req.file.mimetype.split('/')[1].replace('jpeg', 'jpg')
      const filePath = `${userId}/avatar.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, req.file.buffer, { upsert: true, contentType: req.file.mimetype })

      if (uploadError) throw new Error(uploadError.message)

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath)
      const avatarUrl = urlData.publicUrl

      const { error: dbError } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
        .eq('id', userId)

      if (dbError) throw new Error(dbError.message)

      res.json({ avatar_url: avatarUrl, message: 'Avatar updated.' })
    } catch (err) {
      console.error('updateAvatar error:', err)
      res.status(500).json({ message: err.message || 'Could not update avatar.' })
    }
  })
}

// POST /api/profile/change-password
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Both fields are required.' })
    if (newPassword.length < 8)           return res.status(400).json({ message: 'Minimum 8 characters.' })

    const { data: userData, error: userError } = await supabase
      .from('users')           // ← change to your users table name
      .select('password_hash') // ← change to your password column name
      .eq('id', req.user.id)
      .single()

    if (userError) throw userError

    const match = await bcrypt.compare(currentPassword, userData.password_hash)
    if (!match) return res.status(400).json({ message: 'Current password is incorrect.' })

    const hashed = await bcrypt.hash(newPassword, 12)
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: hashed })
      .eq('id', req.user.id)

    if (updateError) throw updateError
    res.json({ message: 'Password changed successfully.' })
  } catch (err) {
    console.error('changePassword error:', err)
    res.status(500).json({ message: err.message || 'Could not change password.' })
  }
}

module.exports = { getProfile, updateProfile, updateAvatar, changePassword }