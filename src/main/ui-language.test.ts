import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mock = vi.hoisted(() => ({ path: '', languages: ['en-US'], languageReadFails: false, handlers: new Map<string, (...args: unknown[]) => unknown>(), menu: vi.fn() }))
vi.mock('electron', () => ({
  app: {
    getPath: () => mock.path,
    getLocale: () => 'en-US',
    getPreferredSystemLanguages: () => {
      if (mock.languageReadFails) throw new Error('System language unavailable')
      return mock.languages
    }
  },
  ipcMain: { handle: (name: string, callback: (...args: unknown[]) => unknown) => mock.handlers.set(name, callback) },
  Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu: mock.menu },
  shell: { openExternal: vi.fn() }
}))
import { initializeUiLanguage } from './ui-language'
import { getLocale, setLocale } from '../shared/i18n'

beforeEach(async () => {
  mock.path = await mkdtemp(join(tmpdir(), 'prism-language-test-'))
  mock.languages = ['en-US']; mock.languageReadFails = false; mock.handlers.clear(); mock.menu.mockClear()
})
afterEach(async () => { await rm(mock.path, { recursive: true, force: true }); setLocale('zh-CN') })

it('uses the OS language on first run and recovers from a malformed preference', async () => {
  mock.languages = ['zh-Hant-TW', 'en-US']
  await initializeUiLanguage(); expect(getLocale()).toBe('zh-TW')
  await writeFile(join(mock.path, 'ui-language.json'), '{invalid')
  await initializeUiLanguage(); expect(getLocale()).toBe('zh-TW')
})

it.each([
  ['zh-Hans-CN', 'zh-CN'], ['zh-Hant-HK', 'zh-TW'], ['en-GB', 'en'],
  ['ru-RU', 'ru'], ['vi-VN', 'vi'], ['th-TH', 'th'], ['pt-PT', 'pt-BR'],
  ['fr-FR', 'fr'], ['uk-UA', 'uk'], ['es-MX', 'es'], ['tr-TR', 'tr'],
  ['ja-JP', 'ja'], ['hi-IN', 'hi'], ['de-DE', 'en'], ['ko-KR', 'en'], ['', 'en']
])('matches the primary system language %s to %s, independently of the app locale', async (systemLanguage, expected) => {
  mock.languages = [systemLanguage, 'ru-RU']
  await initializeUiLanguage()
  expect(getLocale()).toBe(expected)
})

it('uses English when the OS language list is empty or cannot be read', async () => {
  mock.languages = []
  await initializeUiLanguage(); expect(getLocale()).toBe('en')
  mock.languageReadFails = true
  await initializeUiLanguage(); expect(getLocale()).toBe('en')
})

it('follows system language changes until the user saves an explicit choice', async () => {
  mock.languages = ['ja-JP']
  await initializeUiLanguage(); expect(getLocale()).toBe('ja')
  mock.languages = ['fr-FR']
  await initializeUiLanguage(); expect(getLocale()).toBe('fr')
  await mock.handlers.get('ui-language:set')!(null, 'ru')
  mock.languages = ['zh-CN']
  await initializeUiLanguage(); expect(getLocale()).toBe('ru')
})

it('persists explicit selection across startup and updates native menus', async () => {
  await initializeUiLanguage()
  await mock.handlers.get('ui-language:set')!(null, 'ru')
  expect(JSON.parse(await readFile(join(mock.path, 'ui-language.json'), 'utf8'))).toEqual({ locale: 'ru' })
  expect(mock.menu).toHaveBeenCalledTimes(2)
  setLocale('zh-CN'); await initializeUiLanguage()
  expect(mock.handlers.get('ui-language:get')!()).toBe('ru')
})

it('rejects unsupported locales and serializes rapid changes without touching vault settings', async () => {
  const sentinel = join(mock.path, 'settings.json')
  await writeFile(sentinel, 'profile settings must stay unchanged')
  await initializeUiLanguage()
  await expect(mock.handlers.get('ui-language:set')!(null, 'xx')).rejects.toThrow('Unsupported')
  await Promise.all(['fr', 'ja', 'hi'].map(locale => mock.handlers.get('ui-language:set')!(null, locale)))
  expect(getLocale()).toBe('hi')
  expect(JSON.parse(await readFile(join(mock.path, 'ui-language.json'), 'utf8'))).toEqual({ locale: 'hi' })
  expect(await readFile(sentinel, 'utf8')).toBe('profile settings must stay unchanged')
})
