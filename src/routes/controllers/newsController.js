// src/controllers/newsController.js
const supabase = require('../../db/supabase')

const PUBLIC_FIELDS = `
  id, slug, headline, summary, content, author, author_role, author_emoji,
  read_time, tag, size, image_url, image_gradient, image_emoji,
  is_featured, published_at
`

// GET /api/news
async function getNews(req, res) {
  try {
    const page     = Math.max(1, parseInt(req.query.page)  || 1)
    const limit    = Math.min(50, parseInt(req.query.limit) || 20)
    const offset   = (page - 1) * limit
    const category = (req.query.category || '').trim()
    const search   = (req.query.search   || '').trim()

    // !inner is required — without it, filtering an embedded resource
    // does NOT restrict which parent rows are returned.
    const categoriesEmbed = category ? 'news_categories!inner' : 'news_categories'

    let query = supabase
      .from('news_articles')
      .select(`${PUBLIC_FIELDS}, ${categoriesEmbed} ( id, name, slug )`, { count: 'exact' })
      .eq('is_published', true)
      .order('published_at', { ascending: false })

    if (category) query = query.eq('news_categories.slug', category)
    if (search)   query = query.or(`headline.ilike.%${search}%,summary.ilike.%${search}%`)

    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) throw error

    res.json({ success: true, articles: data || [], total: count || 0, page, limit })
  } catch (err) {
    console.error('[news]', err.message)
    res.status(500).json({ success: false, error: 'Failed to fetch articles' })
  }
}

// GET /api/news/meta
async function getNewsMeta(req, res) {
  try {
    const [catRes, topicRes] = await Promise.all([
      supabase.from('news_categories').select('id, name, slug')
        .eq('is_active', true).order('sort_order', { ascending: true }),
      supabase.from('news_topics').select('id, name')
        .eq('is_active', true).order('name', { ascending: true }),
    ])
    if (catRes.error)   throw catRes.error
    if (topicRes.error) throw topicRes.error

    res.json({ success: true, categories: catRes.data || [], topics: topicRes.data || [] })
  } catch (err) {
    console.error('[news/meta]', err.message)
    res.status(500).json({ success: false, error: 'Failed to fetch meta' })
  }
}

// GET /api/news/:slug
async function getNewsBySlug(req, res) {
  const { slug } = req.params
  try {
    const { data, error } = await supabase
      .from('news_articles')
      .select(`${PUBLIC_FIELDS}, news_categories ( name, slug )`)
      .eq('slug', slug)
      .eq('is_published', true)
      .single()

    if (error || !data) return res.status(404).json({ success: false, error: 'Article not found' })

    // fire-and-forget view increment, don't block the response
    supabase.from('news_articles').update({ views: (data.views || 0) + 1 }).eq('slug', slug).then(() => {})

    res.json({ success: true, article: data })
  } catch (err) {
    console.error('[news/:slug]', err.message)
    res.status(500).json({ success: false, error: 'Failed to fetch article' })
  }
}

// POST /api/news/subscribe
async function subscribe(req, res) {
  const { email } = req.body
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'Valid email required' })
  }
  try {
    const { error } = await supabase
      .from('newsletter_subscribers')
      .upsert(
        { email: email.toLowerCase().trim(), is_active: true },
        { onConflict: 'email' }
      )
    if (error) throw error
    res.json({ success: true, message: 'Subscribed successfully' })
  } catch (err) {
    console.error('[news/subscribe]', err.message)
    res.status(500).json({ success: false, error: 'Failed to subscribe' })
  }
}

module.exports = { getNews, getNewsMeta, getNewsBySlug, subscribe }