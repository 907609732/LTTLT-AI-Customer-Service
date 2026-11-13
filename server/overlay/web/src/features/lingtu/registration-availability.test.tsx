import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import {SignUpForm} from '@/features/auth/sign-up/components/sign-up-form'
import {emailRegistrationUnavailableMessage} from './email-registration-unavailable'

const fixture=vi.hoisted(()=>({emailEnabled:false,register:vi.fn(async()=>({success:true})),oauth:vi.fn(),error:vi.fn()}))
vi.mock('@/hooks/use-status',()=>({useStatus:()=>({status:{email_verification:fixture.emailEnabled,oauth_register_enabled:true,custom_oauth_providers:[{slug:'lingtu-wechat',name:'WeChat'},{slug:'lingtu-dingtalk',name:'DingTalk'}]}})}))
vi.mock('@/features/auth/hooks/use-auth-redirect',()=>({useAuthRedirect:()=>({redirectToLogin:vi.fn(),handleLoginResult:vi.fn()})}))
vi.mock('@/features/auth/hooks/use-oauth-login',()=>({useOAuthLogin:()=>({isLoading:false,handleCustomOAuthLogin:fixture.oauth})}))
vi.mock('@/features/auth/api',()=>({register:fixture.register,wechatLoginByCode:vi.fn(),sendEmailVerification:vi.fn()}))
vi.mock('sonner',()=>({toast:{error:fixture.error,success:vi.fn(),info:vi.fn()}}))
afterEach(()=>{cleanup();fixture.emailEnabled=false;vi.clearAllMocks()})

it('hides unavailable email registration and preserves configured native OAuth buttons',()=>{
 render(<SignUpForm aria-label='registration'/>)
 expect(screen.getByRole('status').textContent).toBe(emailRegistrationUnavailableMessage)
 expect(screen.queryByLabelText('Username')).toBeNull()
 expect(screen.queryByRole('button',{name:'Create account'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Continue with WeChat'}))
 fireEvent.click(screen.getByRole('button',{name:'Continue with DingTalk'}))
 expect(fixture.oauth).toHaveBeenCalledTimes(2)
 expect(fixture.register).not.toHaveBeenCalled()
})

it('blocks programmatic submission after email registration becomes unavailable',async()=>{
 fixture.emailEnabled=true
 const view=render(<SignUpForm aria-label='registration'/>)
 fireEvent.change(screen.getByLabelText('Username'),{target:{value:'fixture-user'}})
 fireEvent.change(screen.getByLabelText('Password'),{target:{value:'fixture-password-123'}})
 fireEvent.change(screen.getByLabelText('Confirm password'),{target:{value:'fixture-password-123'}})
 fixture.emailEnabled=false
 view.rerender(<SignUpForm aria-label='registration'/>)
 fireEvent.submit(screen.getByRole('form',{name:'registration'}))
 await waitFor(()=>expect(fixture.error).toHaveBeenCalledWith(emailRegistrationUnavailableMessage))
 expect(fixture.register).not.toHaveBeenCalled()
})

it('still requires email and verification code when email registration is enabled',async()=>{
 fixture.emailEnabled=true
 render(<SignUpForm aria-label='registration'/>)
 fireEvent.change(screen.getByLabelText('Username'),{target:{value:'fixture-user'}})
 fireEvent.change(screen.getByLabelText('Password'),{target:{value:'fixture-password-123'}})
 fireEvent.change(screen.getByLabelText('Confirm password'),{target:{value:'fixture-password-123'}})
 fireEvent.submit(screen.getByRole('form',{name:'registration'}))
 await waitFor(()=>expect(fixture.error).toHaveBeenCalledWith('Please enter your email'))
 fireEvent.change(screen.getByLabelText('Email (required for verification)'),{target:{value:'fixture@example.test'}})
 fireEvent.submit(screen.getByRole('form',{name:'registration'}))
 await waitFor(()=>expect(fixture.error).toHaveBeenCalledWith('Please enter the verification code'))
 fireEvent.change(screen.getByPlaceholderText('Verification code'),{target:{value:'123456'}})
 fireEvent.submit(screen.getByRole('form',{name:'registration'}))
 await waitFor(()=>expect(fixture.register).toHaveBeenCalledWith(expect.objectContaining({email:'fixture@example.test',verification_code:'123456'})))
 expect(screen.getByPlaceholderText('Enter password (15–128 characters)')).toBeTruthy()
})
