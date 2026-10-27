'use client'

import { useState } from 'react'

export default function KeywordTable({ keywords }) {
  const [sortConfig, setSortConfig] = useState({ key: 'priority', direction: 'asc' })

  const sortedKeywords = [...keywords].sort((a, b) => {
    let aVal = a[sortConfig.key]
    let bVal = b[sortConfig.key]

    if (typeof aVal === 'string') {
      aVal = aVal.toLowerCase()
      bVal = bVal.toLowerCase()
    }

    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1
    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1
    return 0
  })

  const handleSort = (key) => {
    setSortConfig({
      key,
      direction:
        sortConfig.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc'
    })
  }

  const SortIcon = ({ column }) => {
    if (sortConfig.key !== column) {
      return <span className="text-slate-300">↕</span>
    }
    return (
      <span className="text-blue-600">
        {sortConfig.direction === 'asc' ? '↑' : '↓'}
      </span>
    )
  }

  const PriorityBadge = ({ priority }) => {
    const colors = {
      'P1': 'bg-red-100 text-red-700',
      'P2': 'bg-orange-100 text-orange-700',
      'P3': 'bg-yellow-100 text-yellow-700'
    }
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${colors[priority] || 'bg-slate-100 text-slate-700'}`}>
        {priority}
      </span>
    )
  }

  const IntentBadge = ({ intent }) => {
    const colors = {
      'Transaccional': 'bg-blue-100 text-blue-700',
      'Comercial-mixta': 'bg-purple-100 text-purple-700',
      'Informacional': 'bg-green-100 text-green-700'
    }
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[intent] || 'bg-slate-100 text-slate-700'}`}>
        {intent}
      </span>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-6 py-3 text-left">
              <button
                onClick={() => handleSort('keyword')}
                className="flex items-center gap-2 font-semibold text-slate-700 hover:text-slate-900"
              >
                Keyword
                <SortIcon column="keyword" />
              </button>
            </th>
            <th className="px-6 py-3 text-left">
              <button
                onClick={() => handleSort('intent')}
                className="flex items-center gap-2 font-semibold text-slate-700 hover:text-slate-900"
              >
                Intent
                <SortIcon column="intent" />
              </button>
            </th>
            <th className="px-6 py-3 text-left">
              <button
                onClick={() => handleSort('domain')}
                className="flex items-center gap-2 font-semibold text-slate-700 hover:text-slate-900"
              >
                Domain
                <SortIcon column="domain" />
              </button>
            </th>
            <th className="px-6 py-3 text-left">
              <button
                onClick={() => handleSort('priority')}
                className="flex items-center gap-2 font-semibold text-slate-700 hover:text-slate-900"
              >
                Prioridad
                <SortIcon column="priority" />
              </button>
            </th>
            <th className="px-6 py-3 text-center font-semibold text-slate-700">
              Posición
            </th>
            <th className="px-6 py-3 text-center font-semibold text-slate-700">
              Estado
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {sortedKeywords.map((keyword, idx) => (
            <tr
              key={keyword.id || idx}
              className="hover:bg-slate-50 transition-colors"
            >
              <td className="px-6 py-4">
                <p className="font-medium text-slate-900">{keyword.keyword}</p>
              </td>
              <td className="px-6 py-4">
                <IntentBadge intent={keyword.intent} />
              </td>
              <td className="px-6 py-4">
                <span className="text-sm text-slate-600 font-mono">{keyword.domain}</span>
              </td>
              <td className="px-6 py-4">
                <PriorityBadge priority={keyword.priority} />
              </td>
              <td className="px-6 py-4 text-center">
                <span className="text-lg font-bold text-slate-900">—</span>
                <p className="text-xs text-slate-500 mt-1">Próximamente</p>
              </td>
              <td className="px-6 py-4 text-center">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-50 text-yellow-700 text-xs font-medium">
                  <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                  En espera
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
