import { webcrypto } from 'node:crypto'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { AdminBilling } from './admin-billing'

const { verify } = vi.hoisted(() => ({
  verify: vi.fn(async () => ({ proof_token: 'fixture-proof' })),
}))
vi.mock('@/features/auth/secure-verification', () => ({
  useSecureVerification: () => ({
    requestVerification: verify,
    dialogProps: {},
  }),
  SecureVerificationDialog: () => null,
}))
const originalAdapter = api.defaults.adapter
const originalAuth = useAuthStore.getState().auth
afterEach(() => {
  cleanup()
  api.defaults.adapter = originalAdapter
  useAuthStore.setState({ auth: originalAuth })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const config = {
  revision: 0,
  enabled: false,
  ready: false,
  reason: 'payment_not_configured',
  source: 'environment',
  mode: 'unconfigured',
  secret_key_configured: false,
  webhook_secret_configured: false,
  plans: [],
  service: { version: 'fixture-version', billing_protocol: 2 },
  webhook_path: '/api/lingtu/billing/stripe/webhook',
}
function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AdminBilling />
    </QueryClientProvider>
  )
}

it('requires explicitly entered prices, sends an exact proof and clears saved test credentials', async () => {
  vi.stubGlobal('crypto', webcrypto)
  useAuthStore.setState({
    auth: {
      ...useAuthStore.getState().auth,
      accessToken: 'fixture-access',
      accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
  })
  const posts: string[] = []
  api.defaults.adapter = async (request) => {
    const data =
      request.method === 'post'
        ? (() => {
            posts.push(String(request.data))
            expect(request.headers.get('X-Security-Proof')).toBe(
              'fixture-proof'
            )
            return {
              saved: true,
              configuration: {
                ...config,
                revision: 1,
                source: 'database',
                secret_key_configured: true,
                webhook_secret_configured: true,
                plans: JSON.parse(String(request.data)).plans,
              },
            }
          })()
        : config
    return { data, status: 200, statusText: 'OK', headers: {}, config: request }
  }
  show()
  await screen.findByText('Merchant test configuration')
  expect(screen.queryByLabelText('Amount (fen)')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Add plan' }))
  expect(
    (screen.getByLabelText('Amount (fen)') as HTMLInputElement).value
  ).toBe('')
  for (const [label, value] of [
    ['Plan ID', 'sandbox'],
    ['Plan name', 'My sandbox'],
    ['Amount (fen)', '105'],
    ['Call allowance', '8'],
    ['Validity (days)', '3'],
    ['Stripe test secret key', 'sk_test_fixture_private'],
    ['Webhook signing secret', 'whsec_fixture_private'],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
  fireEvent.click(
    screen.getByRole('button', { name: 'Save test configuration' })
  )
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(JSON.parse(posts[0])).toMatchObject({
    section: 'billing',
    revision: 0,
    plans: [{ amount: 105, calls: 8, valid_days: 3 }],
  })
  await waitFor(() =>
    expect(
      (screen.getByLabelText('Stripe test secret key') as HTMLInputElement)
        .value
    ).toBe('')
  )
  expect(
    (screen.getByLabelText('Webhook signing secret') as HTMLInputElement).value
  ).toBe('')
  expect(
    screen.getByText(
      'Configuration saved. Merchant payment and webhook delivery are not verified.'
    )
  ).toBeTruthy()
})
it('reports a read-only merchant check separately from webhook and payment verification', async () => {
  const calls: string[] = []
  api.defaults.adapter = async (request) => {
    calls.push(`${request.method} ${request.url}`)
    return {
      data:
        request.method === 'post'
          ? {
              merchant: 'verified',
              mode: 'test',
              ledger: 'available',
              webhook: 'not_verified',
              payment: 'not_tested',
            }
          : { ...config, mode: 'test', secret_key_configured: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: request,
    }
  }
  show()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Check merchant connection' })
  )
  await screen.findByText(
    'Merchant account connection verified. Webhook delivery and payment remain untested.'
  )
  expect(calls).toContain('post /api/lingtu/admin/billing/check')
  expect(calls.some((call) => call.includes('/billing/orders'))).toBe(false)
  expect(screen.queryByText('Payment successful')).toBeNull()
})
