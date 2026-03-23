/* eslint-disable no-undef */
// src/routes/content.js
// ── Single router serving all public dynamic content ──────────
const express  = require('express')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const router = express.Router()

// ── Gallery ───────────────────────────────────────────────────
// GET /api/content/gallery?category=Events
router.get('/gallery', async (req, res) => {
  const { category } = req.query
  let q = supabase.from('gallery_items').select('*').eq('is_active', true).order('sort_order').order('created_at', { ascending: false })
  if (category && category !== 'All') q = q.eq('category', category)
  const { data, error } = await q
  if (error) return res.status(500).json({ success: false, message: 'Could not fetch gallery.' })
  return res.json({ success: true, items: data })
})

// ── Blog posts ────────────────────────────────────────────────
// GET /api/content/posts?category=Anxiety&q=search&featured=true&page=1&limit=10
router.get('/posts', async (req, res) => {
  const { category, q, featured, page = 1, limit = 20 } = req.query
  const offset = (page - 1) * limit

  let query = supabase
    .from('posts')
    .select('id, title, slug, excerpt, type, cover_image, tags, status, is_featured, views, read_time, author_name, author_role, gradient, published_at, created_at', { count: 'exact' })
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (category && category !== 'All') query = query.contains('tags', [category.toLowerCase()])
  if (featured === 'true') query = query.eq('is_featured', true)
  if (q) query = query.or(`title.ilike.%${q}%,excerpt.ilike.%${q}%`)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ success: false, message: 'Could not fetch posts.' })
  return res.json({ success: true, posts: data, pagination: { page: Number(page), limit: Number(limit), total: count } })
})

// GET /api/content/posts/:slug
router.get('/posts/:slug', async (req, res) => {
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('slug', req.params.slug)
    .eq('status', 'published')
    .maybeSingle()
  if (error || !data) return res.status(404).json({ success: false, message: 'Post not found.' })

  // Increment views
  await supabase.from('posts').update({ views: (data.views || 0) + 1 }).eq('id', data.id)

  return res.json({ success: true, post: data })
})

// ── Research papers ───────────────────────────────────────────
// GET /api/content/research?type=Meta-Analysis&q=depression&sort=year
router.get('/research', async (req, res) => {
  const { type, q, sort = 'year' } = req.query

  let query = supabase
    .from('research_papers')
    .select('*')
    .eq('is_active', true)

  if (type && type !== 'All') query = query.eq('type', type)
  if (q) query = query.or(`title.ilike.%${q}%,abstract.ilike.%${q}%`)

  const orderCol = sort === 'citations' ? 'citations' : sort === 'downloads' ? 'downloads' : 'year'
  query = query.order(orderCol, { ascending: false })

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, message: 'Could not fetch papers.' })
  return res.json({ success: true, papers: data })
})

// ── Workshops ─────────────────────────────────────────────────
// GET /api/content/workshops
router.get('/workshops', async (req, res) => {
  const { data, error } = await supabase
    .from('workshop_events')
    .select('*')
    .eq('is_active', true)
    .order('event_date')
  if (error) return res.status(500).json({ success: false, message: 'Could not fetch workshops.' })
  return res.json({ success: true, workshops: data })
})

// POST /api/content/workshops/:id/register
router.post('/workshops/:id/register', async (req, res) => {
  const { name, email, phone, notes, anonymous = false, method = 'cod', refCode } = req.body

  if (!name || !phone) return res.status(400).json({ success: false, message: 'Name and phone are required.' })

  const { data: ws } = await supabase.from('workshop_events').select('id, seats, booked, is_full').eq('id', req.params.id).maybeSingle()
  if (!ws) return res.status(404).json({ success: false, message: 'Workshop not found.' })
  if (ws.is_full) return res.status(409).json({ success: false, message: 'Workshop is full.' })

  const { data, error } = await supabase.from('workshop_registrations').insert({
    workshop_id: req.params.id, name, email, phone, notes, anonymous, method,
    ref_code: refCode || `PS-WS-${Date.now()}`,
  }).select().single()

  if (error) return res.status(500).json({ success: false, message: 'Could not register.' })

  // Increment booked count
  await supabase.from('workshop_events').update({ booked: (ws.booked || 0) + 1, is_full: (ws.booked + 1) >= ws.seats }).eq('id', req.params.id)

  return res.status(201).json({ success: true, registration: data })
})

// ── Social work programs ──────────────────────────────────────
// GET /api/content/social-programs
router.get('/social-programs', async (req, res) => {
  const { data, error } = await supabase
    .from('social_programs')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
  if (error) return res.status(500).json({ success: false, message: 'Could not fetch programs.' })
  return res.json({ success: true, programs: data })
})

