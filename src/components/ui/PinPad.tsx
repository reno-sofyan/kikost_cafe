import { Icon } from '@/components/ui/Icon'

interface PinPadProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  maxLength?: number
  disabled?: boolean
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const

export function PinPad({ value, onChange, onSubmit, maxLength = 8, disabled }: PinPadProps) {
  function pressKey(key: string) {
    if (disabled) return
    if (key === 'del') {
      onChange(value.slice(0, -1))
      return
    }
    if (key === '') return
    if (value.length >= maxLength) return
    onChange(value + key)
  }

  return (
    <div className="mx-auto grid w-full max-w-xs grid-cols-3 gap-3">
      {KEYS.map((key, index) => {
        if (key === '') return <div key={`spacer-${index}`} />
        return (
          <button
            key={key}
            type="button"
            onClick={() => pressKey(key)}
            disabled={disabled}
            className="numpad-key"
          >
            {key === 'del' ? <Icon name="backspace" size={22} className="mx-auto" /> : key}
          </button>
        )
      })}
      <div className="col-span-3 mt-2">
        <button type="button" onClick={onSubmit} disabled={disabled || value.length < 4} className="btn-primary w-full">
          Masuk
        </button>
      </div>
    </div>
  )
}
