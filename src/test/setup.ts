import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { vi } from 'vitest'

if (typeof window !== 'undefined') window.scrollTo = vi.fn()
