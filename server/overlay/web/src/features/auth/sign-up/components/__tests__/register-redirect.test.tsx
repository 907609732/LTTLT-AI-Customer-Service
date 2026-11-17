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
  register: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/features/auth/hooks/use-auth-redirect', () => ({
  useAuthRedirect: () => ({
    redirectToLogin: mocks.redirectToLogin,
    handleLoginResult: vi.fn(async () => true),
  }),
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
  wechatLoginByCode: vi.fn(),
}))
vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: { email_verification: true } }),
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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
