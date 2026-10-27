'use client'

import { useEffect, useState } from 'react'
import Dashboard from './components/Dashboard'

export default function Home() {
  const [keywords, setKeywords] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchKeywords()
  }, [])

  async function fetchKeywords() {
    try {
      const res = await fetch('/keywords.json')
      const data = await res.json()
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