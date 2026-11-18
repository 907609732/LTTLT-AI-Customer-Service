import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { SignIn } from '@/features/auth/sign-in'

const fixture = vi.hoisted(() => ({ redirect: '/lingtu/admin' }))
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
vi.mock('@/features/auth/sign-in/components/user-auth-form', () => ({
  UserAuthForm: () => null,
}))
afterEach(() => cleanup())

it('explains setup administrator credentials without offering signup for the exact admin entry', () => {
  fixture.redirect = '/lingtu/admin'
  render(<SignIn />)
  expect(
    screen.getByText(
      'Sign in with the administrator username and password created during setup. No new registration or email verification is required.'
    )
  ).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Sign up' })).toBeNull()
})

it('preserves the requested sign-in destination on ordinary signup links', () => {
  for (const redirect of [
    '',
    '/console',
    '/lingtu/admin?tab=accounts',
    '/lingtu/device?user_code=ABCD-EFGH',
  ]) {
    fixture.redirect = redirect
    const view = render(<SignIn />)
    expect(
      screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')
    ).toBe(linkHref('/sign-up', { redirect }))
    expect(
      screen.queryByText(
        'Sign in with the administrator username and password created during setup. No new registration or email verification is required.'
      )
    ).toBeNull()
    view.unmount()
  }
})
