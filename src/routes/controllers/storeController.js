/* eslint-disable no-undef */
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Categories ────────────────────────────────────────────────
const listCategories = async (req, res) => {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, slug, description, image_url, parent_id, sort_order')
    .eq('is_active', true)
    .order('sort_order')

  if (error) return res.status(500).json({ success: false, message: 'Could not fetch categories.' })
  return res.status(200).json({ success: true, categories: data })
}

// ── Products ──────────────────────────────────────────────────
const listProducts = async (req, res) => {
  const { page = 1, limit = 12, category, featured, q } = req.query
  const offset = (page - 1) * limit

  let query = supabase
    .from('products')
    .select(
      'id, name, slug, short_description, price, sale_price, images, is_featured, is_digital, tags, category_id, stock_quantity',
      { count: 'exact' }
    )
    .eq('is_active', true)
    .range(offset, offset + Number(limit) - 1)
    .order('created_at', { ascending: false })

  if (category) query = query.eq('category_id', category)
  if (featured) query = query.eq('is_featured', true)
  if (q)        query = query.ilike('name', `%${q}%`)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ success: false, message: 'Could not fetch products.' })

  return res.status(200).json({
    success: true,
    products: data,
    pagination: { page: Number(page), limit: Number(limit), total: count },
  })
}

const getProduct = async (req, res) => {
  const { id } = req.params
  const { data, error } = await supabase
    .from('products')
    .select('*, product_variants(*), categories:category_id(name, slug)')
    .eq('is_active', true)
    .or(`id.eq.${id},slug.eq.${id}`)
    .maybeSingle()

  if (error || !data) return res.status(404).json({ success: false, message: 'Product not found.' })
  return res.status(200).json({ success: true, product: data })
}

// ── Cart ──────────────────────────────────────────────────────
const getCart = async (req, res) => {
  const { data, error } = await supabase
    .from('cart_items')
    .select(`
      id, quantity, added_at,
      products:product_id ( id, name, price, sale_price, images, stock_quantity ),
      product_variants:variant_id ( id, name, price )
    `)
    .eq('user_id', req.user.sub)

  if (error) return res.status(500).json({ success: false, message: 'Could not fetch cart.' })
  return res.status(200).json({ success: true, cart: data })
}

const addToCart = async (req, res) => {
  const { productId, variantId = null, quantity = 1 } = req.body
  if (!productId) return res.status(400).json({ success: false, message: 'productId is required.' })

  const { data: existing } = await supabase
    .from('cart_items')
    .select('id, quantity')
    .eq('user_id', req.user.sub)
    .eq('product_id', productId)
    .eq('variant_id', variantId)
    .maybeSingle()

  if (existing) {
    const { data, error } = await supabase
      .from('cart_items')
      .update({ quantity: existing.quantity + quantity })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) return res.status(500).json({ success: false, message: 'Could not update cart.' })
    return res.status(200).json({ success: true, message: 'Cart updated.', item: data })
  }

  const { data, error } = await supabase
    .from('cart_items')
    .insert({ user_id: req.user.sub, product_id: productId, variant_id: variantId, quantity })
    .select()
    .single()

  if (error) return res.status(500).json({ success: false, message: 'Could not add to cart.' })
  return res.status(201).json({ success: true, message: 'Added to cart.', item: data })
}

const updateCartItem = async (req, res) => {
  const { quantity } = req.body
  if (!quantity || quantity < 1)
    return res.status(400).json({ success: false, message: 'quantity must be at least 1.' })

  const { data, error } = await supabase
    .from('cart_items')
    .update({ quantity })
    .eq('user_id', req.user.sub)
    .eq('product_id', req.params.productId)
    .select()
    .single()

  if (error || !data) return res.status(404).json({ success: false, message: 'Cart item not found.' })
  return res.status(200).json({ success: true, item: data })
}

const removeFromCart = async (req, res) => {
  await supabase
    .from('cart_items')
    .delete()
    .eq('user_id', req.user.sub)
    .eq('product_id', req.params.productId)

  return res.status(200).json({ success: true, message: 'Item removed from cart.' })
}

const clearCart = async (req, res) => {
  await supabase.from('cart_items').delete().eq('user_id', req.user.sub)
  return res.status(200).json({ success: true, message: 'Cart cleared.' })
}

// ── Wishlist ──────────────────────────────────────────────────
const getWishlist = async (req, res) => {
  const { data, error } = await supabase
    .from('wishlists')
    .select('products:product_id ( id, name, slug, price, sale_price, images )')
    .eq('user_id', req.user.sub)

  if (error) return res.status(500).json({ success: false, message: 'Could not fetch wishlist.' })
  return res.status(200).json({ success: true, wishlist: data.map(w => w.products) })
}

