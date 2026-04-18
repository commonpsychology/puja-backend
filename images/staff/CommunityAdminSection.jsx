// src/components/CommunityAdminSection.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Drop-in replacement for the community_admin tab block in AdminDashboardFull.
//
// USAGE in AdminDashboardFull.jsx:
//   1. Import this at the top:
//        import CommunityAdminSection from '../components/CommunityAdminSection'
//
//   2. Replace the entire {tab === 'community_admin' && ( ... )} block with:
//        {tab === 'community_admin' && (
//          <CommunityAdminSection
//            // ── data already in AdminDashboardFull state ──
//            commGroups={commGroups}          commSessions={commSessions}
//            commReservations={commReservations}  commMemberships={commMemberships}
//            commSessionsTotal={commSessionsTotal}  commSessionPage={commSessionPage}
//            setCommSessionPage={setCommSessionPage}
//            commTab={commTab}  setCommTab={setCommTab}
//            selectedSessionId={selectedSessionId}
//            sessionModal={sessionModal}  setSessionModal={setSessionModal}
//            sessionForm={sessionForm}    setSessionForm={setSessionForm}
//            sessionSaving={sessionSaving} sessionErr={sessionErr}
//            // ── functions already in AdminDashboardFull ──
//            fetchCommGroups={fetchCommGroups}
//            fetchCommSessions={fetchCommSessions}
//            fetchCommReservations={fetchCommReservations}
//            fetchCommMemberships={fetchCommMemberships}
//            saveSessionModal={saveSessionModal}
//            openEdit={openEdit}
//            setDelConfirm={setDelConfirm}
//            apiFetch={apiFetch}
//            fmt={fmt}  fmtT={fmtT}
//            inpSx={inpSx}  selSx={selSx}
//          />
//        )}
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useCallback } from 'react'

const C = {
  green:'#1a7a4a', greenFaint:'#e8f8f0',
  amber:'#8a5a1a', amberFaint:'#fff5e6',
  red:'#c0392b',   redFaint:'#fff0f0',
  sky:'#007BA8',   skyFaint:'#E0F7FF', skyFainter:'#F0FBFF',
  border:'#e2e8f0', slate:'#1a3a4a', slateLt:'#7a9aaa',
}

const PAY_STATUS_MAP = {
  paid:     { bg: C.greenFaint, c: C.green,   label: '✓ Paid'     },
  pending:  { bg: C.amberFaint, c: C.amber,   label: '⏳ Pending'  },
  failed:   { bg: C.redFaint,   c: C.red,     label: '✗ Failed'   },
  free:     { bg: C.skyFaint,   c: C.sky,     label: '🎁 Free'    },
  unpaid:   { bg: '#f0f0f0',    c: '#666',    label: '○ Unpaid'   },
  cash:     { bg: C.amberFaint, c: C.amber,   label: '💵 Cash'    },
}

function PayBadge({ status }) {
  const v = PAY_STATUS_MAP[status] || PAY_STATUS_MAP.unpaid
  return (
    <span style={{ display:'inline-flex', alignItems:'center', padding:'0.2rem 0.6rem',
      borderRadius:100, background:v.bg, color:v.c, fontSize:'0.68rem', fontWeight:800,
      whiteSpace:'nowrap' }}>
      {v.label}
    </span>
  )
}

function MethodBadge({ method }) {
  const MAP = {
    esewa:'🟢', khalti:'🟣', bank_transfer:'🏦',
    cash:'💵', free:'🎁', fonepay:'📱',
  }
  return (
    <span style={{ fontFamily:'monospace', fontSize:'0.75rem', background:'#f0f4f8',
      padding:'0.15rem 0.45rem', borderRadius:4, color:C.slate }}>
      {MAP[method] || '💳'} {method || '—'}
    </span>
  )
}

// ── Inline Confirm ────────────────────────────────────────────
function InlineConfirm({ msg, onYes, onNo, loading }) {
  return (
    <div style={{ display:'flex', gap:'0.35rem', alignItems:'center', flexWrap:'wrap' }}>
      <span style={{ fontSize:'0.72rem', color:C.slateLt }}>{msg}</span>
      <button disabled={loading}
        style={{ padding:'0.22rem 0.6rem', borderRadius:6, border:'none',
          background:'#1a7a4a', color:'white', fontSize:'0.72rem', fontWeight:700, cursor:'pointer' }}
        onClick={onYes}>
        {loading ? '…' : 'Yes'}
      </button>
      <button onClick={onNo}
        style={{ padding:'0.22rem 0.6rem', borderRadius:6, border:'1px solid #ddd',
          background:'white', color:'#666', fontSize:'0.72rem', cursor:'pointer' }}>
        No
      </button>
    </div>
  )
}

