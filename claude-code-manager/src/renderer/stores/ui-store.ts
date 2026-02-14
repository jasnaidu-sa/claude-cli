import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type ViewMode = 'grid' | 'single'
type Panel = 'files' | 'browser' | 'settings' | 'worktrees' | 'autonomous' | 'ideas' | 'bvs' | 'whatsapp' | 'telegram'
type Theme = 'light' | 'dark' | 'system'

interface UIState {
  viewMode: ViewMode
  sidebarOpen: boolean
  activePanel: Panel | null
  browserUrl: string
  showNewSessionModal: boolean
  gridColumns: number
  theme: Theme
  selectedFile: { path: string; content: string } | null

  // Actions
  setViewMode: (mode: ViewMode) => void
  toggleSidebar: () => void
  setActivePanel: (panel: Panel | null) => void
  setBrowserUrl: (url: string) => void
  setShowNewSessionModal: (show: boolean) => void
  setGridColumns: (cols: number) => void
  setTheme: (theme: Theme) => void
  setSelectedFile: (file: { path: string; content: string } | null) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      viewMode: 'grid',
      sidebarOpen: true,
      activePanel: 'files',
      browserUrl: 'https://claude.ai',
      showNewSessionModal: false,
      gridColumns: 2,
      theme: 'dark',
      selectedFile: null,

      setViewMode: (viewMode) => set({ viewMode }),

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      setActivePanel: (activePanel) => set({ activePanel }),

      setBrowserUrl: (browserUrl) => set({ browserUrl }),

      setShowNewSessionModal: (showNewSessionModal) => set({ showNewSessionModal }),

      setGridColumns: (gridColumns) => set({ gridColumns }),

      setTheme: (theme) => {
        // Apply theme to document
        const root = document.documentElement
        if (theme === 'system') {
          const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
          root.classList.toggle('dark', prefersDark)
        } else {
          root.classList.toggle('dark', theme === 'dark')
        }
        set({ theme })
      },

      setSelectedFile: (selectedFile) => set({ selectedFile })
    }),
    {
      name: 'ui-store',
      partialize: (state) => ({
        gridColumns: state.gridColumns,
        theme: state.theme,
        sidebarOpen: state.sidebarOpen
      })
    }
  )
)
