// src/hooks/useImages.js
// ─────────────────────────────────────────────────────────────
// Central image hook for Puja Samargi.
// Gallery data fetched from /api/gallery (Supabase-backed).
// Other assets use Unsplash fallbacks.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

// ── Module-level gallery cache ────────────────────────────────
let _galleryCache   = null
let _galleryPromise = null

async function fetchGallery() {
  if (_galleryCache) return _galleryCache
  if (_galleryPromise) return _galleryPromise

  _galleryPromise = Promise.all([
    fetch(`${API_BASE}/gallery`).then(r => r.json()),
    fetch(`${API_BASE}/gallery/categories`).then(r => r.json()),
  ])
    .then(([itemsRes, catsRes]) => {
      const result = {
        items:      itemsRes.data  || [],
        categories: catsRes.data   || DEFAULT_CATEGORIES,
      }
      _galleryCache   = result
      _galleryPromise = null
      return result
    })
    .catch(err => {
      _galleryPromise = null
      console.warn('[useImages] /api/gallery fetch failed, using fallbacks', err)
      return null
    })

  return _galleryPromise
}

// ── Defaults & fallbacks ──────────────────────────────────────
const DEFAULT_CATEGORIES = [
  'All', 'Events', 'Community Outreach', 'Therapy Spaces',
  'Workshops', 'Team', 'Award & Recognition',
]

const FALLBACK_GALLERY = [
  { id:'fb-0', image_url:'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80', category:'Workshops',            title:'Gallery Item', date_label:'2024', emoji:'📸', cols:1, rows:1, description:'' },
  { id:'fb-1', image_url:'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=600&q=80', category:'Community Outreach',  title:'Gallery Item', date_label:'2024', emoji:'📸', cols:1, rows:1, description:'' },
  { id:'fb-2', image_url:'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=600&q=80', category:'Events',              title:'Gallery Item', date_label:'2024', emoji:'📸', cols:1, rows:1, description:'' },
  { id:'fb-3', image_url:'https://images.unsplash.com/photo-1585421514284-efb74c2b69ba?w=600&q=80', category:'Therapy Spaces',      title:'Gallery Item', date_label:'2024', emoji:'📸', cols:1, rows:1, description:'' },
  { id:'fb-4', image_url:'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=600&q=80', category:'Workshops',            title:'Gallery Item', date_label:'2024', emoji:'📸', cols:1, rows:1, description:'' },
  { id:'fb-5', image_url:'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=600&q=80', category:'Team',                title:'Gallery Item', date_label:'2024', emoji:'📸', cols:1, rows:1, description:'' },
  { id:'fb-6', image_url:'https://images.unsplash.com/photo-1497486751825-1233686d5d80?w=800&q=80', category:'Events',              title:'Gallery Item', date_label:'2024', emoji:'📸', cols:1, rows:1, description:'' },
  { id:'fb-7', image_url:'https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=600&q=80', category:'Team',                title:'Gallery Item', date_label:'2024', emoji:'📸', cols:1, rows:1, description:'' },
  { id:'fb-8', image_url:'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=600&q=80', category:'Events',              title:'Gallery Item', date_label:'2024', emoji:'📸', cols:1, rows:1, description:'' },
  { id:'fb-9', image_url:'https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=600&q=80', category:'Award & Recognition', title:'Gallery Item', date_label:'2024', emoji:'📸', cols:1, rows:1, description:'' },
]

const UNSPLASH_FALLBACKS = {
  therapists: {
    'dr-anita-shrestha':  'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=300&q=80',
    'mr-roshan-karki':    'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=300&q=80',
    'ms-priya-tamang':    'https://images.unsplash.com/photo-1594824476967-48c8b964273f?w=300&q=80',
    'dr-suresh-adhikari': 'https://images.unsplash.com/photo-1537368910025-700350fe46c7?w=300&q=80',
    'ms-deepa-rai':       'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=300&q=80',
    'mr-bikash-thapa':    'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=300&q=80',
  },
  blog: {
    'understanding-anxiety-nepal':  'https://images.unsplash.com/photo-1474631245212-32dc3c8310c6?w=600&q=80',
    'cbt-techniques-beginners':     'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80',
    'depression-more-than-sadness': 'https://images.unsplash.com/photo-1541199249251-f713e6145474?w=600&q=80',
    'mindfulness-for-busy-people':  'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=600&q=80',
    'relationship-communication':   'https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=600&q=80',
    'childhood-trauma-adults':      'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=600&q=80',
    'parenting-anxious-child':      'https://images.unsplash.com/photo-1536640712-4d4c36ff0e4e?w=600&q=80',
    'sleep-mental-health':          'https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?w=600&q=80',
  },
  courses: [
    'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=400&q=80',
    'https://images.unsplash.com/photo-1474631245212-32dc3c8310c6?w=400&q=80',
    'https://images.unsplash.com/photo-1544027993-37dbfe43562a?w=400&q=80',
    'https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?w=400&q=80',
    'https://images.unsplash.com/photo-1497032628192-86f99bcd76bc?w=400&q=80',
    'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&q=80',
  ],
  socialWork: [
    'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=600&q=80',
    'https://images.unsplash.com/photo-1497486751825-1233686d5d80?w=600&q=80',
    'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=600&q=80',
    'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=600&q=80',
    'https://images.unsplash.com/photo-1516307365426-bea591f05011?w=600&q=80',
    'https://images.unsplash.com/photo-1423592707957-3b212afa6733?w=600&q=80',
  ],
}

