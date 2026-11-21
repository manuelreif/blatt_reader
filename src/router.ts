import { useEffect, useState } from 'react'

export type Route =
  | { name: 'library' }
  | { name: 'read'; bookId: string; cfi?: string }
  | { name: 'vocab'; termId?: string }
  | { name: 'quiz' }
  | { name: 'enrich' }
  | { name: 'settings' }

export function parseHash(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
  const params = new URLSearchParams(query)
  switch (parts[0]) {
    case 'read':
      return parts[1] ? { name: 'read', bookId: parts[1], cfi: params.get('cfi') ?? undefined } : { name: 'library' }
    case 'vocab':
      return { name: 'vocab', termId: parts[1] }
    case 'quiz':
      return { name: 'quiz' }
    case 'enrich':
      return { name: 'enrich' }
    case 'settings':
      return { name: 'settings' }
    default:
      return { name: 'library' }
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'read':
      return `#/read/${encodeURIComponent(route.bookId)}${route.cfi ? `?cfi=${encodeURIComponent(route.cfi)}` : ''}`
    case 'vocab':
      return route.termId ? `#/vocab/${encodeURIComponent(route.termId)}` : '#/vocab'
    case 'library':
      return '#/'
    default:
      return `#/${route.name}`
  }
}

export function navigate(route: Route) {
  location.hash = href(route)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash))
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return route
}
