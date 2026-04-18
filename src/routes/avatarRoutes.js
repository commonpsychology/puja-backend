// In your profile routes
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

router.post('/avatar', authMiddleware, upload.single('avatar'), async (req, res, next) => {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ message: 'No file provided.' })

    const ext  = require('path').extname(file.originalname).toLowerCase() || '.jpg'
    const path = `avatars/${req.user.id}${ext}`   // one file per user, auto-overwrites

    // Upload to Supabase storage bucket called "avatars" (create it like gallery-submissions)
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true })
    if (upErr) throw upErr

    const { data } = supabase.storage.from('avatars').getPublicUrl(path)

    // Save URL to profiles table
    await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', req.user.id)

    return res.json({ avatar_url: data.publicUrl })
  } catch (err) { next(err) }
})