import { type FormEvent, useState, useEffect, useRef } from 'react'
import { Search, MapPin, Briefcase, Info } from 'lucide-react'
import { useApp } from '../context/AppContext'
import type { Platform } from '../types'

// ── Location autocomplete via Nominatim (OpenStreetMap, free, no key) ─────────
interface Suggestion {
  label: string   // e.g. "Berlin, Germany"
}

function useLocationSuggestions(query: string): Suggestion[] {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([])
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      try {
        const url =
          `https://nominatim.openstreetmap.org/search` +
          `?q=${encodeURIComponent(query)}` +
          `&format=json&addressdetails=1&limit=6` +
          `&featuretype=city`
        const res = await fetch(url, {
          headers: { 'Accept-Language': 'en' },
        })
        if (!res.ok) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any[] = await res.json()

        const seen = new Set<string>()
        const results: Suggestion[] = []

        for (const item of data) {
          const city    = item.address?.city || item.address?.town || item.address?.village || item.address?.county || ''
          const country = item.address?.country || ''
          if (!city || !country) continue
          const label = `${city}, ${country}`
          if (seen.has(label)) continue
          seen.add(label)
          results.push({ label })
          if (results.length >= 5) break
        }

        setSuggestions(results)
      } catch {
        // Ignore network errors — autocomplete is a convenience only
      }
    }, 300)

    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [query])

  return suggestions
}

// ── Location input with dropdown ──────────────────────────────────────────────
function LocationInput({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState(value)
  const suggestions = useLocationSuggestions(open ? inputValue : '')
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync when parent resets value
  useEffect(() => { setInputValue(value) }, [value])

  // Close dropdown when clicking outside
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  function handleChange(v: string) {
    setInputValue(v)
    onChange(v)
    setOpen(true)
  }

  function pick(label: string) {
    setInputValue(label)
    onChange(label)
    setOpen(false)
  }

  const showDropdown = open && suggestions.length > 0

  return (
    <div ref={containerRef} className="relative">
      <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500 pointer-events-none z-10" />
      <input
        type="text"
        className="input pl-10"
        placeholder="Location (e.g. Berlin, Germany)"
        value={inputValue}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        disabled={disabled}
        autoComplete="off"
      />
      {showDropdown && (
        <ul className="absolute z-50 left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden">
          {suggestions.map((s) => (
            <li key={s.label}>
              <button
                type="button"
                onMouseDown={() => pick(s.label)}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
              >
                <MapPin className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 shrink-0" />
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── ScrapeForm ─────────────────────────────────────────────────────────────────
export default function ScrapeForm() {
  const { startScrape, isScraping, connectedPlatforms } = useApp()
  const [jobTitle, setJobTitle] = useState('Software Engineer')
  const [location, setLocation] = useState('Cologne, Germany')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!jobTitle.trim()) return
    startScrape({ jobTitle: jobTitle.trim(), location: location.trim() })
  }

  const platformLabels: Record<Platform, string> = {
    linkedin: 'LinkedIn',
    stepstone: 'StepStone',
    xing: 'Xing',
    indeed: 'Indeed',
    jobriver: 'Jobriver',
  }

  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Search Jobs</h2>
        {connectedPlatforms.length > 0 ? (
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Scraping from: <span className="font-medium text-gray-700 dark:text-slate-300">
              {connectedPlatforms.map((p) => platformLabels[p]).join(', ')}
            </span>
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 mt-0.5">
            <Info className="w-3.5 h-3.5" />
            No platforms connected — open Settings to connect
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <div className="relative">
            <Briefcase className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500 pointer-events-none" />
            <input
              type="text"
              className="input pl-10"
              placeholder="Job title (e.g. React Developer)"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              required
              disabled={isScraping}
            />
          </div>

          <LocationInput
            value={location}
            onChange={setLocation}
            disabled={isScraping}
          />
        </div>

        <button
          type="submit"
          disabled={isScraping || !jobTitle.trim() || connectedPlatforms.length === 0}
          className="btn-primary w-full sm:w-auto justify-center px-8 py-3"
        >
          {isScraping ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Scraping…
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              Scrape Jobs
            </>
          )}
        </button>
      </form>
    </div>
  )
}
