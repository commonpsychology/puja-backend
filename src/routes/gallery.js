const express   = require('express')
const router    = express.Router()
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/* ── GET /api/gallery ── */
/* Query params: approved=true, category=therapy, limit=20, offset=0 */
router.get('/', async (req, res) => {
  try {
    const limit    = Math.min(parseInt(req.query.limit)  || 20, 50)
    const offset   = parseInt(req.query.offset) || 0
    const category = req.query.category || null
    const approved = req.query.approved === 'true'

    let query = supabase
      .from('gallery_images')
      .select('id, url, title, category, sort_order, created_at', { count: 'exact' })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (approved) query = query.eq('approved', true)
    if (category) query = query.eq('category', category)

    const { data, error, count } = await query
    if (error) throw error

    res.json({ images: data, total: count, limit, offset })
  } catch (err) {
    console.error('Gallery fetch error:', err)
    res.status(500).json({ error: 'Failed to fetch gallery images' })
  }
})

/* ── POST /api/gallery ── admin upload */
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { url, title, category, sort_order } = req.body
    if (!url) return res.status(400).json({ error: 'url is required' })

    const { data, error } = await supabase
      .from('gallery_images')
      .insert({ url, title, category, sort_order: sort_order || 0, approved: false })
      .select()
      .single()

    if (error) throw error
    res.status(201).json({ image: data })
  } catch (err) {
    console.error('Gallery insert error:', err)
    res.status(500).json({ error: 'Failed to add image' })
  }
})

/* ── PATCH /api/gallery/:id ── admin approve / reorder */
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const { approved, title, category, sort_order } = req.body
    const { data, error } = await supabase
      .from('gallery_images')
      .update({ approved, title, category, sort_order })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json({ image: data })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update image' })
  }
})

/* ── DELETE /api/gallery/:id ── admin delete */
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('gallery_images')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete image' })
  }
})

function requireAdmin(req, res, next) {
  const role = req.user?.role
  if (role === 'admin' || role === 'staff') return next()
  res.status(403).json({ error: 'Forbidden' })
}

module.exports = router