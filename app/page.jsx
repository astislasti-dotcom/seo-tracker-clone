'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import Dashboard from './components/Dashboard'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default function Home() {
  const [keywords, setKeywords] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchKeywords()
  }, [])

  async function fetchKeywords() {
    try {
      const { data, error } = await supabase
        .from('keywords')
        .select('*')
        .order('priority', { ascending: true })

      if (error) throw error
      setKeywords(data || [])
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <Dashboard keywords={keywords} loading={loading} />
    </main>
  )
}
