'use client'

import { useState, useEffect } from 'react'
import KeywordTable from './KeywordTable'
import StatsCards from './StatsCards'

export default function Dashboard({ keywords, loading }) {
  const [filteredKeywords, setFilteredKeywords] = useState(keywords)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterDomain, setFilterDomain] = useState('all')
  const [filterPriority, setFilterPriority] = useState('all')

  useEffect(() => {
    let filtered = keywords

    if (searchTerm) {
      filtered = filtered.filter(kw =>
        kw.keyword.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    if (filterDomain !== 'all') {
      filtered = filtered.filter(kw => kw.domain === filterDomain)
    }

    if (filterPriority !== 'all') {
      filtered = filtered.filter(kw => kw.priority === filterPriority)
    }

    setFilteredKeywords(filtered)
  }, [searchTerm, filterDomain, filterPriority, keywords])

  const domains = [...new Set(keywords.map(kw => kw.domain))]
  const priorities = [...new Set(keywords.map(kw => kw.priority))]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">SEO Tracker</h1>
              <p className="text-slate-500 mt-1">Monitorea tus keywords en tiempo real</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-2xl font-bold text-slate-900">{filteredKeywords.length}</p>
                <p className="text-sm text-slate-500">Keywords tracked</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <StatsCards keywords={filteredKeywords} />
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8 border border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Filtros</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Buscar keyword
              </label>
              <input
                type="text"
                placeholder="Escribe un keyword..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              />
            </div>

            {/* Domain Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Dominio
              </label>
              <select
                value={filterDomain}
                onChange={(e) => setFilterDomain(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              >
                <option value="all">Todos</option>
                {domains.map(domain => (
                  <option key={domain} value={domain}>{domain}</option>
                ))}
              </select>
            </div>

            {/* Priority Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Prioridad
              </label>
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              >
                <option value="all">Todos</option>
                {priorities.map(priority => (
                  <option key={priority} value={priority}>{priority}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Keywords Table */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                <p className="text-slate-500 mt-4">Cargando keywords...</p>
              </div>
            </div>
          ) : filteredKeywords.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-slate-500">No se encontraron keywords</p>
            </div>
          ) : (
            <KeywordTable keywords={filteredKeywords} />
          )}
        </div>
      </div>
    </div>
  )
}