export default function CommunityAdminSection({
  commGroups, commSessions, commReservations, commMemberships,
  commSessionsTotal, commSessionPage, setCommSessionPage,
  commTab, setCommTab, selectedSessionId,
  sessionModal, setSessionModal, sessionForm, setSessionForm,
  sessionSaving, sessionErr, saveSessionModal,
  fetchCommGroups, fetchCommSessions, fetchCommReservations, fetchCommMemberships,
  openEdit, setDelConfirm, apiFetch, fmt, fmtT, inpSx, selSx,
}) {
  const [payBusy,     setPayBusy]     = useState({})   // {[id]: 'confirming'|'rejecting'}
  const [confirmRow,  setConfirmRow]  = useState(null)  // reservation id awaiting inline confirm
  const [rejectRow,   setRejectRow]   = useState(null)
  const [resFilter,   setResFilter]   = useState('')    // payment_status filter
  const [sessionFilter, setSessionFilter] = useState('upcoming') // 'upcoming'|'all'

  // ── Payment actions ────────────────────────────────────────
  const confirmPayment = useCallback(async (id) => {
    setPayBusy(b => ({ ...b, [id]:'confirming' }))
    try {
      await apiFetch(`/admin/group-reservations/${id}/confirm-payment`, {
        method: 'PUT',
        body: JSON.stringify({ payment_status: 'paid' }),
      })
      setConfirmRow(null)
      // Refresh reservations
      if (selectedSessionId) fetchCommReservations(selectedSessionId)
      else fetchAllReservations()
      fetchCommSessions(commSessionPage)
    } catch (e) { alert(e.message) }
    finally { setPayBusy(b => ({ ...b, [id]:null })) }
  }, [apiFetch, selectedSessionId, commSessionPage]) // eslint-disable-line

  const rejectPayment = useCallback(async (id) => {
    setPayBusy(b => ({ ...b, [id]:'rejecting' }))
    try {
      await apiFetch(`/admin/group-reservations/${id}/confirm-payment`, {
        method: 'PUT',
        body: JSON.stringify({ payment_status: 'failed' }),
      })
      setRejectRow(null)
      if (selectedSessionId) fetchCommReservations(selectedSessionId)
      else fetchAllReservations()
      fetchCommSessions(commSessionPage)
    } catch (e) { alert(e.message) }
    finally { setPayBusy(b => ({ ...b, [id]:null })) }
  }, [apiFetch, selectedSessionId, commSessionPage]) // eslint-disable-line

  const fetchAllReservations = useCallback(() => {
    apiFetch('/admin/group-reservations?limit=100').then(d => {
      // lift result to parent via fetchCommReservations(null) pattern
      // or trigger a re-fetch by calling fetchCommReservations with null session
      fetchCommReservations(selectedSessionId || '')
    }).catch(console.error)
  }, [apiFetch, selectedSessionId, fetchCommReservations])

  // ── Derived stats ─────────────────────────────────────────
  const resPaid    = commReservations.filter(r => r.payment_status === 'paid').length
  const resPending = commReservations.filter(r => r.payment_status === 'pending').length
  const resFree    = commReservations.filter(r => r.payment_status === 'free' || (r.group_sessions && !r.group_sessions.price)).length
  const resFailed  = commReservations.filter(r => r.payment_status === 'failed').length
  const revenue    = commReservations
    .filter(r => r.payment_status === 'paid')
    .reduce((s, r) => s + Number(r.group_sessions?.price || 0), 0)

  // Filter reservations
  const visibleRes = resFilter
    ? commReservations.filter(r => r.payment_status === resFilter)
    : commReservations

  // Filter sessions
  const now = new Date()
  const visibleSessions = sessionFilter === 'upcoming'
    ? commSessions.filter(s => !s.scheduled_at || new Date(s.scheduled_at) > now)
    : commSessions

  const TAB_BTNS = [
    { id:'groups',       label:'Groups'        },
    { id:'sessions',     label:'Sessions'      },
    { id:'reservations', label:'Reservations'  },
    { id:'memberships',  label:'Memberships'   },
  ]

  return (
    <div>
      {/* ── Page header ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start',
        marginBottom:'1.5rem', flexWrap:'wrap', gap:'0.75rem' }}>
        <div>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(1.2rem,3vw,1.4rem)',
            color:'var(--slate)' }}>🌐 Community Admin</h1>
          <p style={{ fontSize:'0.75rem', color:'var(--slate-lt)', marginTop:'0.15rem',
            fontFamily:'var(--font-body)' }}>
            Groups · Sessions · Reservations · Payments · Memberships
          </p>
        </div>
        <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
          {TAB_BTNS.map(t => (
            <button key={t.id}
              style={{ padding:'0.45rem 0.9rem', borderRadius:8, fontFamily:'var(--font-body)',
                fontSize:'0.8rem', fontWeight: commTab === t.id ? 700 : 500,
                border:`1.5px solid ${commTab === t.id ? 'var(--teal)' : 'var(--border)'}`,
                background: commTab === t.id ? 'var(--teal-lt)' : 'var(--white)',
                color: commTab === t.id ? 'var(--teal)' : 'var(--slate-md)',
                cursor:'pointer', transition:'all 0.15s' }}
              onClick={() => {
                setCommTab(t.id)
                if (t.id === 'groups')      fetchCommGroups()
                if (t.id === 'sessions')    fetchCommSessions(commSessionPage)
                if (t.id === 'reservations') fetchAllReservations()
                if (t.id === 'memberships') apiFetch('/admin/group-memberships?limit=100').then(d => fetchCommMemberships(d.items?.[0]?.group_id || ''))
              }}>
              {t.label}
              {t.id === 'reservations' && resPending > 0 && (
                <span style={{ display:'inline-flex', marginLeft:'0.35rem', background:'var(--amber)',
                  color:'white', borderRadius:100, padding:'0.05rem 0.4rem',
                  fontSize:'0.6rem', fontWeight:800, verticalAlign:'middle' }}>
                  {resPending}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════ GROUPS ═══════════ */}
      {commTab === 'groups' && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
            <span style={{ fontSize:'0.82rem', color:'var(--slate-lt)' }}>{commGroups.length} groups</span>
            <button className="btn btn-ghost" onClick={fetchCommGroups}>🔄 Refresh</button>
          </div>

          {/* Group stats summary */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',
            gap:'0.75rem', marginBottom:'1.25rem' }}>
            {[
              { label:'Total Groups',   val:commGroups.length, bg:'var(--teal-lt)', c:'var(--teal)' },
              { label:'Total Members',  val:commGroups.reduce((s,g) => s+(g.member_count||0), 0), bg:C.greenFaint, c:C.green },
              { label:'Active Groups',  val:commGroups.filter(g => g.is_active !== false).length, bg:C.skyFainter, c:C.sky },
            ].map((s, i) => (
              <div key={i} style={{ background:s.bg, borderRadius:'var(--radius-sm)',
                padding:'0.9rem', border:'1px solid var(--border)' }}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:'1.25rem', color:s.c, fontWeight:700 }}>{s.val}</div>
                <div style={{ fontSize:'0.68rem', color:'var(--slate-lt)', fontWeight:700,
                  marginTop:'0.15rem', textTransform:'uppercase', letterSpacing:'0.07em' }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Members</th>
                  <th>Tags</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {commGroups.length === 0 && (
                  <tr><td colSpan={5} className="tbl-empty">No groups. Create one in the Community Groups section.</td></tr>
                )}
                {commGroups.map(g => (
                  <tr key={g.id}>
                    <td>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                        <span style={{ fontSize:'1.5rem' }}>{g.emoji}</span>
                        <div>
                          <div style={{ fontWeight:700, fontSize:'0.83rem' }}>{g.name}</div>
                          <div style={{ fontSize:'0.7rem', color:'var(--slate-lt)' }}>{g.description?.slice(0,50)}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                        <span style={{ fontFamily:'var(--font-display)', fontSize:'1.1rem', color:'var(--teal)', fontWeight:700 }}>
                          {g.member_count || 0}
                        </span>
                        <button className="btn btn-ghost btn-sm" onClick={() => { fetchCommMemberships(g.id); setCommTab('memberships') }}>
                          👥 View
                        </button>
                      </div>
                    </td>
                    <td>
                      <div style={{ display:'flex', gap:'0.25rem', flexWrap:'wrap' }}>
                        {(g.tags || []).map(t => <span key={t} className="chip">{t}</span>)}
                      </div>
                    </td>
                    <td>
                      <span className="badge" style={{
                        background: g.is_active !== false ? C.greenFaint : '#f0f0f0',
                        color: g.is_active !== false ? C.green : '#666',
                      }}>
                        {g.is_active !== false ? 'active' : 'paused'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display:'flex', gap:'0.35rem' }}>
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => { setCommTab('sessions'); fetchCommSessions() }}>
                          📅 Sessions
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit('community_group', g)}>✏️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════ SESSIONS ═══════════ */}
      {commTab === 'sessions' && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
            marginBottom:'1rem', flexWrap:'wrap', gap:'0.65rem' }}>
            <div style={{ display:'flex', gap:'0.4rem' }}>
              {['upcoming','all'].map(f => (
                <button key={f}
                  style={{ padding:'0.3rem 0.7rem', borderRadius:6, fontSize:'0.78rem',
                    border:`1.5px solid ${sessionFilter === f ? 'var(--teal)' : 'var(--border)'}`,
                    background: sessionFilter === f ? 'var(--teal-lt)' : 'var(--white)',
                    color: sessionFilter === f ? 'var(--teal)' : 'var(--slate-lt)',
                    cursor:'pointer', fontFamily:'var(--font-body)', fontWeight:600, transition:'all 0.15s' }}
                  onClick={() => setSessionFilter(f)}>
                  {f === 'upcoming' ? '📅 Upcoming' : '📋 All Sessions'}
                </button>
              ))}
            </div>
            <div style={{ display:'flex', gap:'0.5rem' }}>
              <button className="btn btn-ghost" onClick={() => fetchCommSessions(commSessionPage)}>🔄 Refresh</button>
              <button className="btn btn-primary"
                onClick={() => { setSessionForm({ max_spots:20, mode:'Online (Zoom)', price:0 }); setSessionModal({ data:null }) }}>
                ➕ New Session
              </button>
            </div>
          </div>

          {/* Session payment summary */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',
            gap:'0.75rem', marginBottom:'1.25rem' }}>
            {[
              { label:'Sessions',    val: visibleSessions.length,                               bg:'var(--teal-lt)', c:'var(--teal)' },
              { label:'Total Seats', val: visibleSessions.reduce((s,x) => s+(x.max_spots||0),0),bg:C.skyFainter, c:C.sky },
              { label:'Reserved',    val: visibleSessions.reduce((s,x) => s+(x.reserved_count||0),0), bg:C.greenFaint, c:C.green },
              { label:'Available',   val: visibleSessions.reduce((s,x) => s+(x.spots_left||0),0), bg:'#f0f0ff', c:'#5a1a8a' },
            ].map((s,i) => (
              <div key={i} style={{ background:s.bg, borderRadius:'var(--radius-sm)',
                padding:'0.9rem', border:'1px solid var(--border)' }}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:'1.25rem', color:s.c, fontWeight:700 }}>{s.val}</div>
                <div style={{ fontSize:'0.68rem', color:'var(--slate-lt)', fontWeight:700,
                  textTransform:'uppercase', letterSpacing:'0.07em', marginTop:'0.15rem' }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Group</th>
                  <th>Date & Time</th>
                  <th>Mode</th>
                  <th>Price</th>
                  <th>Seats</th>
                  <th>Reserved</th>
                  <th>Left</th>
                  <th>Paid / Pending</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleSessions.length === 0 && (
                  <tr><td className="tbl-empty" colSpan={10}>No sessions found.</td></tr>
                )}
                {visibleSessions.map(s => {
                  // Count payments from reservations matching this session
                  const sessRes  = commReservations.filter(r => (r.session_id || r.group_session_id) === s.id || r.group_sessions?.id === s.id)
                  const paidCnt  = sessRes.filter(r => r.payment_status === 'paid').length
                  const pendCnt  = sessRes.filter(r => r.payment_status === 'pending').length
                  const isFull   = s.is_full || s.spots_left <= 0
                  const fillPct  = s.max_spots ? Math.round((s.reserved_count || 0) / s.max_spots * 100) : 0

                  return (
                    <tr key={s.id}>
                      <td style={{ maxWidth:200 }}>
                        <div style={{ fontWeight:700, fontSize:'0.83rem' }}>{s.title}</div>
                        <div style={{ fontSize:'0.7rem', color:'var(--slate-lt)' }}>👤 {s.facilitator}</div>
                      </td>
                      <td style={{ fontSize:'0.8rem' }}>
                        {s.community_groups?.emoji} {s.community_groups?.name || '—'}
                      </td>
                      <td style={{ fontSize:'0.77rem', color:'var(--slate-lt)', whiteSpace:'nowrap' }}>
                        {s.scheduled_at ? fmtT(s.scheduled_at) : '—'}
                      </td>
                      <td>
                        <span style={{ fontSize:'0.75rem', background:'var(--bg)',
                          padding:'0.15rem 0.45rem', borderRadius:4 }}>{s.mode}</span>
                      </td>
                      <td style={{ fontWeight:700 }}>
                        {!s.price || s.price === 0
                          ? <span className="badge" style={{ background:C.greenFaint, color:C.green }}>FREE</span>
                          : `NPR ${Number(s.price).toLocaleString()}`}
                      </td>
                      <td style={{ textAlign:'center', fontWeight:700 }}>{s.max_spots}</td>
                      <td style={{ textAlign:'center' }}>
                        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                          <span style={{ fontWeight:700, color: isFull ? C.red : C.green }}>
                            {s.reserved_count || 0}
                          </span>
                          {/* Fill bar */}
                          <div style={{ width:36, height:4, background:'#eee', borderRadius:2, overflow:'hidden' }}>
                            <div style={{ width:`${fillPct}%`, height:'100%',
                              background: fillPct >= 90 ? C.red : fillPct >= 60 ? C.amber : C.green,
                              borderRadius:2, transition:'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize:'0.62rem', color:'var(--slate-lt)' }}>{fillPct}%</span>
                        </div>
                      </td>
                      <td style={{ textAlign:'center' }}>
                        <span style={{ fontWeight:800,
                          color: isFull ? C.red : s.spots_left <= 3 ? C.amber : C.green }}>
                          {isFull ? '🔴 FULL' : s.spots_left}
                        </span>
                      </td>
                      <td>
                        <div style={{ display:'flex', gap:'0.25rem', flexWrap:'wrap' }}>
                          {paidCnt > 0 && (
                            <span className="badge" style={{ background:C.greenFaint, color:C.green }}>
                              ✓ {paidCnt} paid
                            </span>
                          )}
                          {pendCnt > 0 && (
                            <span className="badge" style={{ background:C.amberFaint, color:C.amber }}>
                              ⏳ {pendCnt} pending
                            </span>
                          )}
                          {paidCnt === 0 && pendCnt === 0 && (
                            <span style={{ fontSize:'0.72rem', color:'var(--slate-lt)' }}>—</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display:'flex', gap:'0.35rem', flexWrap:'wrap' }}>
                          <button className="btn btn-ghost btn-sm"
                            onClick={() => { fetchCommReservations(s.id); setCommTab('reservations') }}>
                            👥 {s.reserved_count || 0}
                          </button>
                          <button className="btn btn-ghost btn-sm"
                            onClick={() => { setSessionForm({ ...s }); setSessionModal({ data:s }) }}>
                            ✏️
                          </button>
                          <button className="btn btn-danger btn-sm"
                            onClick={() => setDelConfirm({
                              endpoint:'/admin/group-sessions', id:s.id, label:s.title,
                              refresh:() => fetchCommSessions(commSessionPage),
                            })}>
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:'0.5rem', padding:'0.75rem', borderTop:'1px solid var(--border)' }}>
            <button className="pg-btn" onClick={() => { const p = Math.max(1,commSessionPage-1); setCommSessionPage(p); fetchCommSessions(p) }} disabled={commSessionPage===1}>← Prev</button>
            <span style={{ fontSize:'0.78rem', color:'var(--slate-lt)' }}>Page {commSessionPage} · {commSessionsTotal} total</span>
            <button className="pg-btn" onClick={() => { const p = commSessionPage+1; setCommSessionPage(p); fetchCommSessions(p) }} disabled={commSessionsTotal <= commSessionPage*20}>Next →</button>
          </div>
        </div>
      )}

      {/* ═══════════ RESERVATIONS + PAYMENT MANAGEMENT ═══════════ */}
      {commTab === 'reservations' && (
        <div>
          {/* Payment summary cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',
            gap:'0.75rem', marginBottom:'1.25rem' }}>
            {[
              { label:'Total',        val:commReservations.length, bg:'var(--bg)',    c:'var(--slate)'  },
              { label:'Paid',         val:resPaid,                 bg:C.greenFaint,  c:C.green         },
              { label:'Pending',      val:resPending,              bg:C.amberFaint,  c:C.amber         },
              { label:'Free',         val:resFree,                 bg:C.skyFainter,  c:C.sky           },
              { label:'Failed',       val:resFailed,               bg:'#fff0f0',     c:C.red           },
              { label:'Revenue',      val:`NPR ${revenue.toLocaleString()}`, bg:'#f0e8ff', c:'#5a1a8a' },
            ].map((s,i) => (
              <div key={i} style={{ background:s.bg, borderRadius:'var(--radius-sm)',
                padding:'0.85rem', border:'1px solid var(--border)', cursor:'pointer',
                outline: resFilter === (['','paid','pending','free','failed',''][i]) ? `2px solid ${s.c}` : 'none' }}
                onClick={() => setResFilter(resFilter === (['','paid','pending','free','failed',''][i]) ? '' : (['','paid','pending','free','failed',''][i]))}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:'1.1rem', color:s.c, fontWeight:700 }}>{s.val}</div>
                <div style={{ fontSize:'0.65rem', color:'var(--slate-lt)', fontWeight:700,
                  textTransform:'uppercase', letterSpacing:'0.07em', marginTop:'0.15rem' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Pending payment alert */}
          {resPending > 0 && (
            <div style={{ background:C.amberFaint, border:`1px solid #f5d87a`,
              borderRadius:'var(--radius-sm)', padding:'0.75rem 1rem', marginBottom:'1rem',
              fontSize:'0.82rem', color:C.amber, display:'flex', gap:'0.5rem', alignItems:'center' }}>
              ⚠️ <strong>{resPending} reservation{resPending>1?'s':''}</strong> pending payment verification.
              Click "⏳ Pending" above to filter them.
            </div>
          )}

          {/* Filter & controls */}
          <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', marginBottom:'1rem', flexWrap:'wrap' }}>
            <select style={{ padding:'0.35rem 0.7rem', border:'1.5px solid var(--border)', borderRadius:8,
              fontFamily:'var(--font-body)', fontSize:'0.8rem', color:'var(--slate)', outline:'none',
              background:'var(--white)', cursor:'pointer' }}
              value={resFilter} onChange={e => setResFilter(e.target.value)}>
              <option value="">All statuses</option>
              {['paid','pending','failed','free'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={fetchAllReservations}>🔄 Refresh</button>
            {resFilter && (
              <button className="btn btn-ghost btn-sm" onClick={() => setResFilter('')}>✕ Clear filter</button>
            )}
            <span style={{ fontSize:'0.75rem', color:'var(--slate-lt)', marginLeft:'auto' }}>
              Showing {visibleRes.length} of {commReservations.length}
            </span>
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Session</th>
                  <th>Date</th>
                  <th>Price</th>
                  <th>Method</th>
                  <th>Txn Reference</th>
                  <th>Payment Status</th>
                  <th>Booked At</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleRes.length === 0 && (
                  <tr><td className="tbl-empty" colSpan={9}>No reservations found.</td></tr>
                )}
                {visibleRes.map(r => {
                  const session    = r.group_sessions || {}
                  const isFreeSession = !session.price || session.price === 0
                  const payStatus  = isFreeSession ? 'free' : (r.payment_status || 'unpaid')
                  const isPending  = payStatus === 'pending'
                  const isConfirming = confirmRow === r.id
                  const isRejecting  = rejectRow === r.id
                  const busy         = payBusy[r.id]

                  return (
                    <tr key={r.id} style={{ background: isPending ? `${C.amberFaint}55` : 'transparent' }}>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:'0.45rem' }}>
                          <div style={{ width:28, height:28, borderRadius:'50%',
                            background: r.is_anonymous ? '#f0f4f8' : 'var(--teal-lt)',
                            display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize:'0.8rem', flexShrink:0 }}>
                            {r.is_anonymous ? '🕵️' : '😊'}
                          </div>
                          <div>
                            <div style={{ fontWeight:700, fontSize:'0.82rem', color:'var(--slate)' }}>
                              {r.display_name || '—'}
                            </div>
                            {r.is_anonymous && (
                              <div style={{ fontSize:'0.65rem', color:'var(--slate-lt)' }}>Anonymous</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ maxWidth:160 }}>
                        <div style={{ fontWeight:600, fontSize:'0.8rem' }}>
                          {session.title || '—'}
                        </div>
                        <div style={{ fontSize:'0.7rem', color:'var(--slate-lt)' }}>
                          {session.community_groups?.emoji} {session.community_groups?.name || ''}
                        </div>
                      </td>
                      <td style={{ fontSize:'0.75rem', color:'var(--slate-lt)', whiteSpace:'nowrap' }}>
                        {session.scheduled_at ? fmtT(session.scheduled_at) : '—'}
                      </td>
                      <td style={{ fontWeight:700, fontSize:'0.82rem' }}>
                        {isFreeSession ? (
                          <span style={{ color:C.green, fontWeight:700 }}>FREE</span>
                        ) : `NPR ${Number(session.price || 0).toLocaleString()}`}
                      </td>
                      <td>
                        <MethodBadge method={r.payment_method} />
                      </td>
                      <td style={{ maxWidth:120 }}>
                        {r.payment_reference ? (
                          <code style={{ fontFamily:'monospace', fontSize:'0.72rem',
                            background:'#f0f4f8', padding:'0.15rem 0.4rem', borderRadius:4,
                            color:'var(--slate)', wordBreak:'break-all' }}>
                            {r.payment_reference}
                          </code>
                        ) : (
                          <span style={{ color:'var(--slate-lt)', fontSize:'0.78rem' }}>—</span>
                        )}
                      </td>
                      <td>
                        <PayBadge status={payStatus} />
                      </td>
                      <td style={{ fontSize:'0.75rem', color:'var(--slate-lt)' }}>
                        {r.created_at ? fmt(r.created_at) : '—'}
                      </td>
                      <td>
                        <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', minWidth:160 }}>
                          {isPending && !isConfirming && !isRejecting && (
                            <div style={{ display:'flex', gap:'0.3rem' }}>
                              <button
                                style={{ padding:'0.25rem 0.6rem', borderRadius:6, border:'none',
                                  background:C.green, color:'white', fontSize:'0.72rem',
                                  fontWeight:700, cursor:'pointer' }}
                                onClick={() => { setConfirmRow(r.id); setRejectRow(null) }}>
                                ✓ Confirm Pay
                              </button>
                              <button
                                style={{ padding:'0.25rem 0.6rem', borderRadius:6,
                                  border:`1px solid ${C.red}`, background:'white',
                                  color:C.red, fontSize:'0.72rem', fontWeight:700, cursor:'pointer' }}
                                onClick={() => { setRejectRow(r.id); setConfirmRow(null) }}>
                                ✗ Reject
                              </button>
                            </div>
                          )}
                          {isConfirming && (
                            <InlineConfirm
                              msg="Confirm this payment?"
                              loading={busy === 'confirming'}
                              onYes={() => confirmPayment(r.id)}
                              onNo={() => setConfirmRow(null)}
                            />
                          )}
                          {isRejecting && (
                            <InlineConfirm
                              msg="Mark as failed?"
                              loading={busy === 'rejecting'}
                              onYes={() => rejectPayment(r.id)}
                              onNo={() => setRejectRow(null)}
                            />
                          )}
                          {payStatus === 'paid' && (
                            <button
                              style={{ padding:'0.22rem 0.55rem', borderRadius:6,
                                border:`1px solid var(--border)`, background:'var(--white)',
                                color:'var(--slate-lt)', fontSize:'0.7rem', cursor:'pointer' }}
                              onClick={() => { setRejectRow(r.id); setConfirmRow(null) }}>
                              ↩ Mark unpaid
                            </button>
                          )}
                          <button
                            style={{ padding:'0.22rem 0.55rem', borderRadius:6,
                              border:`1px solid var(--border)`, background:'var(--white)',
                              color:C.red, fontSize:'0.7rem', cursor:'pointer' }}
                            onClick={() => setDelConfirm({
                              endpoint:'/admin/group-reservations', id:r.id,
                              label:`${r.display_name}'s reservation`,
                              refresh:fetchAllReservations,
                            })}>
                            🗑 Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════ MEMBERSHIPS ═══════════ */}
      {commTab === 'memberships' && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
            <span style={{ fontSize:'0.82rem', color:'var(--slate-lt)' }}>
              {commMemberships.length} membership{commMemberships.length !== 1 ? 's' : ''}
            </span>
            <button className="btn btn-ghost"
              onClick={() => apiFetch('/admin/group-memberships?limit=100')
                .then(d => fetchCommMemberships(d.items?.[0]?.group_id || ''))
                .catch(console.error)}>
              🔄 Load All
            </button>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Member</th><th>Anonymous</th><th>Group</th><th>Joined</th></tr>
              </thead>
              <tbody>
                {commMemberships.length === 0 && (
                  <tr><td className="tbl-empty" colSpan={4}>No memberships yet.</td></tr>
                )}
                {commMemberships.map(m => (
                  <tr key={m.id}>
                    <td style={{ fontWeight:600, fontSize:'0.83rem' }}>{m.display_name || '—'}</td>
                    <td>
                      <span className="badge" style={{
                        background: m.is_anonymous ? 'var(--teal-lt)' : '#f0f0f0',
                        color: m.is_anonymous ? 'var(--teal)' : '#666',
                      }}>
                        {m.is_anonymous ? '🕵️ Yes' : 'No'}
                      </span>
                    </td>
                    <td style={{ fontSize:'0.8rem' }}>
                      {m.community_groups?.emoji} {m.community_groups?.name || '—'}
                    </td>
                    <td style={{ fontSize:'0.77rem', color:'var(--slate-lt)' }}>{fmt(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════ SESSION MODAL ═══════════ */}
      {sessionModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(15,30,45,.55)',
          backdropFilter:'blur(4px)', zIndex:500, display:'flex', alignItems:'center',
          justifyContent:'center', padding:'1rem' }}
          onClick={() => setSessionModal(null)}>
          <div style={{ background:'var(--white)', borderRadius:16, width:'100%', maxWidth:600,
            maxHeight:'90vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,.2)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding:'1.25rem 1.5rem', borderBottom:'1px solid var(--border)',
              display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontFamily:'var(--font-display)', fontSize:'1.1rem', color:'var(--slate)' }}>
                {sessionModal.data ? '✏️ Edit Session' : '➕ New Group Session'}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => setSessionModal(null)}>✕</button>
            </div>
            <div style={{ padding:'1.5rem', display:'flex', flexDirection:'column', gap:'1rem' }}>
              <div className="field">
                <label>Session Title *</label>
                <input style={inpSx} value={sessionForm.title || ''}
                  onChange={e => setSessionForm(p => ({ ...p, title:e.target.value }))}
                  placeholder="e.g. Mindfulness Circle — Weekly Session" />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Group *</label>
                  <select style={selSx} value={sessionForm.group_id || ''}
                    onChange={e => setSessionForm(p => ({ ...p, group_id:e.target.value }))}>
                    <option value="">— Select group —</option>
                    {commGroups.map(g => <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Mode</label>
                  <select style={selSx} value={sessionForm.mode || 'Online (Zoom)'}
                    onChange={e => setSessionForm(p => ({ ...p, mode:e.target.value }))}>
                    <option>Online (Zoom)</option>
                    <option>In-Person, Kathmandu</option>
                    <option>Hybrid</option>
                    <option>Phone Call</option>
                  </select>
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Date & Time *</label>
                  <input style={inpSx} type="datetime-local"
                    value={sessionForm.scheduled_at ? sessionForm.scheduled_at.slice(0,16) : ''}
                    onChange={e => setSessionForm(p => ({ ...p, scheduled_at:new Date(e.target.value).toISOString() }))} />
                </div>
                <div className="field">
                  <label>Facilitator</label>
                  <input style={inpSx} value={sessionForm.facilitator || ''}
                    onChange={e => setSessionForm(p => ({ ...p, facilitator:e.target.value }))}
                    placeholder="Ms. Priya Tamang" />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Max Spots</label>
                  <input style={inpSx} type="number" value={sessionForm.max_spots || 20}
                    onChange={e => setSessionForm(p => ({ ...p, max_spots:Number(e.target.value) }))} />
                </div>
                <div className="field">
                  <label>Price (NPR) — 0 = Free</label>
                  <input style={inpSx} type="number" value={sessionForm.price ?? 0}
                    onChange={e => setSessionForm(p => ({ ...p, price:Number(e.target.value) }))} />
                </div>
              </div>
              <div className="field">
                <label>Notes</label>
                <textarea style={{ ...inpSx, resize:'vertical', lineHeight:1.6 }} rows={2}
                  value={sessionForm.notes || ''}
                  onChange={e => setSessionForm(p => ({ ...p, notes:e.target.value }))} />
              </div>
            </div>
            {sessionErr && (
              <div style={{ margin:'0 1.5rem 0.5rem' }}>
                <div className="alert alert-error">{sessionErr}</div>
              </div>
            )}
            <div style={{ padding:'1rem 1.5rem', borderTop:'1px solid var(--border)',
              display:'flex', justifyContent:'flex-end', gap:'0.65rem' }}>
              <button className="btn btn-ghost" onClick={() => setSessionModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveSessionModal} disabled={sessionSaving}>
                {sessionSaving ? 'Saving…' : sessionModal.data ? '💾 Save Changes' : '➕ Create Session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
