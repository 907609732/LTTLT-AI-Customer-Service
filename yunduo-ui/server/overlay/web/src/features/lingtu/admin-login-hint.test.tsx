import type {ReactNode} from 'react'
import {cleanup, render, screen} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import {SignIn} from '@/features/auth/sign-in'

const fixture=vi.hoisted(()=>({redirect:'/lingtu/admin'}))
vi.mock('@tanstack/react-router',()=>({useSearch:()=>({redirect:fixture.redirect}),Link:({to,children}:{to:string;children:ReactNode})=><a href={to}>{children}</a>}))
vi.mock('@/hooks/use-status',()=>({useStatus:()=>({status:{register_enabled:true}})}))
vi.mock('@/features/auth/auth-layout',()=>({AuthLayout:({children}:{children:ReactNode})=><div>{children}</div>}))
vi.mock('@/features/auth/components/terms-footer',()=>({TermsFooter:()=>null}))
vi.mock('@/features/auth/sign-in/components/user-auth-form',()=>({UserAuthForm:()=>null}))
afterEach(()=>cleanup())

it('explains setup administrator credentials without offering signup for the exact admin entry',()=>{
 fixture.redirect='/lingtu/admin'
 render(<SignIn/>)
 expect(screen.getByText('Sign in with the administrator username and password created during setup. No new registration or email verification is required.')).toBeTruthy()
 expect(screen.queryByRole('link',{name:'Sign up'})).toBeNull()
})

it('preserves ordinary signup links for every other sign-in redirect',()=>{
 for(const redirect of ['', '/console', '/lingtu/admin?tab=accounts']){
  fixture.redirect=redirect
  const view=render(<SignIn/>)
  expect(screen.getByRole('link',{name:'Sign up'}).getAttribute('href')).toBe('/sign-up')
  expect(screen.queryByText('Sign in with the administrator username and password created during setup. No new registration or email verification is required.')).toBeNull()
  view.unmount()
 }
})
