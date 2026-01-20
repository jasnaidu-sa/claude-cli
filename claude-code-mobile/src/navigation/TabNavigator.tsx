import React from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export type TabRoute = 'dashboard' | 'sessions' | 'ideas' | 'files' | 'settings'

interface TabItem {
  key: TabRoute
  label: string
  icon: string
  activeIcon: string
}

const TABS: TabItem[] = [
  { key: 'dashboard', label: 'Home', icon: '○', activeIcon: '●' },
  { key: 'sessions', label: 'Sessions', icon: '▷', activeIcon: '▶' },
  { key: 'ideas', label: 'Ideas', icon: '◇', activeIcon: '◆' },
  { key: 'files', label: 'Files', icon: '☐', activeIcon: '☑' },
  { key: 'settings', label: 'Settings', icon: '⚙', activeIcon: '⚙' },
]

interface TabNavigatorProps {
  currentTab: TabRoute
  onTabChange: (tab: TabRoute) => void
  badges?: Partial<Record<TabRoute, number>>
}

export function TabNavigator({ currentTab, onTabChange, badges = {} }: TabNavigatorProps) {
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {TABS.map((tab) => {
        const isActive = currentTab === tab.key
        const badge = badges[tab.key]

        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            onPress={() => onTabChange(tab.key)}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainer}>
              <Text style={[styles.icon, isActive && styles.iconActive]}>
                {isActive ? tab.activeIcon : tab.icon}
              </Text>
              {badge !== undefined && badge > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {badge > 99 ? '99+' : badge}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#222',
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  iconContainer: {
    position: 'relative',
    marginBottom: 2,
  },
  icon: {
    fontSize: 20,
    color: '#666',
  },
  iconActive: {
    color: '#3b82f6',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  label: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  labelActive: {
    color: '#3b82f6',
    fontWeight: '500',
  },
})
