// ── Paste this INSIDE ClientPortalPage.jsx ────────────────────
// 1. Add this CSS string near your other style blocks (or inside a useEffect with injectCSS)
// 2. Replace the {tab === 'Notifications' && (...)} block with the JSX below

/* ─────────────────────────────────────────────────────────────
   STEP 1 — Add this constant near the top of the file
   (alongside TABS, MOODS, CONTACT_INFO etc.)
───────────────────────────────────────────────────────────── */
const NOTIF_CSS = `
  .notif-item { display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border-radius:10px; border:0.5px solid transparent; cursor:pointer; transition:background 0.15s; }
  .notif-item.unread { background:#fff; border-color:var(--blue-pale); }
  .notif-item.read   { background:transparent; }
  .notif-item:hover  { background:var(--off-white); }
  .notif-dot  { width:7px; height:7px; border-radius:50%; margin-top:5px; flex-shrink:0; }
  .notif-icon { width:30px; height:30px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:14px; flex-shrink:0; }
  .notif-title      { font-size:13px; font-weight:700; color:var(--blue-deep); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .notif-item.read .notif-title { color:var(--text-light); font-weight:400; }
  .notif-msg        { font-size:12px; color:var(--text-light); line-height:1.5; margin-top:1px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .notif-time       { font-size:11px; color:#94a3b8; white-space:nowrap; flex-shrink:0; margin-top:3px; }
  .notif-filter-btn { font-size:12px; padding:4px 12px; border-radius:8px; border:1px solid var(--blue-pale); background:transparent; color:var(--text-light); cursor:pointer; transition:all 0.15s; font-family:var(--font-body); }
  .notif-filter-btn.active { background:var(--sky-light); color:var(--sky); border-color:var(--sky); font-weight:700; }
  .notif-section-label { font-size:11px; color:#94a3b8; font-weight:800; text-transform:uppercase; letter-spacing:0.07em; padding:8px 12px 4px; }
  .notif-load-more { width:100%; margin-top:8px; font-size:12px; padding:8px; border-radius:8px; border:1px solid var(--blue-pale); background:transparent; color:var(--text-light); cursor:pointer; font-family:var(--font-body); transition:background 0.15s; }
  .notif-load-more:hover { background:var(--off-white); }
`

// Add injectCSS('notif-css', NOTIF_CSS) inside the useEffect that already
// calls injectCSS for your other styles, or add a dedicated one:
//
// useEffect(() => { injectCSS('notif-css', NOTIF_CSS) }, [])


/* ─────────────────────────────────────────────────────────────
   STEP 2 — Add this state near your other useState declarations
   inside ClientPortalPage()
───────────────────────────────────────────────────────────── */
// const [notifFilter, setNotifFilter] = useState('all')
// const [notifShown,  setNotifShown]  = useState(8)


/* ─────────────────────────────────────────────────────────────
   STEP 3 — Replace {tab === 'Notifications' && (...)} with this
───────────────────────────────────────────────────────────── */

