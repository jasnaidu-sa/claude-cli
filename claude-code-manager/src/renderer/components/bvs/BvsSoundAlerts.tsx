/**
 * BVS Sound Alerts
 *
 * F6.11 - Sound Alerts (optional audio for key events)
 * Provides audio feedback for important BVS events:
 * - Section completed
 * - Quality gate passed/failed
 * - Checkpoint reached
 * - Session completed
 * - Error occurred
 */

import React, { useEffect, useRef, useCallback, useState } from 'react'

// ============================================================================
// Types
// ============================================================================

export type SoundType =
  | 'section_complete'
  | 'gate_passed'
  | 'gate_failed'
  | 'checkpoint'
  | 'session_complete'
  | 'error'
  | 'notification'

export interface SoundAlertSettings {
  enabled: boolean
  volume: number // 0-1
  sounds: Record<SoundType, boolean>
}

interface BvsSoundAlertsProps {
  settings: SoundAlertSettings
  onSettingsChange: (settings: SoundAlertSettings) => void
}

// ============================================================================
// Default Settings
// ============================================================================

export const DEFAULT_SOUND_SETTINGS: SoundAlertSettings = {
  enabled: true,
  volume: 0.5,
  sounds: {
    section_complete: true,
    gate_passed: true,
    gate_failed: true,
    checkpoint: true,
    session_complete: true,
    error: true,
    notification: false,
  },
}

// ============================================================================
// Sound URLs (using Web Audio API synthesis)
// ============================================================================

// Note: In production, these would be actual audio file URLs
// For now, we'll use Web Audio API to generate tones

// ============================================================================
// Sound Alert Service (singleton)
// ============================================================================

class SoundAlertService {
  private audioContext: AudioContext | null = null
  private settings: SoundAlertSettings = DEFAULT_SOUND_SETTINGS

  setSettings(settings: SoundAlertSettings): void {
    this.settings = settings
  }

  async play(type: SoundType): Promise<void> {
    if (!this.settings.enabled || !this.settings.sounds[type]) {
      return
    }

    // Lazy initialize AudioContext (requires user interaction first)
    if (!this.audioContext) {
      this.audioContext = new AudioContext()
    }

    const ctx = this.audioContext

    // Create oscillator for different sound types
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)

    // Set initial volume
    gainNode.gain.setValueAtTime(this.settings.volume, ctx.currentTime)

    // Configure sound based on type
    switch (type) {
      case 'section_complete':
        // Pleasant ascending tone
        oscillator.frequency.setValueAtTime(440, ctx.currentTime) // A4
        oscillator.frequency.setValueAtTime(554, ctx.currentTime + 0.1) // C#5
        oscillator.frequency.setValueAtTime(659, ctx.currentTime + 0.2) // E5
        gainNode.gain.setValueAtTime(this.settings.volume, ctx.currentTime)
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)
        oscillator.start(ctx.currentTime)
        oscillator.stop(ctx.currentTime + 0.4)
        break

      case 'gate_passed':
        // Short success chime
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(880, ctx.currentTime) // A5
        oscillator.frequency.setValueAtTime(1100, ctx.currentTime + 0.1)
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2)
        oscillator.start(ctx.currentTime)
        oscillator.stop(ctx.currentTime + 0.2)
        break

      case 'gate_failed':
        // Descending failure tone
        oscillator.type = 'triangle'
        oscillator.frequency.setValueAtTime(400, ctx.currentTime)
        oscillator.frequency.setValueAtTime(300, ctx.currentTime + 0.1)
        oscillator.frequency.setValueAtTime(200, ctx.currentTime + 0.2)
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
        oscillator.start(ctx.currentTime)
        oscillator.stop(ctx.currentTime + 0.3)
        break

      case 'checkpoint':
        // Attention-getting double beep
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(800, ctx.currentTime)
        gainNode.gain.setValueAtTime(this.settings.volume, ctx.currentTime)
        gainNode.gain.setValueAtTime(0, ctx.currentTime + 0.1)
        gainNode.gain.setValueAtTime(this.settings.volume, ctx.currentTime + 0.15)
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25)
        oscillator.start(ctx.currentTime)
        oscillator.stop(ctx.currentTime + 0.25)
        break

      case 'session_complete':
        // Victory fanfare
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(523, ctx.currentTime) // C5
        oscillator.frequency.setValueAtTime(659, ctx.currentTime + 0.15) // E5
        oscillator.frequency.setValueAtTime(784, ctx.currentTime + 0.3) // G5
        oscillator.frequency.setValueAtTime(1047, ctx.currentTime + 0.45) // C6
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6)
        oscillator.start(ctx.currentTime)
        oscillator.stop(ctx.currentTime + 0.6)
        break

      case 'error':
        // Error buzz
        oscillator.type = 'sawtooth'
        oscillator.frequency.setValueAtTime(150, ctx.currentTime)
        gainNode.gain.setValueAtTime(this.settings.volume * 0.5, ctx.currentTime)
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
        oscillator.start(ctx.currentTime)
        oscillator.stop(ctx.currentTime + 0.3)
        break

      case 'notification':
        // Soft notification ping
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(600, ctx.currentTime)
        gainNode.gain.setValueAtTime(this.settings.volume * 0.3, ctx.currentTime)
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15)
        oscillator.start(ctx.currentTime)
        oscillator.stop(ctx.currentTime + 0.15)
        break
    }
  }

  async test(type: SoundType): Promise<void> {
    const originalEnabled = this.settings.enabled
    const originalTypeEnabled = this.settings.sounds[type]

    // Temporarily enable
    this.settings.enabled = true
    this.settings.sounds[type] = true

    await this.play(type)

    // Restore
    this.settings.enabled = originalEnabled
    this.settings.sounds[type] = originalTypeEnabled
  }
}