const addToWishlist = async (req, res) => {
  const { productId } = req.body
  if (!productId) return res.status(400).json({ success: false, message: 'productId is required.' })

  const { error } = await supabase
    .from('wishlists')
    .upsert({ user_id: req.user.sub, product_id: productId }, { onConflict: 'user_id,product_id' })

  if (error) return res.status(500).json({ success: false, message: 'Could not add to wishlist.' })
  return res.status(200).json({ success: true, message: 'Added to wishlist.' })
}

const removeFromWishlist = async (req, res) => {
  await supabase
    .from('wishlists')
    .delete()
    .eq('user_id', req.user.sub)
    .eq('product_id', req.params.productId)

  return res.status(200).json({ success: true, message: 'Removed from wishlist.' })
}

// ── Orders ────────────────────────────────────────────────────
const listOrders = async (req, res) => {
  const { page = 1, limit = 10 } = req.query
  const offset = (page - 1) * limit

  const { data, error, count } = await supabase
    .from('orders')
    .select('id, order_number, status, total_amount, created_at', { count: 'exact' })
    .eq('client_id', req.user.sub)
    .order('created_at', { ascending: false })
    .range(offset, offset + Number(limit) - 1)

  if (error) return res.status(500).json({ success: false, message: 'Could not fetch orders.' })
  return res.status(200).json({
    success: true,
    orders: data,
    pagination: { page: Number(page), limit: Number(limit), total: count },
  })
}

const getOrder = async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*, products:product_id(name, images))')
    .eq('id', req.params.id)
    .eq('client_id', req.user.sub)
    .maybeSingle()

  if (error || !data) return res.status(404).json({ success: false, message: 'Order not found.' })
  return res.status(200).json({ success: true, order: data })
}
const createOrder = async (req, res) => {
  console.log('createOrder called, user:', req.user?.sub)
  
 const { shippingAddress, billingAddress, notes, couponCode } = req.body

if (!shippingAddress || !shippingAddress.full_name || !shippingAddress.phone || !shippingAddress.address_line || !shippingAddress.city) {
  return res.status(400).json({ success: false, message: 'A complete delivery address is required.' })
}

  const { data: cartItems, error: cartError } = await supabase
    .from('cart_items')
    .select(`
      quantity,
      products:product_id ( id, name, price, sale_price, stock_quantity ),
      product_variants:variant_id ( id, price )
    `)
    .eq('user_id', req.user.sub)

  console.log('cartItems:', cartItems, 'cartError:', cartError)

  if (cartError || !cartItems?.length)
    return res.status(400).json({ success: false, message: 'Your cart is empty.' })

  let subtotal = 0
  const lineItems = cartItems.map(item => {
    const unitPrice  = item.product_variants?.price ?? item.products.sale_price ?? item.products.price
    const totalPrice = unitPrice * item.quantity
    subtotal += totalPrice
    return {
      product_id:  item.products.id,
      variant_id:  item.product_variants?.id || null,
      quantity:    item.quantity,
      unit_price:  unitPrice,
      total_price: totalPrice,
    }
  })

  const taxAmount   = Math.round(subtotal * 0.13 * 100) / 100
  const totalAmount = subtotal + taxAmount

  const insertPayload = {
    client_id:        req.user.sub,
    order_number:     `ORD-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`,
    status:           'pending',
    subtotal,
    tax_amount:       taxAmount,
    total_amount:     totalAmount,
    shipping_address: shippingAddress,
    billing_address:  billingAddress,
    coupon_code:      couponCode || null,
    notes:            notes || null,
  }
  console.log('inserting order:', insertPayload)

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert(insertPayload)
    .select()
    .single()

  console.log('order result:', order, 'orderError:', orderError)

  if (orderError)
    return res.status(500).json({ success: false, message: orderError.message, details: orderError })

  const { error: itemsError } = await supabase
    .from('order_items')
    .insert(lineItems.map(item => ({ ...item, order_id: order.id })))

  console.log('itemsError:', itemsError)

  if (itemsError)
    return res.status(500).json({ success: false, message: itemsError.message, details: itemsError })

  return res.status(201).json({ success: true, message: 'Order created.', order })
}

module.exports = {
  listCategories,
  listProducts,
  getProduct,
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  listOrders,
  getOrder,
  createOrder,
}