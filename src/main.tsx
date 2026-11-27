import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { en, t } from './i18n'

document.documentElement.lang = en ? 'en' : 'zh-CN'
document.title = t('RealOpenSnow · 我的雪场', 'RealOpenSnow · My resorts')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
