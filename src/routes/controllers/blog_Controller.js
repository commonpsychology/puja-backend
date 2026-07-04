// src/routes/controllers/blog_Controller.js
const supabase = require('../../db/supabase')

// GET /api/blog?category=&search=&page=1&limit=20&featured=true
const getPosts = async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20, featured } = req.query

    let query = supabase
  .from('blog_posts')
  .select(
    'id,slug,title,excerpt,category,author,author_role,read_time,featured,tags,views,gradient,image_url,published_at',
    { count: 'exact' }
  )
  .order('published_at', { ascending: false })

    if (category && category !== 'All') query = query.eq('category', category)
    if (featured === 'true') query = query.eq('featured', true)
    if (search) {
      query = query.or(`title.ilike.%${search}%,excerpt.ilike.%${search}%`)
    }

    const from = (Number(page) - 1) * Number(limit)
    query = query.range(from, from + Number(limit) - 1)

    const { data, error, count } = await query
    if (error) throw error

    res.json({ success: true, data, total: count })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

const getPostBySlug = async (req, res) => {
  try {
    const { slug } = req.params
    const { data, error } = await supabase
      .from('blog_posts')
      .select('*')
      .eq('slug', slug)
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Post not found' })

    // Atomic increment — avoids lost updates from concurrent visits
    const { data: newViews, error: rpcError } = await supabase
      .rpc('increment_blog_views', { post_slug: slug })

    if (rpcError) console.error('Failed to increment blog views:', rpcError.message)

    // Return the count that reflects THIS visit, not the pre-increment snapshot
    res.json({
      success: true,
      data: { ...data, views: rpcError ? (data.views || 0) : newViews },
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET /api/blog/categories
const getCategories = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('blog_posts')
      .select('category')
    if (error) throw error
    const unique = ['All', ...new Set(data.map(r => r.category))]
    res.json({ success: true, data: unique })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// POST /api/blog  (admin)
const createPost = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('blog_posts')
      .insert([req.body])
      .select()
      .single()
    if (error) throw error
    res.status(201).json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// PUT /api/blog/:id  (admin)
const updatePost = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('blog_posts')
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// DELETE /api/blog/:id  (admin)
const deletePost = async (req, res) => {
  try {
    const { error } = await supabase
      .from('blog_posts')
      .delete()
      .eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true, message: 'Post deleted' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

module.exports = {
  getPosts,
  getPostBySlug,
  getCategories,
  createPost,
  updatePost,
  deletePost,
}