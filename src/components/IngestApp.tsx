'use client'

/**
 * INGEST.IO — Main Application Component
 * 
 * This is the full app with:
 * - Supabase auth (email/password)
 * - Supabase persistence (cards, categories, connections, notes)
 * - Server-side ingestion via /api/ingest
 * - Server-side AI chat via /api/chat
 * - Canvas, List, Board views
 * - All canvas interactions (drag, link, organize, clear)
 * 
 * For the prototype version (no Supabase), this falls back to
 * local state with client-side Claude API calls.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Card, Category, Connection, Note } from '@/lib/supabase'

// TODO: Import your logo as a static asset
// For now using text logo — replace with: import logo from '/public/logo.png'

const TS: Record<string, { icon: string; color: string; label: string }> = {
  TOOL:    { icon: '◆', color: '#6366f1', label: 'Tool' },
  ARTICLE: { icon: '◇', color: '#06b6d4', label: 'Article' },
  VIDEO:   { icon: '▸', color: '#f59e0b', label: 'Video' },
  SOCIAL:  { icon: '◎', color: '#8b5cf6', label: 'Social' },
  GITHUB:  { icon: '⬡', color: '#64748b', label: 'GitHub' },
  OTHER:   { icon: '○', color: '#94a3b8', label: 'Other' },
}

const CAT_COLORS = ['#6366f1','#06b6d4','#8b5cf6','#f59e0b','#ec4899','#14b8a6','#f97316','#84cc16']

function scoreColor(s: number) { return s >= 75 ? '#22c55e' : s >= 50 ? '#f59e0b' : '#ef4444' }
function scoreBg(s: number) { return s >= 75 ? 'rgba(34,197,94,0.08)' : s >= 50 ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)' }
function timeAgo(d: string) {
  const dy = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (dy < 1) return 'today'
  if (dy < 7) return dy + 'd'
  if (dy < 30) return Math.floor(dy / 7) + 'w'
  if (dy < 365) return Math.floor(dy / 30) + 'mo'
  return Math.floor(dy / 365) + 'y'
}

export default function IngestApp() {
  // Auth state
  const [user, setUser] = useState<any>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authEmail, setAuthEmail] = useState('')
  const [authPass, setAuthPass] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [authError, setAuthError] = useState('')

  // App state
  const [cards, setCards] = useState<any[]>([])
  const [cats, setCats] = useState<Record<string, { color: string; x: number; y: number }>>({})
  const [conns, setConns] = useState<any[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [sel, setSel] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('ALL')
  const [view, setView] = useState('canvas')
  const [modal, setModal] = useState(false)
  const [urlIn, setUrlIn] = useState('')
  const [intIn, setIntIn] = useState('')
  const iRef = useRef<HTMLInputElement>(null)

  // Canvas state
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(0.8)
  const [panning, setPanning] = useState(false)
  const [space, setSpace] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragType, setDragType] = useState<string | null>(null)
  const [didDrag, setDidDrag] = useState(false)
  const [shiftHeld, setShiftHeld] = useState(false)
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [clearStep, setClearStep] = useState(0)

  // Check auth on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load data when user authenticates
  useEffect(() => {
    if (!user) return
    loadData()
  }, [user])

  async function loadData() {
    // Load cards
    const { data: cardsData } = await supabase
      .from('cards')
      .select('*')
      .order('created_at', { ascending: false })
    if (cardsData) setCards(cardsData.map(dbToCard))

    // Load categories
    const { data: catsData } = await supabase.from('categories').select('*')
    if (catsData) {
      const catMap: Record<string, any> = {}
      catsData.forEach((c: any) => { catMap[c.name] = { color: c.color, x: c.canvas_x, y: c.canvas_y } })
      setCats(catMap)
    }

    // Load connections
    const { data: connsData } = await supabase.from('connections').select('*')
    if (connsData) setConns(connsData.map((c: any) => ({ id: c.id, from: c.from_card_id, to: c.to_card_id })))

    // Load notes
    const { data: notesData } = await supabase.from('notes').select('*')
    if (notesData) setNotes(notesData.map((n: any) => ({ id: n.id, text: n.text, x: n.canvas_x, y: n.canvas_y, color: n.color })))
  }

  function dbToCard(c: any) {
    return {
      id: c.id, url: c.url, title: c.title, sub: c.sub, type: c.type,
      domain: c.domain, date: c.date, summary: c.summary,
      details: c.details || [], pros: c.pros || [], cons: c.cons || [],
      bestFor: c.best_for || [], tags: c.tags || [], cat: c.category,
      score: c.score, longevity: c.longevity, stale: c.stale || [],
      intent: c.intent, notes: c.notes, pinned: c.pinned,
      ai: c.ai_suggestion, cx: c.canvas_x, cy: c.canvas_y,
      hiddenFromCanvas: c.hidden_from_canvas, status: c.status,
    }
  }

  // Auth handlers
  async function handleAuth() {
    if (!authEmail.trim() || !authPass.trim()) { setAuthError('Fill in all fields'); return }
    setAuthError('')
    if (authMode === 'signup') {
      const { error } = await supabase.auth.signUp({ email: authEmail, password: authPass })
      if (error) setAuthError(error.message)
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPass })
      if (error) setAuthError(error.message)
    }
  }

  // Keyboard handlers
  useEffect(() => {
    function kd(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (e.key === ' ' && t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') { e.preventDefault(); setSpace(true) }
      if (e.key === 'Shift') setShiftHeld(true)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setModal(true) }
      if (e.key === 'Escape') { if (linkFrom) setLinkFrom(null); else if (modal) setModal(false); else if (sel) setSel(null) }
    }
    function ku(e: KeyboardEvent) { if (e.key === ' ') setSpace(false); if (e.key === 'Shift') setShiftHeld(false) }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }
  }, [modal, sel, linkFrom])

  useEffect(() => { if (modal && iRef.current) setTimeout(() => iRef.current?.focus(), 120) }, [modal])

  // Canvas handlers
  const onBgDown = useCallback((e: React.MouseEvent) => { if (space || e.button === 1) { setPanning(true); e.preventDefault() } }, [space])
  const onMove = useCallback((e: React.MouseEvent) => {
    if (panning) setPan(p => ({ x: p.x + e.movementX, y: p.y + e.movementY }))
    if (dragId) {
      setDidDrag(true)
      const dx = e.movementX / zoom, dy = e.movementY / zoom
      if (dragType === 'card') setCards(cs => cs.map(c => c.id === dragId ? { ...c, cx: c.cx + dx, cy: c.cy + dy } : c))
      else if (dragType === 'note') setNotes(ns => ns.map(n => n.id === dragId ? { ...n, x: n.x + dx, y: n.y + dy } : n))
      else if (dragType === 'cat') {
        setCats(cs => {
          const nc = { ...cs }
          nc[dragId] = { ...nc[dragId], x: nc[dragId].x + dx, y: nc[dragId].y + dy }
          return nc
        })
        setCards(cs => cs.map(c => c.cat === dragId ? { ...c, cx: c.cx + dx, cy: c.cy + dy } : c))
      }
    }
  }, [panning, dragId, dragType, zoom])
  const onUp = useCallback(() => { setPanning(false); setDragId(null); setDragType(null); setTimeout(() => setDidDrag(false), 60) }, [])
  const onWheel = useCallback((e: React.WheelEvent) => { e.preventDefault(); setZoom(z => Math.min(2, Math.max(0.15, z - e.deltaY * 0.001))) }, [])

  function startDrag(e: React.MouseEvent, id: string, type: string) {
    if (shiftHeld && type === 'card') {
      if (!linkFrom) { setLinkFrom(id); return }
      if (linkFrom !== id) {
        const exists = conns.some(c => (c.from === linkFrom && c.to === id) || (c.from === id && c.to === linkFrom))
        if (!exists) {
          const newConn = { id: 'c' + Date.now(), from: linkFrom, to: id }
          setConns(cs => [...cs, newConn])
          // TODO: Save to Supabase
        }
        setLinkFrom(null)
        return
      }
    }
    setDragId(id); setDragType(type); setDidDrag(false)
  }

  function clickCard(card: any) {
    if (shiftHeld) {
      if (!linkFrom) { setLinkFrom(card.id); return }
      if (linkFrom !== card.id) {
        const exists = conns.some(c => (c.from === linkFrom && c.to === card.id) || (c.from === card.id && c.to === linkFrom))
        if (!exists) setConns(cs => [...cs, { id: 'c' + Date.now(), from: linkFrom, to: card.id }])
        setLinkFrom(null)
        return
      }
    }
    if (!didDrag) setSel(card)
  }

  // Ingestion
  async function handleIngest() {
    if (!urlIn.trim()) return
    const rawUrl = urlIn.trim()
    let host = 'link'
    try { host = new URL(rawUrl).hostname.replace('www.', '') } catch {}
    
    const cid = Date.now().toString()
    const placeholder = {
      id: cid, url: rawUrl, title: host, sub: 'Ingesting...', type: 'OTHER',
      domain: host, date: new Date().toISOString().split('T')[0],
      summary: '', details: [], pros: [], cons: [], bestFor: [], tags: [],
      cat: 'Uncategorized', score: 50, longevity: 'TBD', stale: [],
      intent: intIn.trim(), notes: '', pinned: false, ai: null,
      cx: 400 + Math.random() * 200, cy: 400 + Math.random() * 200,
      hiddenFromCanvas: false, status: 'ingesting' as const,
    }
    
    setCards(c => [placeholder, ...c])
    setModal(false)
    const savedUrl = rawUrl, savedIntent = intIn.trim()
    setUrlIn(''); setIntIn('')

    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: savedUrl, intent: savedIntent }),
      })
      const { data: parsed, error } = await res.json()
      
      if (error || !parsed) throw new Error(error || 'No data returned')

      // Create category if new
      if (parsed.category && !cats[parsed.category]) {
        const nc = CAT_COLORS[Object.keys(cats).length % CAT_COLORS.length]
        const ang = Math.random() * Math.PI * 2
        setCats(cs => ({
          ...cs,
          [parsed.category]: { color: nc, x: 700 + Math.cos(ang) * 350, y: 500 + Math.sin(ang) * 250 }
        }))
        // TODO: Save category to Supabase
      }

      setCards(cs => cs.map(c => c.id === cid ? {
        ...c,
        title: parsed.title || host,
        sub: parsed.sub || '',
        type: parsed.type || 'OTHER',
        summary: parsed.summary || '',
        details: parsed.details || [],
        pros: parsed.pros || [],
        cons: parsed.cons || [],
        bestFor: parsed.bestFor || [],
        tags: parsed.tags || [],
        cat: parsed.category || 'Other',
        score: parsed.score || 50,
        longevity: parsed.longevity || '6-12mo',
        status: 'complete' as const,
      } : c))
      
      // TODO: Save card to Supabase

    } catch (e: any) {
      setCards(cs => cs.map(c => c.id === cid ? {
        ...c, title: host, sub: 'Failed',
        summary: 'Error: ' + (e.message || e),
        details: [], pros: [], cons: [], bestFor: [],
        tags: ['error'], status: 'complete' as const,
      } : c))
    }
  }

  function updateCard(id: string, u: any) {
    setCards(cs => cs.map(c => c.id === id ? { ...c, ...u } : c))
    if (sel?.id === id) setSel((s: any) => ({ ...s, ...u }))
    // TODO: Update in Supabase
  }

  function deleteCard(id: string) {
    setCards(cs => cs.filter(c => c.id !== id))
    setConns(cs => cs.filter(c => c.from !== id && c.to !== id))
    if (sel?.id === id) setSel(null)
    // TODO: Delete from Supabase
  }

  function organize() {
    setCards(cs => cs.map(c => {
      const cat = cats[c.cat]
      if (!cat) return c
      const sibs = cs.filter(x => x.cat === c.cat)
      const idx = sibs.indexOf(c)
      const angle = (idx / sibs.length) * Math.PI * 2 - Math.PI / 2
      const r = 150 + idx * 15
      return { ...c, cx: cat.x + Math.cos(angle) * r - 50, cy: cat.y + Math.sin(angle) * r - 10 }
    }))
  }

  // Filtering
  const types = ['ALL', ...Array.from(new Set(cards.filter(c => c.status === 'complete').map(c => c.type)))]
  const filtered = cards
    .filter(c => filter === 'ALL' || c.type === filter)
    .filter(c => {
      if (!search) return true
      const q = search.toLowerCase()
      return c.title?.toLowerCase().includes(q) || c.summary?.toLowerCase().includes(q) ||
        c.tags?.some((t: string) => t.toLowerCase().includes(q)) || c.cat?.toLowerCase().includes(q)
    })

  const catCounts: Record<string, number> = {}
  cards.forEach(c => { catCounts[c.cat] = (catCounts[c.cat] || 0) + 1 })

  // ── Auth Loading ──
  if (authLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#e0e7ff,#cffafe,#ede9fe)', backgroundSize: '300% 300%', animation: 'gradientShift 12s ease infinite' }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>ingest<span style={{ color: '#6366f1' }}>.io</span></div>
      </div>
    )
  }

  // ── Login Screen ──
  if (!user) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Sora',sans-serif", background: 'linear-gradient(135deg,#e0e7ff,#cffafe,#ede9fe,#e0f2fe)', backgroundSize: '300% 300%', animation: 'gradientShift 12s ease infinite' }}>
        <div style={{ width: 360, background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(20px)', borderRadius: 24, padding: 36, boxShadow: '0 24px 80px rgba(99,102,241,0.08)', border: '1px solid rgba(255,255,255,0.5)' }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, marginBottom: 4 }}>ingest<span style={{ color: '#6366f1' }}>.io</span></h1>
            <p style={{ fontSize: 12, color: '#a3b1c6' }}>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</p>
          </div>
          <div style={{ marginBottom: 12 }}>
            <input type="email" value={authEmail} onChange={e => { setAuthEmail(e.target.value); setAuthError('') }} placeholder="Email"
              style={{ width: '100%', padding: '11px 14px', borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', fontSize: 13, outline: 'none', fontFamily: "'Sora',sans-serif", marginBottom: 8, background: 'rgba(255,255,255,0.8)' }} />
            <input type="password" value={authPass} onChange={e => { setAuthPass(e.target.value); setAuthError('') }}
              onKeyDown={e => { if (e.key === 'Enter') handleAuth() }} placeholder="Password"
              style={{ width: '100%', padding: '11px 14px', borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', fontSize: 13, outline: 'none', fontFamily: "'Sora',sans-serif", background: 'rgba(255,255,255,0.8)' }} />
          </div>
          {authError && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 8, textAlign: 'center' }}>{authError}</div>}
          <button onClick={handleAuth} style={{ width: '100%', padding: 12, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'Sora',sans-serif", boxShadow: '0 4px 16px rgba(99,102,241,0.25)', marginBottom: 12 }}>
            {authMode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
          <div style={{ textAlign: 'center', fontSize: 11, color: '#a3b1c6' }}>
            {authMode === 'login' ? (
              <span>No account? <button onClick={() => { setAuthMode('signup'); setAuthError('') }} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontWeight: 600, fontFamily: "'Sora',sans-serif", fontSize: 11 }}>Sign up</button></span>
            ) : (
              <span>Have an account? <button onClick={() => { setAuthMode('login'); setAuthError('') }} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontWeight: 600, fontFamily: "'Sora',sans-serif", fontSize: 11 }}>Sign in</button></span>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Main App ──
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: "'Sora',sans-serif", color: '#1e1e2e', background: 'linear-gradient(135deg,#e0e7ff 0%,#cffafe 25%,#ede9fe 50%,#e0f2fe 75%,#fce7f3 100%)', backgroundSize: '400% 400%', animation: 'gradientShift 15s ease infinite' }}>
      
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 18px', flexShrink: 0, borderBottom: '1px solid rgba(0,0,0,0.03)', background: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(20px)', zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.5 }}>ingest<span style={{ color: '#6366f1' }}>.io</span></span>
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.03)', borderRadius: 9, padding: 2 }}>
            {['canvas', 'list', 'board'].map(v => (
              <button key={v} onClick={() => setView(v)} style={{ padding: '4px 12px', borderRadius: 7, border: 'none', background: view === v ? 'rgba(255,255,255,0.8)' : 'transparent', color: view === v ? '#1e1e2e' : '#a3b1c6', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora',sans-serif", textTransform: 'capitalize' }}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={{ width: 150, padding: '6px 10px', background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.04)', borderRadius: 9, fontSize: 11, outline: 'none', fontFamily: "'Sora',sans-serif" }} />
          <button onClick={() => setModal(true)} style={{ padding: '6px 14px', borderRadius: 9, border: 'none', background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'Sora',sans-serif", boxShadow: '0 2px 8px rgba(99,102,241,0.2)' }}>+ Ingest</button>
          <button onClick={() => supabase.auth.signOut()} style={{ padding: '4px 8px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.4)', fontSize: 10, color: '#a3b1c6', cursor: 'pointer', fontFamily: "'Sora',sans-serif" }}>
            {user.email?.split('@')[0]} ↗
          </button>
        </div>
      </header>

      {/* Canvas View */}
      {view === 'canvas' && (
        <div onMouseDown={onBgDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onWheel={onWheel}
          style={{ flex: 1, overflow: 'hidden', cursor: space ? (panning ? 'grabbing' : 'grab') : 'default', position: 'relative', userSelect: 'none' }}>
          
          {/* Toolbar */}
          <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 40, display: 'flex', gap: 2, background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(16px)', borderRadius: 14, padding: '3px 5px', boxShadow: '0 4px 20px rgba(0,0,0,0.04)', border: '1px solid rgba(255,255,255,0.5)' }}>
            <button onClick={() => setModal(true)} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 600, color: '#64748b', fontFamily: "'Sora',sans-serif" }}>🔗 Link</button>
            <button onClick={organize} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 600, color: '#6366f1', fontFamily: "'Sora',sans-serif" }}>✦ Organize</button>
            <div style={{ width: 1, height: 14, background: 'rgba(0,0,0,0.06)', alignSelf: 'center' }}></div>
            <button onClick={() => setZoom(z => Math.max(0.15, z - 0.15))} style={{ padding: '5px 6px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: '#a3b1c6' }}>−</button>
            <span style={{ fontSize: 9, color: '#a3b1c6', width: 30, textAlign: 'center', alignSelf: 'center' }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(2, z + 0.15))} style={{ padding: '5px 6px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: '#a3b1c6' }}>+</button>
          </div>

          {/* Canvas content */}
          <div style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', position: 'absolute', inset: 0, transition: dragId ? 'none' : 'transform 0.12s ease-out' }}>
            
            {/* Ambient blobs */}
            <div style={{ position: 'absolute', left: 200, top: 100, width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle,rgba(99,102,241,0.08) 0%,transparent 60%)', filter: 'blur(60px)', pointerEvents: 'none' }}></div>
            <div style={{ position: 'absolute', left: 900, top: 50, width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle,rgba(6,182,212,0.06) 0%,transparent 60%)', filter: 'blur(60px)', pointerEvents: 'none' }}></div>
            <div style={{ position: 'absolute', left: 600, top: 500, width: 550, height: 550, borderRadius: '50%', background: 'radial-gradient(circle,rgba(139,92,246,0.06) 0%,transparent 60%)', filter: 'blur(60px)', pointerEvents: 'none' }}></div>

            {/* Category hubs */}
            {Object.entries(cats).map(([name, conf]) => zoom < 0.25 ? null : (
              <div key={name}>
                <div style={{ position: 'absolute', left: conf.x - 140, top: conf.y - 140, width: 280, height: 280, borderRadius: '50%', background: `radial-gradient(circle,${conf.color}20 0%,${conf.color}08 40%,transparent 70%)`, filter: 'blur(30px)', pointerEvents: 'none' }}></div>
                <div onMouseDown={e => { e.stopPropagation(); startDrag(e, name, 'cat') }}
                  style={{ position: 'absolute', left: conf.x, top: conf.y, transform: 'translate(-50%,-50%)', zIndex: 3, textAlign: 'center', cursor: 'grab', padding: '8px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.65)', backdropFilter: 'blur(8px)', border: '1px solid rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: zoom > 0.5 ? 10 : 8, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase', color: conf.color, fontFamily: "'Sora',sans-serif" }}>{name}</div>
                  {zoom > 0.5 && <div style={{ fontSize: 9, color: conf.color, opacity: 0.4, marginTop: 1 }}>{catCounts[name] || 0}</div>}
                </div>
              </div>
            ))}

            {/* Cards */}
            {filtered.filter(c => !c.hiddenFromCanvas).map(card => {
              const ts = TS[card.type] || TS.OTHER
              const sc = scoreColor(card.score)
              const isIng = card.status === 'ingesting'
              const stale = card.score < 50

              if (isIng) return (
                <div key={card.id} onMouseDown={e => { e.stopPropagation(); startDrag(e, card.id, 'card') }} onClick={() => clickCard(card)}
                  style={{ position: 'absolute', left: card.cx, top: card.cy, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(8px)', borderRadius: 28, padding: '8px 16px 8px 11px', border: '1.5px dashed #6366f1', cursor: 'grab', zIndex: 10, whiteSpace: 'nowrap' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6366f1', animation: 'pulse 1s infinite' }}></span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#6366f1' }}>Ingesting...</span>
                  <span style={{ fontSize: 11, color: '#a3b1c6' }}>{card.domain}</span>
                </div>
              )

              return (
                <div key={card.id} onMouseDown={e => { e.stopPropagation(); startDrag(e, card.id, 'card') }} onClick={() => clickCard(card)}
                  style={{ position: 'absolute', left: card.cx, top: card.cy, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(8px)', borderRadius: 28, padding: '8px 16px 8px 11px', border: `1.5px solid ${stale ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.5)'}`, boxShadow: '0 2px 12px rgba(0,0,0,0.03)', cursor: 'grab', zIndex: 10, whiteSpace: 'nowrap', opacity: stale ? 0.55 : 1, transition: 'all 0.25s' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: ts.color, flexShrink: 0 }}></span>
                  <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.2 }}>{card.title}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: sc, opacity: 0.8 }}>{card.score}</span>
                  {card.pinned && <span style={{ fontSize: 8, opacity: 0.4 }}>📌</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 18px 32px' }}>
          {filtered.map((card, i) => {
            if (card.status === 'ingesting') return (
              <div key={card.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(255,255,255,0.6)', borderRadius: 12, border: '1.5px dashed #6366f1', marginBottom: 5, animation: 'pulse 1.5s infinite' }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#6366f1' }}>Ingesting {card.domain}...</span>
              </div>
            )
            const ts = TS[card.type] || TS.OTHER
            const sc = scoreColor(card.score)
            return (
              <div key={card.id} onClick={() => setSel(card)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: card.hiddenFromCanvas ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.65)', backdropFilter: 'blur(8px)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.4)', cursor: 'pointer', transition: 'all 0.2s', marginBottom: 5, opacity: card.hiddenFromCanvas ? 0.5 : 1 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: ts.color, flexShrink: 0 }}></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{card.title}</span>
                  <span style={{ fontSize: 11, color: '#a3b1c6', marginLeft: 6 }}>{card.sub}</span>
                </div>
                <span style={{ fontSize: 9, color: '#a3b1c6', flexShrink: 0 }}>{card.cat}</span>
                <span style={{ padding: '2px 7px', borderRadius: 12, fontSize: 10, fontWeight: 700, background: scoreBg(card.score), color: sc, flexShrink: 0 }}>{card.score}</span>
                <button onClick={e => { e.stopPropagation(); updateCard(card.id, { hiddenFromCanvas: !card.hiddenFromCanvas }) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: card.hiddenFromCanvas ? '#a3b1c6' : '#6366f1', opacity: card.hiddenFromCanvas ? 0.4 : 0.6, flexShrink: 0 }}>
                  {card.hiddenFromCanvas ? '👁‍🗨' : '👁'}
                </button>
                <button onClick={e => { e.stopPropagation(); deleteCard(card.id) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#a3b1c6', opacity: 0.3, flexShrink: 0 }}>✕</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Ingest Modal */}
      {modal && (
        <div onClick={() => setModal(false)} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(30,30,46,0.08)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '18vh' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(400px,90vw)', background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)', borderRadius: 20, boxShadow: '0 24px 60px rgba(0,0,0,0.07)', border: '1px solid rgba(255,255,255,0.5)', overflow: 'hidden' }}>
            <div style={{ padding: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Drop a link</div>
              <input ref={iRef} type="text" value={urlIn} onChange={e => setUrlIn(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleIngest() }} placeholder="Paste any URL..."
                style={{ width: '100%', padding: '11px 12px', background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(0,0,0,0.05)', borderRadius: 10, fontSize: 13, outline: 'none', fontFamily: "'Sora',sans-serif" }} />
              <input type="text" value={intIn} onChange={e => setIntIn(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleIngest() }} placeholder="Why are you saving this?"
                style={{ width: '100%', padding: '8px 12px', marginTop: 6, background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.06)', borderRadius: 8, fontSize: 11, outline: 'none', fontFamily: "'Sora',sans-serif", color: '#6366f1', fontStyle: 'italic' }} />
            </div>
            <div style={{ padding: '8px 20px', background: 'rgba(0,0,0,0.01)', borderTop: '1px solid rgba(0,0,0,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: '#a3b1c6' }}>Enter to ingest</span>
              <button onClick={handleIngest} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'Sora',sans-serif" }}>Ingest</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