// Singleton instance
export const soundAlertService = new SoundAlertService()

// ============================================================================
// Hook for using sound alerts
// ============================================================================

export function useSoundAlerts(settings: SoundAlertSettings) {
  useEffect(() => {
    soundAlertService.setSettings(settings)
  }, [settings])

  const playSound = useCallback((type: SoundType) => {
    soundAlertService.play(type)
  }, [])

  const testSound = useCallback((type: SoundType) => {
    soundAlertService.test(type)
  }, [])

  return { playSound, testSound }
}

// ============================================================================
// Sound Settings UI
// ============================================================================

export function BvsSoundSettings({
  settings,
  onSettingsChange,
}: BvsSoundAlertsProps) {
  const { testSound } = useSoundAlerts(settings)

  const soundTypes: { type: SoundType; label: string; description: string }[] = [
    { type: 'section_complete', label: 'Section Complete', description: 'When a section finishes processing' },
    { type: 'gate_passed', label: 'Quality Gate Passed', description: 'When all checks pass' },
    { type: 'gate_failed', label: 'Quality Gate Failed', description: 'When checks fail' },
    { type: 'checkpoint', label: 'Checkpoint Reached', description: 'When user action is needed' },
    { type: 'session_complete', label: 'Session Complete', description: 'When all work is done' },
    { type: 'error', label: 'Error', description: 'When an error occurs' },
    { type: 'notification', label: 'Notifications', description: 'General notifications' },
  ]

  const handleToggle = (type: SoundType) => {
    onSettingsChange({
      ...settings,
      sounds: {
        ...settings.sounds,
        [type]: !settings.sounds[type],
      },
    })
  }

  const handleVolumeChange = (volume: number) => {
    onSettingsChange({
      ...settings,
      volume,
    })
  }

  const handleMasterToggle = () => {
    onSettingsChange({
      ...settings,
      enabled: !settings.enabled,
    })
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        🔊 Sound Alerts
      </h3>

      {/* Master Toggle */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
        <div>
          <div className="font-medium text-gray-900 dark:text-white">
            Enable Sound Alerts
          </div>
          <div className="text-sm text-gray-500">
            Play audio feedback for BVS events
          </div>
        </div>
        <button
          onClick={handleMasterToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            settings.enabled ? 'bg-blue-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              settings.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Volume Slider */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Volume: {Math.round(settings.volume * 100)}%
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={settings.volume}
          onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
          disabled={!settings.enabled}
          className="w-full"
        />
      </div>

      {/* Individual Sound Toggles */}
      <div className="space-y-3">
        {soundTypes.map(({ type, label, description }) => (
          <div
            key={type}
            className={`flex items-center justify-between p-3 rounded-lg ${
              settings.enabled ? 'bg-gray-50 dark:bg-gray-750' : 'opacity-50'
            }`}
          >
            <div className="flex-1">
              <div className="font-medium text-gray-900 dark:text-white text-sm">
                {label}
              </div>
              <div className="text-xs text-gray-500">{description}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => testSound(type)}
                disabled={!settings.enabled}
                className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50"
              >
                Test
              </button>
              <button
                onClick={() => handleToggle(type)}
                disabled={!settings.enabled}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  settings.sounds[type] ? 'bg-blue-600' : 'bg-gray-300'
                } disabled:opacity-50`}
              >
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                    settings.sounds[type] ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default BvsSoundSettings
