import {useTranslation} from 'react-i18next'
import {Alert, AlertDescription} from '@/components/ui/alert'

export const emailRegistrationUnavailableMessage='Email registration is unavailable. Ask an administrator to configure email service; existing administrators should sign in directly.'

export function EmailRegistrationUnavailable(){
 const {t}=useTranslation()
 return <Alert role='status'><AlertDescription>{t(emailRegistrationUnavailableMessage)}</AlertDescription></Alert>
}