{tab === 'Notifications' && (() => {
  const NOTIF_ICONS = {
    appointment: '📅',
    reminder:    '⏰',
    message:     '💬',
    billing:     '💳',
    wellness:    '🌿',
    system:      '🔔',
  }
  const NOTIF_BG = {
    appointment: 'var(--sky-light)',
    reminder:    '#fff8e6',
    message:     'var(--green-mist)',
    billing:     '#fee2e2',
    wellness:    'var(--green-mist)',
    system:      'var(--off-white)',
  }

  const typeOf = n => n.type || 'system'

  const FILTERS = [
    { key: 'all',         label: 'All' },
    { key: 'unread',      label: 'Unread' },
    { key: 'appointment', label: 'Appointments' },
    { key: 'message',     label: 'Messages' },
    { key: 'system',      label: 'System' },
  ]

  const filtered = notifFilter === 'all'
    ? notifs
    : notifFilter === 'unread'
    ? notifs.filter(n => !n.is_read)
    : notifs.filter(n => typeOf(n) === notifFilter)

  const visible  = filtered.slice(0, notifShown)
  const hasMore  = filtered.length > notifShown

  const newItems = visible.filter(n => !n.is_read)
  const oldItems = visible.filter(n =>  n.is_read)

  const fmtTime = d => {
    const diff = Date.now() - new Date(d).getTime()
    const mins  = Math.floor(diff / 60000)
    const hours = Math.floor(mins / 60)
    const days  = Math.floor(hours / 24)
    if (mins  <  1) return 'just now'
    if (mins  < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days  <  7) return `${days}d ago`
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div>
      {/* ── Toolbar ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        marginBottom:'1rem', gap:'0.75rem', flexWrap:'wrap' }}>

        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <span style={{ fontFamily:'var(--font-display)', fontSize:'1.15rem', color:'var(--blue-deep)' }}>
            Notifications
          </span>
          {unreadCount > 0 && (
            <span style={{ background:'var(--sky-light)', color:'var(--sky)',
              fontSize:'11px', fontWeight:800, borderRadius:99,
              padding:'2px 8px', border:'1px solid var(--sky)' }}>
              {unreadCount}
            </span>
          )}
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
          {/* Filter pills */}
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
            {FILTERS.map(f => (
              <button key={f.key}
                className={`notif-filter-btn${notifFilter === f.key ? ' active' : ''}`}
                onClick={() => { setNotifFilter(f.key); setNotifShown(8) }}>
                {f.label}
              </button>
            ))}
          </div>
          {unreadCount > 0 && (
            <button onClick={markAllRead}
              style={{ fontSize:'12px', padding:'4px 12px', borderRadius:8,
                border:'1px solid var(--blue-pale)', background:'none',
                color:'var(--text-light)', cursor:'pointer', fontFamily:'var(--font-body)',
                whiteSpace:'nowrap' }}>
              Mark all read
            </button>
          )}
        </div>
      </div>

      {/* ── List ── */}
      {visible.length === 0 ? (
        <div style={{ textAlign:'center', padding:'3rem 1rem',
          color:'var(--text-light)', fontSize:'0.85rem' }}>
          <div style={{ fontSize:'1.8rem', marginBottom:'0.5rem' }}>🔔</div>
          No notifications{notifFilter !== 'all' ? ' in this category' : ''}.
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>

          {/* New */}
          {newItems.length > 0 && (
            <>
              {oldItems.length > 0 && (
                <div className="notif-section-label">New</div>
              )}
              {newItems.map(n => (
                <div key={n.id}
                  className="notif-item unread"
                  onClick={() => markNotifRead(n.id)}>
                  <div className="notif-dot"
                    style={{ background:'var(--sky)' }} />
                  <div className="notif-icon"
                    style={{ background: NOTIF_BG[typeOf(n)] }}>
                    {NOTIF_ICONS[typeOf(n)] ?? '🔔'}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="notif-title">{n.title}</div>
                    {n.message && (
                      <div className="notif-msg">{n.message}</div>
                    )}
                  </div>
                  <div className="notif-time">{fmtTime(n.created_at)}</div>
                </div>
              ))}
            </>
          )}

          {/* Earlier */}
          {oldItems.length > 0 && (
            <>
              {newItems.length > 0 && (
                <div className="notif-section-label">Earlier</div>
              )}
              {oldItems.map(n => (
                <div key={n.id} className="notif-item read">
                  <div className="notif-dot"
                    style={{ background:'transparent', border:'1px solid var(--blue-pale)' }} />
                  <div className="notif-icon"
                    style={{ background:'var(--off-white)' }}>
                    {NOTIF_ICONS[typeOf(n)] ?? '🔔'}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="notif-title">{n.title}</div>
                    {n.message && (
                      <div className="notif-msg">{n.message}</div>
                    )}
                  </div>
                  <div className="notif-time">{fmtTime(n.created_at)}</div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Load more ── */}
      {hasMore && (
        <button className="notif-load-more"
          onClick={() => setNotifShown(s => s + 8)}>
          Show {Math.min(filtered.length - notifShown, 8)} older notifications
        </button>
      )}
    </div>
  )
})()}
