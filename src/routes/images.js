// ============================================================
// routes/images.js  —  Puja Samargi Image Asset Route
// Mount in app.js: app.use('/api/images', require('./routes/images'))
// ============================================================

const express  = require('express')
const router   = express.Router()
const path     = require('path')
const fs       = require('fs')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Helper: check if a local file exists in /public/images ───
function localImageExists(relPath) {
  const fullPath = path.join(__dirname, '..', 'public', relPath)
  return fs.existsSync(fullPath)
}

// ── Helper: build resolved URL for an image entry ────────────
// Priority order:
//   1. Supabase Storage public URL  (if bucket + path configured)
//   2. Local /public/images path    (if file exists on disk)
//   3. Unsplash placeholder         (always available, no signup)
//   4. ui-avatars API               (for therapist portraits only)
function resolveImageUrl(entry) {
  // 1. If a Supabase storage_path is set → generate public URL
  if (entry.storage_path) {
    const { data } = supabase
      .storage
      .from('gallery-images')
      .getPublicUrl(entry.storage_path)
    if (data?.publicUrl) return data.publicUrl
  }

  // 2. Local file
  if (entry.image_url && localImageExists(entry.image_url)) {
    return entry.image_url
  }

  // 3. Unsplash (free, no API key needed for direct photo links)
  if (entry.unsplash) return entry.unsplash

  // 4. ui-avatars for portraits
  if (entry.fallback) return entry.fallback

  // 5. Final fallback: gradient placeholder via placehold.co
  return `https://placehold.co/600x400/007BA8/ffffff?text=Puja+Samargi`
}

// ── Load the master JSON ──────────────────────────────────────
function loadMasterJson() {
  const jsonPath = path.join(__dirname, '..', 'data', 'images.json')
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
}

// ── GET /api/images ── returns full resolved image map ────────
router.get('/', (req, res) => {
  try {
    const raw = loadMasterJson()

    // Resolve therapist images
    const therapists = {}
    for (const [key, val] of Object.entries(raw.therapists)) {
      therapists[key] = {
        ...val,
        resolved: resolveImageUrl(val)
      }
    }

    // Resolve gallery items
    const galleryItems = raw.gallery.items.map(item => ({
      ...item,
      resolved: resolveImageUrl(item)
    }))

    // Resolve blog posts
    const blogPosts = raw.blog.posts.map(p => ({
      ...p,
      resolved: resolveImageUrl(p)
    }))

    // Resolve social work programs
    const programs = raw.social_work.programs.map(p => ({
      ...p,
      resolved: resolveImageUrl(p)
    }))

    // Resolve course thumbnails
    const courses = raw.courses.thumbnails.map(c => ({
      ...c,
      resolved: resolveImageUrl(c)
    }))

    res.json({
      therapists,
      gallery: {
        items: galleryItems,
        categories: raw.gallery.categories
      },
      blog: {
        posts: blogPosts,
        categories: raw.blog.categories
      },
      social_work: { programs },
      courses
    })
  } catch (err) {
    console.error('[images route]', err)
    res.status(500).json({ error: 'Failed to load image data' })
  }
})

// ── GET /api/images/therapists ────────────────────────────────
router.get('/therapists', (req, res) => {
  const raw = loadMasterJson()
  const result = {}
  for (const [key, val] of Object.entries(raw.therapists)) {
    result[key] = { ...val, resolved: resolveImageUrl(val) }
  }
  res.json(result)
})

// ── GET /api/images/gallery ───────────────────────────────────
router.get('/gallery', (req, res) => {
  const raw = loadMasterJson()
  const { category } = req.query
  let items = raw.gallery.items.map(i => ({ ...i, resolved: resolveImageUrl(i) }))
  if (category && category !== 'All') {
    items = items.filter(i => i.category === category)
  }
  res.json({ items, categories: raw.gallery.categories })
})

// ── GET /api/images/blog ──────────────────────────────────────
router.get('/blog', (req, res) => {
  const raw = loadMasterJson()
  // Build a slug → resolved URL map for quick frontend lookup
  const bySlug = {}
  raw.blog.posts.forEach(p => {
    bySlug[p.slug] = { ...p, resolved: resolveImageUrl(p) }
  })
  res.json({ posts: bySlug, categories: raw.blog.categories })
})

// ── GET /api/images/courses ───────────────────────────────────
router.get('/courses', (req, res) => {
  const raw = loadMasterJson()
  const courses = raw.courses.thumbnails.map(c => ({ ...c, resolved: resolveImageUrl(c) }))
  res.json({ courses })
})

// ── GET /api/images/social-work ──────────────────────────────
router.get('/social-work', (req, res) => {
  const raw = loadMasterJson()
  const programs = raw.social_work.programs.map(p => ({ ...p, resolved: resolveImageUrl(p) }))
  res.json({ programs })
})

module.exports = router