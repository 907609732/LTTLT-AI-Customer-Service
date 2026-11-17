import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { useAuthRedirect } from '@/features/auth/hooks/use-auth-redirect'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn(async () => {}) }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('keeps an internal device approval destination when returning to sign-in', () => {
  const { result } = renderHook(() => useAuthRedirect())
  act(() =>
    result.current.redirectToLogin('/lingtu/device?user_code=ABCD-EFGH')
  )
  expect(navigate).toHaveBeenCalledWith({
    to: '/sign-in',
    search: { redirect: '/lingtu/device?user_code=ABCD-EFGH' },
    replace: true,
  })
})

it('drops an external destination instead of forwarding an open redirect', () => {
  const { result } = renderHook(() => useAuthRedirect())
  act(() => result.current.redirectToLogin('https://attacker.example/steal'))
  expect(navigate).toHaveBeenCalledWith({
    to: '/sign-in',
    search: { redirect: undefined },
    replace: true,
  })
})
