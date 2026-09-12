import { useState } from 'react'
import { X, Palette, Monitor, Sun, Moon, Check } from 'lucide-react'
import { useThemeStore, ACCENT_PRESETS } from '../stores/themeStore'

interface SettingsPanelProps {
  onClose: () => void
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { mode, accentColor, density, setMode, setAccentColor, setDensity } = useThemeStore()
  const [customColor, setCustomColor] = useState(accentColor)

  const handleCustomColorChange = (color: string) => {
    setCustomColor(color)
    // 验证 HEX 格式
    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
      setAccentColor(color)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-l2 w-[500px] max-h-[80vh] overflow-y-auto">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Palette size={20} />
            外观设置
          </h2>
          <button
            onClick={onClose}
            className="btn-icon-sm hover:bg-overlay-lighter rounded-md p-1.5 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-6 space-y-6">
          {/* 主题模式 */}
          <div>
            <label className="text-sm font-medium mb-3 block">主题模式</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'light', label: '浅色', icon: Sun },
                { value: 'dark', label: '深色', icon: Moon },
                { value: 'system', label: '系统', icon: Monitor },
              ] as const).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  className={`
                    flex flex-col items-center gap-2 p-3 rounded-lg border transition-all
                    ${mode === value
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border hover:border-border-hover hover:bg-overlay-lighter'
                    }
                  `}
                >
                  <Icon size={20} />
                  <span className="text-xs">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 强调色 */}
          <div>
            <label className="text-sm font-medium mb-3 block">强调色</label>
            <div className="grid grid-cols-6 gap-2 mb-3">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.color}
                  onClick={() => setAccentColor(preset.color)}
                  className={`
                    relative w-full aspect-square rounded-lg border-2 transition-all
                    ${accentColor === preset.color
                      ? 'border-white scale-110'
                      : 'border-transparent hover:scale-105'
                    }
                  `}
                  style={{ backgroundColor: preset.color }}
                  title={preset.name}
                >
                  {accentColor === preset.color && (
                    <Check size={16} className="absolute inset-0 m-auto text-white" />
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customColor}
                onChange={(e) => handleCustomColorChange(e.target.value)}
                placeholder="#7c6ef0"
                className="flex-1 px-3 py-2 text-sm bg-overlay-lighter border border-border rounded-md focus:outline-none focus:border-accent"
              />
              <div
                className="w-10 h-10 rounded-md border border-border"
                style={{ backgroundColor: customColor }}
              />
            </div>
          </div>

          {/* 界面密度 */}
          <div>
            <label className="text-sm font-medium mb-3 block">界面密度</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'compact', label: '紧凑', desc: '更小间距，更多內容' },
                { value: 'comfortable', label: '舒适', desc: '默认间距' },
                { value: 'spacious', label: '宽松', desc: '更大间距，更放松' },
              ] as const).map(({ value, label, desc }) => (
                <button
                  key={value}
                  onClick={() => setDensity(value)}
                  className={`
                    flex flex-col items-start p-3 rounded-lg border transition-all text-left
                    ${density === value
                      ? 'border-accent bg-accent/10'
                      : 'border-border hover:border-border-hover hover:bg-overlay-lighter'
                    }
                  `}
                >
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-xs text-text-muted mt-1">{desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div className="p-4 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