function nameToSlug(name) {
  return name
    .toLowerCase()
    .replace(/^(dr\.|mr\.|ms\.|mrs\.)\s*/i, m =>
      m.trim().toLowerCase().replace('.', '') + '-'
    )
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

// ─────────────────────────────────────────────────────────────
// THE HOOK
// ─────────────────────────────────────────────────────────────
export function useImages() {
  const [gallery, setGallery] = useState(_galleryCache)
  const [loading, setLoading] = useState(!_galleryCache)

  useEffect(() => {
    if (_galleryCache) { setGallery(_galleryCache); setLoading(false); return }
    setLoading(true)
    fetchGallery().then(d => { setGallery(d); setLoading(false) })
  }, [])

  // ── Gallery items ─────────────────────────────────────────
  // Supabase items use image_url as the photo src.
  // Filtering is done client-side so no extra network request
  // is needed per filter click.
  const getGalleryItems = useCallback((category = 'All') => {
    const items = gallery?.items?.length ? gallery.items : FALLBACK_GALLERY
    return category === 'All'
      ? items
      : items.filter(i => i.category === category)
  }, [gallery])

  // ── Gallery categories ────────────────────────────────────
  const getGalleryCategories = useCallback(() => {
    return gallery?.categories ?? DEFAULT_CATEGORIES
  }, [gallery])

  // ── Therapist image ───────────────────────────────────────
  const getTherapistImage = useCallback((name) => {
    const slug = nameToSlug(name)
    return UNSPLASH_FALLBACKS.therapists[slug]
      || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=007BA8&color=ffffff&size=200&bold=true&font-size=0.38`
  }, [])

  // ── Blog image by slug ────────────────────────────────────
  const getBlogImage = useCallback((slug) => {
    return UNSPLASH_FALLBACKS.blog[slug]
      || 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=600&q=80'
  }, [])

  // ── Blog categories ───────────────────────────────────────
  const getBlogCategories = useCallback(() => {
    return ['All', 'Anxiety', 'Self-Care', 'Depression', 'Mindfulness', 'Relationships', 'Trauma', 'Parenting']
  }, [])

  // ── Course thumbnail by index ─────────────────────────────
  const getCourseImage = useCallback((index) => {
    return UNSPLASH_FALLBACKS.courses[index]
      || 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=400&q=80'
  }, [])

  // ── Social work image by id (1-based) ─────────────────────
  const getSocialWorkImage = useCallback((id) => {
    return UNSPLASH_FALLBACKS.socialWork[id - 1]
      || 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=600&q=80'
  }, [])

  return {
    loading,
    getGalleryItems,
    getGalleryCategories,
    getTherapistImage,
    getBlogImage,
    getBlogCategories,
    getCourseImage,
    getSocialWorkImage,
  }
}

// ─────────────────────────────────────────────────────────────
// SmartImage — graceful image loading with gradient placeholder
// ─────────────────────────────────────────────────────────────
export function SmartImage({
  src, alt = '', fallback, gradient, emoji,
  className, style = {}, imgStyle = {}
}) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => { setFailed(false); setLoaded(false) }, [src])

  if (failed || !src) {
    return (
      <div
        className={className}
        style={{
          background: gradient || fallback || 'linear-gradient(135deg,#007BA8,#00BFFF)',
          display:'flex', alignItems:'center', justifyContent:'center',
          ...style,
        }}
      >
        {emoji && (
          <span style={{ fontSize:'3rem', filter:'drop-shadow(0 4px 12px rgba(0,0,0,0.2))' }}>
            {emoji}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className={className} style={{ position:'relative', overflow:'hidden', ...style }}>
      {!loaded && (
        <div style={{
          position:'absolute', inset:0,
          background: gradient || 'linear-gradient(135deg,#007BA8,#00BFFF)',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          {emoji && <span style={{ fontSize:'3rem', opacity:0.6 }}>{emoji}</span>}
        </div>
      )}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        style={{
          width:'100%', height:'100%', objectFit:'cover',
          opacity: loaded ? 1 : 0,
          transition:'opacity 0.4s ease',
          ...imgStyle,
        }}
      />
    </div>
  )
}