// src/controllers/adminNewsController.js
const supabase = require('../../db/supabase')

const ADMIN_FIELDS = `
  id, slug, headline, summary, content, author, author_role, author_emoji,
  read_time, tag, size, image_url, image_gradient, image_emoji,
  is_featured, is_published, views, published_at, created_at, updated_at,
  category_id,
  news_categories ( id, name, slug )
`

const slugify = (str = '') =>
  str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

// ── News Articles ──────────────────────────────────────────────
async function listNews(req, res) {
  try {
    const page        = Math.max(1, parseInt(req.query.page)  || 1)
    const limit        = Math.min(100, parseInt(req.query.limit) || 20)
    const offset        = (page - 1) * limit
    const search        = (req.query.search || '').trim()
    const category_id  = (req.query.category_id || '').trim()

    let query = supabase
      .from('news_articles')
      .select(ADMIN_FIELDS, { count: 'exact' })
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (search)      query = query.or(`headline.ilike.%${search}%,summary.ilike.%${search}%,author.ilike.%${search}%`)
    if (category_id) query = query.eq('category_id', category_id)

    const { data, error, count } = await query
    if (error) throw error

    res.json({ success: true, items: data || [], news: data || [], pagination: { total: count || 0, page, limit } })
  } catch (err) {
    console.error('[admin/news list]', err.message)
    res.status(500).json({ success: false, message: 'Failed to fetch news articles' })
  }
}

async function createNews(req, res) {
  try {
    const b = req.body
    if (!b.headline?.trim()) return res.status(400).json({ success: false, message: 'Headline is required' })

    const payload = {
      headline:       b.headline,
      slug:           b.slug?.trim() || slugify(b.headline),
      summary:        b.summary || '',
      content:        b.content || '',
      author:         b.author || '',
      author_role:    b.author_role || '',
      author_emoji:   b.author_emoji || '✍️',
      category_id:    b.category_id || null,
      tag:            b.tag || '',
      read_time:      b.read_time || '5 min read',
      size:           b.size || 'medium',
      image_url:      b.image_url || null,
      image_gradient: b.image_gradient || null,
      image_emoji:    b.image_emoji || '📰',
      is_featured:    !!b.is_featured,
      is_published:   b.is_published !== false,
      published_at:   b.published_at ? new Date(b.published_at).toISOString() : new Date().toISOString(),
    }

    const { data, error } = await supabase.from('news_articles').insert(payload).select().single()
    if (error) throw error
    res.status(201).json({ success: true, article: data })
  } catch (err) {
    console.error('[admin/news create]', err.message)
    res.status(500).json({ success: false, message: err.message || 'Failed to create article' })
  }
}

async function updateNews(req, res) {
  try {
    const { id } = req.params
    const b = req.body
    const payload = {}
    const fields = ['headline','slug','summary','content','author','author_role','author_emoji',
      'category_id','tag','read_time','size','image_url','image_gradient','image_emoji',
      'is_featured','is_published']
    fields.forEach(f => { if (b[f] !== undefined) payload[f] = b[f] })
    if (b.published_at) payload.published_at = new Date(b.published_at).toISOString()
    payload.updated_at = new Date().toISOString()

    const { data, error } = await supabase.from('news_articles').update(payload).eq('id', id).select().single()
    if (error) throw error
    res.json({ success: true, article: data })
  } catch (err) {
    console.error('[admin/news update]', err.message)
    res.status(500).json({ success: false, message: err.message || 'Failed to update article' })
  }
}

async function deleteNews(req, res) {
  try {
    const { error } = await supabase.from('news_articles').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    console.error('[admin/news delete]', err.message)
    res.status(500).json({ success: false, message: 'Failed to delete article' })
  }
}

// ── Categories (bonus — lets admin manage the dropdown too) ─────
async function listCategoriesAdmin(req, res) {
  try {
    const { data, error } = await supabase.from('news_categories').select('*').order('sort_order', { ascending: true })
    if (error) throw error
    res.json({ success: true, categories: data || [] })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch categories' })
  }
}
async function createCategory(req, res) {
  try {
    const b = req.body
    if (!b.name?.trim()) return res.status(400).json({ success: false, message: 'Name is required' })
    const payload = { name: b.name, slug: b.slug?.trim() || slugify(b.name), sort_order: Number(b.sort_order) || 0, is_active: b.is_active !== false }
    const { data, error } = await supabase.from('news_categories').insert(payload).select().single()
    if (error) throw error
    res.status(201).json({ success: true, category: data })
  } catch (err) { res.status(500).json({ success: false, message: err.message }) }
}
async function updateCategory(req, res) {
  try {
    const { id } = req.params
    const payload = {}
    ;['name','slug','sort_order','is_active'].forEach(f => { if (req.body[f] !== undefined) payload[f] = req.body[f] })
    const { data, error } = await supabase.from('news_categories').update(payload).eq('id', id).select().single()
    if (error) throw error
    res.json({ success: true, category: data })
  } catch (err) { res.status(500).json({ success: false, message: err.message }) }
}
async function deleteCategory(req, res) {
  try {
    const { id } = req.params
    await supabase.from('news_articles').update({ category_id: null }).eq('category_id', id)
    const { error } = await supabase.from('news_categories').delete().eq('id', id)
    if (error) throw error
    res.json({ success: true })
  } catch (err) { res.status(500).json({ success: false, message: err.message }) }
}

// ── Newsletter subscribers ───────────────────────────────────────
async function listSubscribers(req, res) {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1)
    const limit  = Math.min(100, parseInt(req.query.limit) || 50)
    const offset = (page - 1) * limit
    const search = (req.query.search || '').trim()

    let query = supabase
      .from('newsletter_subscribers')
      .select('*', { count: 'exact' })
      .order('subscribed_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (search) query = query.ilike('email', `%${search}%`)

    const { data, error, count } = await query
    if (error) throw error
    res.json({ success: true, items: data || [], subscribers: data || [], pagination: { total: count || 0, page, limit } })
  } catch (err) {
    console.error('[admin/newsletter-subscribers]', err.message)
    res.status(500).json({ success: false, message: 'Failed to fetch subscribers' })
  }
}
async function deleteSubscriber(req, res) {
  try {
    const { error } = await supabase.from('newsletter_subscribers').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to remove subscriber' })
  }
}

module.exports = {
  listNews, createNews, updateNews, deleteNews,
  listCategoriesAdmin, createCategory, updateCategory, deleteCategory,
  listSubscribers, deleteSubscriber,
}