import i18next from 'i18next'
import {afterEach,expect,it} from 'vitest'
import zh from '@/i18n/locales/zh.json'
import {getServerErrorMessage} from '@/lib/server-error-message'

const key='Too many requests. Please wait a moment and try again.'
afterEach(async()=>{await i18next.changeLanguage('en')})
it('translates rate limit responses instead of displaying the raw Axios status',async()=>{
 i18next.addResourceBundle('zhCN','translation',zh.translation,true,true)
 await i18next.changeLanguage('zhCN')
 const failure={isAxiosError:true,message:'Request failed with status code 429',response:{status:429,data:{success:false,error:'rate_limited',message_key:key,message:key}}}
 expect(getServerErrorMessage(failure)).toBe('请求过于频繁，请稍后再试。')
 expect(getServerErrorMessage(new Error('wrapper',{cause:failure}))).toBe('请求过于频繁，请稍后再试。')
 await i18next.changeLanguage('en')
 expect(getServerErrorMessage(failure)).toBe(key)
})
