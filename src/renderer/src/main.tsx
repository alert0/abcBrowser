import React, { useEffect, useSyncExternalStore } from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import zhTW from 'antd/locale/zh_TW'
import en from 'antd/locale/en_US'
import ru from 'antd/locale/ru_RU'
import vi from 'antd/locale/vi_VN'
import th from 'antd/locale/th_TH'
import ptBR from 'antd/locale/pt_BR'
import fr from 'antd/locale/fr_FR'
import uk from 'antd/locale/uk_UA'
import es from 'antd/locale/es_ES'
import tr from 'antd/locale/tr_TR'
import ja from 'antd/locale/ja_JP'
import hi from 'antd/locale/hi_IN'
import { getLocale, resolveLocale, setLocale, subscribeLocale } from '../../shared/i18n'
import App from './App'
import './styles.css'

function PrismApplication() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale)
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  return (
    <ConfigProvider
      locale={{ 'zh-CN': zhCN, 'zh-TW': zhTW, en, ru, vi, th, 'pt-BR': ptBR, fr, uk, es, tr, ja, hi }[locale]}
      theme={{
        token: {
          colorPrimary: '#5965e8',
          colorText: '#1f2430',
          borderRadius: 10,
          fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        },
        components: {
          Button: { controlHeight: 38 },
          Input: { controlHeight: 38 },
          Select: { controlHeight: 38 },
          Table: { headerBg: '#f8f9fc', headerColor: '#687083' }
        }
      }}
    >
      <App />
    </ConfigProvider>
  )
}

async function mount(): Promise<void> {
  const selected = await window.browserApi.uiLanguage.get().catch(() => 'en')
  setLocale(resolveLocale(selected))
  document.documentElement.lang = getLocale()
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><PrismApplication /></React.StrictMode>)
}
void mount()
