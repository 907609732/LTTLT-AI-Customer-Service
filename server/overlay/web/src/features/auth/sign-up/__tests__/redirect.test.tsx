import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { SignUp } from '@/features/auth/sign-up'
import { Route } from '@/routes/(auth)/sign-up'

const fixture = vi.hoisted(() => ({
  redirect: '/lingtu/device?user_code=ABCD-EFGH',
  user: null as null | { id: number },
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
  // The sign-up route only relies on the factory shape and a throwable redirect control object,
  // so the guard can be exercised without a real router instance.
  createFileRoute: () => (options: unknown) => ({ options }),
  redirect: (options: { href?: string; replace?: boolean }) => ({ ...options }),
}))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ auth: { user: fixture.user } }) },
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
afterEach(() => {
  cleanup()
  fixture.user = null
})

type BeforeLoad = (context: {
  search: { redirect?: string }
}) => Promise<unknown>
const beforeLoad = Route.options.beforeLoad as unknown as BeforeLoad

it('passes the device approval redirect to the sign-in link and registration form', () => {
  render(<SignUp />)
  const redirect = fixture.redirect
  expect(
    screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')
  ).toBe(linkHref('/sign-in', { redirect }))
  expect(screen.getByTestId('sign-up-redirect').textContent).toBe(redirect)
})

it('sends a signed-in visitor back to the internal device approval target', async () => {
  fixture.user = { id: 1 }
  const error = await beforeLoad({
    search: { redirect: fixture.redirect },
  }).catch((thrown: unknown) => thrown)
  expect((error as { href?: string }).href).toBe(fixture.redirect)
})

it('falls back to the dashboard when the requested destination is external', async () => {
  fixture.user = { id: 1 }
  const error = await beforeLoad({
    search: { redirect: 'https://attacker.example/steal' },
  }).catch((thrown: unknown) => thrown)
  expect((error as { href?: string }).href).toBe('/dashboard')
})
