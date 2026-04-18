// useSiteStats.js
// Drop this in src/hooks/ or src/context/
// Fetches public site settings (including hero stats) once on mount.
// Usage in Hero.jsx:
//   const stats = useSiteStats()
//   stats.clients  → "500"
//   stats.rating   → "4.9"

import { useState, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

const DEFAULTS = {
  clients:    '500',
  therapists: '12',
  rating:     '4.9',
  families:   '500',
  pillRating: '4.9',
}

let _cache = null   // module-level cache so multiple components share one fetch

export function useSiteStats() {
  const [stats, setStats] = useState(_cache || DEFAULTS)

  useEffect(() => {
    if (_cache) return   // already loaded
    ;(async () => {
      try {
        // Endpoint: GET /api/settings/public  →  { settings: [{key,value}, ...] }
        // Alternatively reuse /api/settings if public — just filter hero_* keys client-side.
        const res = await fetch(`${API_BASE}/settings/public`)
        if (!res.ok) return
        const data = await res.json()
        const list = data.settings || data.data || []

        const map = {}
        list.forEach(s => { map[s.key] = String(s.value ?? '') })

        const parsed = {
          clients:    map.hero_clients_count    || DEFAULTS.clients,
          therapists: map.hero_therapists_count || DEFAULTS.therapists,
          rating:     map.hero_rating           || DEFAULTS.rating,
          families:   map.hero_families_count   || DEFAULTS.families,
          pillRating: map.hero_pill_rating      || DEFAULTS.pillRating,
        }
        _cache = parsed
        setStats(parsed)
      } catch {
        // silently fall back to defaults — hero still renders
      }
    })()
  }, [])

  return stats
}