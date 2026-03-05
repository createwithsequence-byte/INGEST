import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Card = {
  id: string
  user_id: string
  url: string
  title: string
  sub: string
  type: 'TOOL' | 'ARTICLE' | 'VIDEO' | 'SOCIAL' | 'GITHUB' | 'OTHER'
  domain: string
  date: string
  summary: string
  details: string[]
  pros: string[]
  cons: string[]
  best_for: string[]
  tags: string[]
  category: string
  score: number
  longevity: string
  stale: string[]
  intent: string
  notes: string
  pinned: boolean
  ai_suggestion: { text: string; type: string } | null
  canvas_x: number
  canvas_y: number
  hidden_from_canvas: boolean
  status: 'ingesting' | 'complete' | 'error'
  created_at: string
  updated_at: string
}

export type Category = {
  id: string
  user_id: string
  name: string
  color: string
  canvas_x: number
  canvas_y: number
}

export type Connection = {
  id: string
  user_id: string
  from_card_id: string
  to_card_id: string
}

export type Note = {
  id: string
  user_id: string
  text: string
  canvas_x: number
  canvas_y: number
  color: string
}
