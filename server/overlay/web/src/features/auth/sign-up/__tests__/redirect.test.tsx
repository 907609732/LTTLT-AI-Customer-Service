import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { SignUp } from '@/features/auth/sign-up'

const fixture = vi.hoisted(() => ({
  redirect: '/lingtu/device?user_code=ABCD-EFGH',
}))
function linkHref(to: string, search?: { redirect?: string }) {
  const redirect = search?.redirect
  return redirect ? `${to}?${new URLSearchParams({ redirect }).toString()}` : to
}
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({ redirect: fixture.redirect }),
  Link: ({
    to,
    search,
    children,
  }: {
    to: string
    search?: { redirect?: string }
    children: ReactNode
  }) => <a href={linkHref(to, search)}>{children}</a>,
}))
vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: { register_enabled: true } }),
}))
vi.mock('@/features/auth/auth-layout', () => ({
  AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/features/auth/components/terms-footer', () => ({
  TermsFooter: () => null,
}))
vi.mock('@/features/auth/sign-up/components/sign-up-form', () => ({
  SignUpForm: ({ redirectTo }: { redirectTo?: string }) => (
    <output data-testid='sign-up-redirect'>{redirectTo ?? ''}</output>
  ),
}))
afterEach(() => cleanup())

it('passes the device approval redirect to the sign-in link and registration form', () => {
  render(<SignUp />)
  const redirect = fixture.redirect
  expect(
    screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')
  ).toBe(linkHref('/sign-in', { redirect }))
  expect(screen.getByTestId('sign-up-redirect').textContent).toBe(redirect)
})