// ── Community groups ──────────────────────────────────────────
// GET /api/content/community-groups
router.get('/community-groups', async (req, res) => {
  const { data, error } = await supabase
    .from('community_groups')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
  if (error) return res.status(500).json({ success: false, message: 'Could not fetch groups.' })
  return res.json({ success: true, groups: data })
})

// POST /api/content/community-groups/:id/join
router.post('/community-groups/:id/join', async (req, res) => {
  const { anonymous = false } = req.body
  const userId = req.user?.sub   // optional — may be anonymous

  if (!userId && !anonymous) {
    return res.status(400).json({ success: false, message: 'Provide user or anonymous=true.' })
  }

  if (userId) {
    await supabase.from('community_memberships').upsert(
      { group_id: req.params.id, user_id: userId, anonymous },
      { onConflict: 'group_id,user_id' }
    )
  }

  // Increment member count
  const { data: grp } = await supabase.from('community_groups').select('member_count').eq('id', req.params.id).maybeSingle()
  if (grp) await supabase.from('community_groups').update({ member_count: (grp.member_count || 0) + 1 }).eq('id', req.params.id)

  return res.json({ success: true, message: 'Joined group.' })
})

// DELETE /api/content/community-groups/:id/leave
router.delete('/community-groups/:id/leave', async (req, res) => {
  const userId = req.user?.sub
  if (userId) {
    await supabase.from('community_memberships').delete().eq('group_id', req.params.id).eq('user_id', userId)
    const { data: grp } = await supabase.from('community_groups').select('member_count').eq('id', req.params.id).maybeSingle()
    if (grp) await supabase.from('community_groups').update({ member_count: Math.max(0, (grp.member_count||0)-1) }).eq('id', req.params.id)
  }
  return res.json({ success: true, message: 'Left group.' })
})

// GET /api/content/community-groups/:id/posts
router.get('/community-groups/:id/posts', async (req, res) => {
  const { data, error } = await supabase
    .from('community_posts')
    .select('id, author_label, content, like_count, reply_count, created_at')
    .eq('group_id', req.params.id)
    .eq('is_approved', true)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return res.status(500).json({ success: false, message: 'Could not fetch posts.' })
  return res.json({ success: true, posts: data })
})

// ── Resources ─────────────────────────────────────────────────
// GET /api/content/resources?category=Anxiety
router.get('/resources', async (req, res) => {
  const { category } = req.query
  let q = supabase.from('resources').select('*').order('created_at', { ascending: false })
  if (category && category !== 'All') q = q.eq('category_id', category)
  const { data, error } = await q
  if (error) return res.status(500).json({ success: false, message: 'Could not fetch resources.' })
  return res.json({ success: true, resources: data })
})

// ── Courses ───────────────────────────────────────────────────
// GET /api/content/courses
router.get('/courses', async (req, res) => {
  const { data, error } = await supabase
    .from('courses')
    .select(`*, therapists:instructor_id(id, profiles:user_id(full_name))`)
    .eq('is_published', true)
    .order('created_at', { ascending: false })
  if (error) return res.status(500).json({ success: false, message: 'Could not fetch courses.' })
  return res.json({ success: true, courses: data })
})

// POST /api/content/courses/:id/enroll
router.post('/courses/:id/enroll', async (req, res) => {
  const { userId, refCode, method = 'cod', paid = false } = req.body
  if (!userId) return res.status(400).json({ success: false, message: 'userId is required.' })

  const { data, error } = await supabase.from('course_enrollments')
    .upsert({ course_id: req.params.id, user_id: userId, ref_code: refCode, method, paid }, { onConflict: 'course_id,user_id' })
    .select().single()

  if (error) return res.status(500).json({ success: false, message: 'Could not enroll.' })
  return res.status(201).json({ success: true, enrollment: data })
})

// ── Ashram / Place bookings ───────────────────────────────────
// POST /api/content/place-bookings
router.post('/place-bookings', async (req, res) => {
  const { clientName, clientPhone, clientEmail, packageId, packageName, packagePrice, bookDate, bookTime, notes, method = 'cod', refCode } = req.body

  if (!clientName || !clientPhone || !packageId || !bookDate || !bookTime) {
    return res.status(400).json({ success: false, message: 'Name, phone, package, date and time are required.' })
  }

  const { data, error } = await supabase.from('place_bookings').insert({
    client_name: clientName, client_phone: clientPhone, client_email: clientEmail,
    package_id: packageId, package_name: packageName, package_price: packagePrice,
    book_date: bookDate, book_time: bookTime, notes, method,
    ref_code: refCode || `PS-PLACE-${Date.now()}`,
    status: 'pending',
  }).select().single()

  if (error) return res.status(500).json({ success: false, message: 'Could not save booking.' })
  return res.status(201).json({ success: true, booking: data })
})

module.exports = router