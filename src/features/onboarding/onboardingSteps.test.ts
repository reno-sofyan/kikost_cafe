import { afterEach, describe, expect, it } from 'vitest'
import { clearOnboardingDraft, loadOnboardingDraft, resumeStep, saveOnboardingDraft, stepAriaLabel, stepStatus, STEP_ORDER, TOTAL_MINUTES, type OnboardingDraft } from './onboardingSteps'

const DRAFT: OnboardingDraft = {
  step: 'fiscal',
  businessType: 'cafe_resto',
  withSampleCatalog: true,
  withKantinCategories: true,
  businessName: 'Kece Visual Coffee',
  address: 'Bandung',
  phone: '',
  logoDataUrl: null,
  taxPercent: 11,
  serviceChargePercent: 5,
  roundingIncrement: 100,
  transactionPrefix: 'TRX',
  qrisImageDataUrl: null,
  qrisMerchantName: '',
  receiptPaperSize: '58mm',
  printerType: 'browser',
  networkHost: '',
  networkPort: 9100,
  adminName: 'Reno',
}

afterEach(() => localStorage.clear())

describe('status langkah', () => {
  it('selesai, aktif, belum — dan teks pembaca layar', () => {
    expect(STEP_ORDER).toHaveLength(7)
    expect(stepStatus('welcome', 'fiscal')).toBe('done')
    expect(stepStatus('fiscal', 'fiscal')).toBe('active')
    expect(stepStatus('admin', 'fiscal')).toBe('todo')
    expect(stepAriaLabel('fiscal', 'fiscal')).toBe('Langkah 3 dari 7, Pajak & Biaya, sedang dikerjakan')
    expect(TOTAL_MINUTES).toBe(5)
  })
})

describe('draf progres', () => {
  it('melanjutkan dari langkah terakhir setelah dimuat ulang', () => {
    saveOnboardingDraft(DRAFT)
    expect(loadOnboardingDraft()).toEqual(DRAFT)
    clearOnboardingDraft()
    expect(loadOnboardingDraft()).toBeNull()
  })
  it('penyiapan yang terputus kembali ke akun admin; PIN tak pernah dibaca dari draf', () => {
    expect(resumeStep('finishing')).toBe('admin')
    localStorage.setItem('kione.onboardingDraft', JSON.stringify({ ...DRAFT, step: 'finishing', adminPin: '1234' }))
    const d = loadOnboardingDraft() as OnboardingDraft & { adminPin?: string }
    expect(d.step).toBe('admin')
    expect(d.adminPin).toBeUndefined()
  })
  it('draf rusak diabaikan', () => {
    localStorage.setItem('kione.onboardingDraft', '{rusak')
    expect(loadOnboardingDraft()).toBeNull()
  })
})
