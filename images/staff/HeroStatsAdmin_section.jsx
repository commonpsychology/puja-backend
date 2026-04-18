// ══════════════════════════════════════════════════════════════
//  ADD THIS BLOCK to AdminDashboardFull.jsx
//
//  1. ADD 'hero_stats' to SIDEBAR under "System":
//     { id: 'hero_stats', label: 'Hero Stats', icon: '🌟' },
//
//  2. PASTE the <HeroStatsSection /> component below into the file
//     (above the AdminDashboardFull export)
//
//  3. ADD this inside the adm-content div (alongside other {tab === ...} blocks):
//     {tab === 'hero_stats' && <HeroStatsSection />}
// ══════════════════════════════════════════════════════════════

// ─── HERO STATS ADMIN SECTION ──────────────────────────────────
function HeroStatsSection() {
  const DEFAULTS = {
    hero_clients_count:    '500',
    hero_therapists_count: '12',
    hero_rating:           '4.9',
    hero_families_count:   '500',
    hero_pill_rating:      '4.9',
  }

  const [vals,    setVals]    = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [result,  setResult]  = useState(null)

  // Load current values from /admin/settings
  useEffect(() => {
    ;(async () => {
      try {
        const d = await apiFetch('/admin/settings')
        const list = d.settings || d.data || []
        const merged = { ...DEFAULTS }
        list.forEach(s => {
          if (s.key in merged) {
            merged[s.key] = String(s.value ?? merged[s.key])
          }
        })
        setVals(merged)
      } catch (e) {
        console.error('hero stats load:', e)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const fld = key => e => setVals(v => ({ ...v, [key]: e.target.value }))

  const save = async () => {
    setSaving(true)
    setResult(null)
    let ok = 0
    for (const [key, value] of Object.entries(vals)) {
      try {
        // Try PUT first (update existing), fall back to POST (create)
        await apiFetch(`/admin/settings/${key}`, {
          method: 'PUT',
          body: JSON.stringify({ value }),
        }).catch(() =>
          apiFetch('/admin/settings', {
            method: 'POST',
            body: JSON.stringify({ key, value }),
          })
        )
        ok++
      } catch (e) {
        console.error(`Failed saving ${key}:`, e)
      }
    }
    setSaving(false)
    setResult(ok === Object.keys(vals).length
      ? { ok: true,  msg: `✓ All ${ok} stat values saved — frontend will update on next load.` }
      : { ok: false, msg: `⚠ Saved ${ok}/${Object.keys(vals).length} values. Check console for errors.` }
    )
  }

  // Live preview helpers
  const previewClients    = `${vals.hero_clients_count}+`
  const previewTherapists = vals.hero_therapists_count
  const previewRating     = `${vals.hero_rating}★`
  const previewFamilies   = `❤️  ${vals.hero_families_count}+ families healed`
  const previewPillRating = `${vals.hero_pill_rating} ★ rated`

  if (loading) return (
    <p style={{ color: 'var(--slate-lt)', fontSize: '.85rem', padding: '2rem' }}>
      Loading hero stats…
    </p>
  )

  return (
    <div>
      {/* Header */}
      <div className="sec-head">
        <div>
          <h1 className="sec-title">🌟 Hero Stats & Social Proof</h1>
          <p className="sec-sub">
            These numbers appear in the Hero section — counters, stat pills, and the floating badges.
            Changes are saved to <code>site_settings</code> and read by the frontend via{' '}
            <code>useSiteStats()</code>.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => window.location.reload()}>🔄 Reload</button>
      </div>

      {/* ── MAIN STAT NUMBERS ── */}
      <div style={{
        background: 'var(--white)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        padding: '1.5rem',
        marginBottom: '1.25rem',
      }}>
        <div style={{
          fontSize: '.68rem', fontWeight: 800, color: 'var(--slate-lt)',
          textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '1.1rem',
        }}>
          Hero Stats Row (500+ / 12 / 4.9★)
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))',
          gap: '1rem',
        }}>
          {/* Clients */}
          <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', padding: '1rem' }}>
            <div style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--slate-lt)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.5rem' }}>
              Clients Helped
            </div>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
              <input
                className="inp"
                type="number"
                min="0"
                value={vals.hero_clients_count}
                onChange={fld('hero_clients_count')}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: '.78rem', color: 'var(--slate-lt)', fontWeight: 600 }}>+</span>
            </div>
            <div style={{ marginTop: '.55rem' }}>
              <span style={{ fontSize: '.7rem', color: 'var(--slate-lt)', fontWeight: 600 }}>Preview: </span>
              <strong style={{ fontSize: '1.05rem', color: 'var(--teal)' }}>{previewClients}</strong>
            </div>
          </div>

          {/* Therapists */}
          <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', padding: '1rem' }}>
            <div style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--slate-lt)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.5rem' }}>
              Expert Therapists
            </div>
            <input
              className="inp"
              type="number"
              min="0"
              value={vals.hero_therapists_count}
              onChange={fld('hero_therapists_count')}
              style={{ width: '100%' }}
            />
            <div style={{ marginTop: '.55rem' }}>
              <span style={{ fontSize: '.7rem', color: 'var(--slate-lt)', fontWeight: 600 }}>Preview: </span>
              <strong style={{ fontSize: '1.05rem', color: 'var(--teal)' }}>{previewTherapists}</strong>
            </div>
          </div>

          {/* Rating */}
          <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', padding: '1rem' }}>
            <div style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--slate-lt)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.5rem' }}>
              Average Rating
            </div>
            <input
              className="inp"
              type="number"
              min="0"
              max="5"
              step="0.1"
              value={vals.hero_rating}
              onChange={fld('hero_rating')}
              style={{ width: '100%' }}
            />
            <div style={{ marginTop: '.55rem' }}>
              <span style={{ fontSize: '.7rem', color: 'var(--slate-lt)', fontWeight: 600 }}>Preview: </span>
              <strong style={{ fontSize: '1.05rem', color: 'var(--teal)' }}>{previewRating}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* ── PILL / BADGE DISPLAY ── */}
      <div style={{
        background: 'var(--white)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        padding: '1.5rem',
        marginBottom: '1.25rem',
      }}>
        <div style={{
          fontSize: '.68rem', fontWeight: 800, color: 'var(--slate-lt)',
          textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '1.1rem',
        }}>
          Floating Stat Pills (Heart Visual)
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))',
          gap: '1rem',
        }}>
          {/* Families pill */}
          <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', padding: '1rem' }}>
            <div style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--slate-lt)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.5rem' }}>
              "Families Healed" Pill — number
            </div>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
              <input
                className="inp"
                type="number"
                min="0"
                value={vals.hero_families_count}
                onChange={fld('hero_families_count')}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: '.78rem', color: 'var(--slate-lt)', fontWeight: 600 }}>+</span>
            </div>
            <div style={{ marginTop: '.7rem', display: 'inline-flex', alignItems: 'center', padding: '.25rem .8rem', background: 'rgba(255,255,255,0.92)', border: '1.5px solid rgba(0,123,168,0.3)', borderRadius: 100, fontSize: '.72rem', fontWeight: 800, color: '#007BA8' }}>
              {previewFamilies}
            </div>
          </div>

          {/* Rating pill */}
          <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', padding: '1rem' }}>
            <div style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--slate-lt)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.5rem' }}>
              "Rated" Pill — rating number
            </div>
            <input
              className="inp"
              type="number"
              min="0"
              max="5"
              step="0.1"
              value={vals.hero_pill_rating}
              onChange={fld('hero_pill_rating')}
              style={{ width: '100%' }}
            />
            <div style={{ marginTop: '.7rem', display: 'inline-flex', alignItems: 'center', padding: '.25rem .8rem', background: 'rgba(255,255,255,0.92)', border: '1.5px solid rgba(0,123,168,0.3)', borderRadius: 100, fontSize: '.72rem', fontWeight: 800, color: '#007BA8' }}>
              {previewPillRating}
            </div>
          </div>
        </div>
      </div>

      {/* ── SAVE ── */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? '⏳ Saving…' : '💾 Save All Stats to site_settings'}
        </button>
        {result && (
          <div className={`alert ${result.ok ? 'alert-success' : 'alert-error'}`} style={{ flex: 1 }}>
            {result.msg}
          </div>
        )}
      </div>

      {/* ── INFO BOX ── */}
      <div style={{
        marginTop: '1.5rem',
        background: '#e0f7ff',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid rgba(0,123,168,0.2)',
        padding: '1rem 1.25rem',
        fontSize: '.8rem',
        color: '#005a80',
        lineHeight: 1.7,
      }}>
        <strong>How it works:</strong><br />
        Values are stored as <code>site_settings</code> keys. On the frontend, add a{' '}
        <code>useSiteStats()</code> hook (see <code>useSiteStats.js</code> below) that fetches{' '}
        <code>/api/settings/public</code> on mount and returns the parsed values.
        The Hero component reads from that hook instead of hardcoded strings.
        The API should expose <code>hero_*</code> keys publicly (no auth required).
      </div>
    </div>
  )
}
