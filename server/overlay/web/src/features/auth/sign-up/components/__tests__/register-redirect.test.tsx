import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { SignUpForm } from '@/features/auth/sign-up/components/sign-up-form'

const mocks = vi.hoisted(() => ({
  redirectToLogin: vi.fn(),
  handleLoginResult: vi.fn(async () => true),
  register: vi.fn(async () => ({ success: true })),
  wechatLoginByCode: vi.fn(async () => ({ success: true, data: { id: 7 } })),
  status: { email_verification: true, wechat_login: false },
}))
vi.mock('@/features/auth/hooks/use-auth-redirect', () => ({
  useAuthRedirect: () => ({
    redirectToLogin: mocks.redirectToLogin,
    handleLoginResult: mocks.handleLoginResult,
  }),
}))
// The provider row is replaced by a probe so the redirect prop and the WeChat entry can be
// asserted without loading the real OAuth provider list.
vi.mock('@/features/auth/components/oauth-providers', () => ({
  OAuthProviders: ({
    redirectTo,
    onWeChatLogin,
  }: {
    redirectTo?: string
    onWeChatLogin?: () => void
  }) => (
    <div>
      <output data-testid='oauth-redirect'>{redirectTo ?? ''}</output>
      <button type='button' onClick={onWeChatLogin}>
        WeChat
      </button>
    </div>
  ),
}))
vi.mock('@/features/auth/hooks/use-email-verification', () => ({
  useEmailVerification: () => ({
    isSending: false,
    secondsLeft: 0,
    isActive: false,
    sendCode: vi.fn(async () => false),
  }),
}))
vi.mock('@/features/auth/hooks/use-turnstile', () => ({
  useTurnstile: () => ({
    isTurnstileEnabled: false,
    turnstileSiteKey: '',
    turnstileToken: '',
    setTurnstileToken: vi.fn(),
    validateTurnstile: () => true,
  }),
}))
vi.mock('@/features/auth/api', () => ({
  register: mocks.register,
  wechatLoginByCode: mocks.wechatLoginByCode,
}))
vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: mocks.status }),
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.status = { email_verification: true, wechat_login: false }
})

it('returns first-time device approvers to the sign-in page with the approval redirect', async () => {
  const redirect = '/lingtu/device?user_code=ABCD-EFGH'
  render(<SignUpForm redirectTo={redirect} />)
  fireEvent.change(screen.getByLabelText('Username'), {
    target: { value: 'new-owner' },
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'correct-horse-battery-staple' },
  })
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'correct-horse-battery-staple' },
  })
  fireEvent.change(screen.getByLabelText('Email (required for verification)'), {
    target: { value: 'owner@example.com' },
  })
  fireEvent.change(screen.getByPlaceholderText('Verification code'), {
    target: { value: '123456' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
  await waitFor(() =>
    expect(mocks.redirectToLogin).toHaveBeenCalledWith(redirect)
  )
  expect(mocks.register).toHaveBeenCalledTimes(1)
})

it('forwards the approval redirect to the OAuth providers and the WeChat login result', async () => {
  mocks.status = { email_verification: true, wechat_login: true }
  const redirect = '/lingtu/device?user_code=ABCD-EFGH'
  render(<SignUpForm redirectTo={redirect} />)

  expect(screen.getByTestId('oauth-redirect').textContent).toBe(redirect)

  fireEvent.click(screen.getByRole('button', { name: 'WeChat' }))
  fireEvent.change(screen.getByLabelText('Verification code'), {
    target: { value: '654321' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

  await waitFor(() =>
    expect(mocks.wechatLoginByCode).toHaveBeenCalledWith('654321')
  )
  await waitFor(() =>
    expect(mocks.handleLoginResult).toHaveBeenCalledWith({ id: 7 }, redirect)
  )
})
