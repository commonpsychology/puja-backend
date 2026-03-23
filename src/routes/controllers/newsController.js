// ============================================================
// src/controllers/newsController.js
// ============================================================
const { supabase } = require('../config/supabase')

// ── SELECT FIELDS (list view — no full content) ───────────────
const LIST_FIELDS = `
  id, headline, slug, summary, author, author_role, author_emoji,
  image_gradient, image_emoji, tag, read_time, size, is_featured,
  published_at, views,
  news_categories ( id, name, slug )
`

// ── SELECT FIELDS (detail view — includes full content) ───────
const DETAIL_FIELDS = `
  id, headline, slug, summary, content, author, author_role, author_emoji,
  image_gradient, image_emoji, tag, read_time, size, is_featured,
  published_at, views,
  news_categories ( id, name, slug )
`

// ── GET /api/news ──────────────────────────────────────────────
// ?category=mental-health  &search=anxiety  &page=1  &limit=10
async function getArticles(req, res) {
  try {
    const { category, search, page = 1, limit = 20 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    let query = supabase
      .from('news_articles')
      .select(LIST_FIELDS, { count: 'exact' })
      .eq('is_published', true)
      .order('published_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    // Filter by category slug
    if (category && category !== 'all') {
      const { data: cat } = await supabase
        .from('news_categories')
        .select('id')
        .eq('slug', category.toLowerCase().replace(' ', '-'))
        .single()
      if (cat) query = query.eq('category_id', cat.id)
    }

    // Full-text search on headline + summary
    if (search) {
      query = query.or(
        `headline.ilike.%${search}%,summary.ilike.%${search}%,author.ilike.%${search}%`
      )
    }

    const { data, error, count } = await query
    if (error) throw error

    res.json({
      articles: data || [],
      total:    count || 0,
      page:     parseInt(page),
      limit:    parseInt(limit),
    })
  } catch (err) {
    console.error('[news/list]', err.message)
    res.status(500).json({ error: 'Failed to fetch articles' })
  }
}

// ── GET /api/news/meta ─────────────────────────────────────────
// Returns categories + topics in one call (for filter bar)
async function getMeta(req, res) {
  try {
    const [catRes, topicRes] = await Promise.all([
      supabase.from('news_categories').select('id, name, slug').eq('is_active', true).order('sort_order'),
      supabase.from('news_topics').select('id, name').eq('is_active', true).order('sort_order'),
    ])
    if (catRes.error)   throw catRes.error
    if (topicRes.error) throw topicRes.error
    res.json({ categories: catRes.data || [], topics: topicRes.data || [] })
  } catch (err) {
    console.error('[news/meta]', err.message)
    res.status(500).json({ error: 'Failed to fetch meta' })
  }
}

// ── GET /api/news/:slug ────────────────────────────────────────
// Returns full article including content; increments views
async function getArticleBySlug(req, res) {
  const { slug } = req.params
  try {
    const { data, error } = await supabase
      .from('news_articles')
      .select(DETAIL_FIELDS)
      .eq('slug', slug)
      .eq('is_published', true)
      .single()

    if (error || !data) return res.status(404).json({ error: 'Article not found' })

    // Increment view count (fire-and-forget)
    supabase
      .from('news_articles')
      .update({ views: (data.views || 0) + 1 })
      .eq('id', data.id)
      .then(() => {})

    res.json({ article: data })
  } catch (err) {
    console.error('[news/:slug]', err.message)
    res.status(500).json({ error: 'Failed to fetch article' })
  }
}

// ── GET /api/news/related/:slug ───────────────────────────────
// Returns 3 articles in same category, excluding current
async function getRelated(req, res) {
  const { slug } = req.params
  try {
    const { data: current } = await supabase
      .from('news_articles')
      .select('id, category_id')
      .eq('slug', slug)
      .single()

    if (!current) return res.json({ articles: [] })

    const { data, error } = await supabase
      .from('news_articles')
      .select(LIST_FIELDS)
      .eq('is_published', true)
      .eq('category_id', current.category_id)
      .neq('id', current.id)
      .order('published_at', { ascending: false })
      .limit(3)

    if (error) throw error
    res.json({ articles: data || [] })
  } catch (err) {
    console.error('[news/related]', err.message)
    res.status(500).json({ error: 'Failed to fetch related articles' })
  }
}

// ── POST /api/news/subscribe ──────────────────────────────────
async function subscribe(req, res) {
  const { email } = req.body
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' })
  }
  try {
    const { error } = await supabase
      .from('newsletter_subscribers')
      .insert({ email: email.toLowerCase().trim() })
    if (error && error.code === '23505') {
      return res.json({ message: 'Already subscribed!' })
    }
    if (error) throw error
    res.json({ message: 'Subscribed successfully!' })
  } catch (err) {
    console.error('[news/subscribe]', err.message)
    res.status(500).json({ error: 'Subscription failed' })
  }
}

module.exports = { getArticles, getMeta, getArticleBySlug, getRelated, subscribe }


// ============================================================
// src/routes/newsRoutes.js  — paste into new file
// ============================================================
/*
const express    = require('express')
const router     = express.Router()
const news       = require('../controllers/newsController')

router.get('/',               news.getArticles)
router.get('/meta',           news.getMeta)
router.get('/related/:slug',  news.getRelated)
router.get('/:slug',          news.getArticleBySlug)
router.post('/subscribe',     news.subscribe)

module.exports = router
*/

// ============================================================
// In your app.js / server.js add:
// ============================================================
/*
const newsRoutes = require('./routes/newsRoutes')
app.use('/api/news', newsRoutes)
*/