// server/routes/proxy.js
import express from 'express'
import fetch   from 'node-fetch'

const router = express.Router()

router.get('/proxy/pdf', async (req, res) => {
  const { url } = req.query
  if (!url || !url.startsWith('http')) return res.status(400).send('Bad URL')

  try {
    const upstream = await fetch(decodeURIComponent(url), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!upstream.ok) return res.status(upstream.status).send('Upstream error')

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline')
    // Allow your own origin to embed it
    res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_ORIGIN || '*')
    upstream.body.pipe(res)
  } catch (e) {
    res.status(500).send('Proxy error')
  }
})

export default router