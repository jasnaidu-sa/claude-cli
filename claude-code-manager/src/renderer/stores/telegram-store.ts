/**
 * Zustand store for Telegram state in the renderer.
 */

import { create } from 'zustand'
import type { TelegramConnectionState, ChannelMessage, TelegramCallbackQuery, TelegramConfig } from '@shared/channel-types'

interface TelegramState {
  // Connection state
  connectionState: TelegramConnectionState
  setConnectionState: (state: TelegramConnectionState) => void

  // Messages (latest per chat)
  messages: ChannelMessage[]
  addMessage: (msg: ChannelMessage) => void
  clearMessages: () => void

  // Config
  config: TelegramConfig | null
  setConfig: (config: TelegramConfig) => void

  // Callback queries
  lastCallbackQuery: TelegramCallbackQuery | null
  setLastCallbackQuery: (query: TelegramCallbackQuery | null) => void

  // Channel router status
  routerStatus: Record<string, { registered: boolean; connected: boolean; primaryChatId: string | null }> | null
  setRouterStatus: (status: any) => void
}

export const useTelegramStore = create<TelegramState>((set) => ({
  connectionState: { status: 'disconnected' },
  setConnectionState: (state) => set({ connectionState: state }),

  messages: [],
  addMessage: (msg) =>
    set((state) => ({
      messages: [...state.messages.slice(-99), msg],
    })),
  clearMessages: () => set({ messages: [] }),

  config: null,
  setConfig: (config) => set({ config }),

  lastCallbackQuery: null,
  setLastCallbackQuery: (query) => set({ lastCallbackQuery: query }),

  routerStatus: null,
  setRouterStatus: (status) => set({ routerStatus: status }),
}))
