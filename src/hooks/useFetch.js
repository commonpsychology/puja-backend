import { useState, useEffect, useCallback, useRef } from 'react'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

export function useFetch(endpoint, params = {}, deps = []) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  // Stable stringify so object params don't cause infinite loops
  const paramsKey = JSON.stringify(params)

  const buildUrl = useCallback(() => {
    const url = new URL(`${BASE}${endpoint}`, window.location.origin)
    const parsed = JSON.parse(paramsKey)
    Object.entries(parsed).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
    })
    return url.toString()
  }, [endpoint, paramsKey])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(buildUrl())
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        if (json.success) setData(json.data)
        else setError(json.message || 'Unknown error')
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  // deps passed in from outside control re-fetch triggers
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildUrl, ...deps])

  return { data, loading, error }
}

// One-shot imperative fetch for actions (download, etc.)
export async function apiFetch(endpoint, options = {}) {
  const url = `${BASE}${endpoint}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  return res.json()
}