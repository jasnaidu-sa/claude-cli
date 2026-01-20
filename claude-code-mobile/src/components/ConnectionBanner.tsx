import React, { useEffect, useRef } from 'react'
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native'
import { useConnectionStore } from '../stores/connection-store'

interface ConnectionBannerProps {
  onReconnect?: () => void
}

export function ConnectionBanner({ onReconnect }: ConnectionBannerProps) {
  const { isConnected, isConnecting, connectionQuality, error, ping } = useConnectionStore()
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    // Show banner when disconnected or connecting
    const shouldShow = !isConnected || isConnecting || error

    Animated.timing(opacity, {
      toValue: shouldShow ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start()
  }, [isConnected, isConnecting, error])

  const handleReconnect = async () => {
    if (onReconnect) {
      onReconnect()
    } else {
      await ping()
    }
  }

  if (isConnected && !error) {
    // Show brief quality indicator for poor connections
    if (connectionQuality === 'poor') {
      return (
        <View style={styles.warningBanner}>
          <Text style={styles.warningIcon}>⚠</Text>
          <Text style={styles.warningText}>Slow connection</Text>
        </View>
      )
    }
    return null
  }

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      {isConnecting ? (
        <View style={styles.connectingBanner}>
          <Text style={styles.connectingIcon}>◌</Text>
          <Text style={styles.connectingText}>Connecting...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorBanner}>
          <View style={styles.errorContent}>
            <Text style={styles.errorIcon}>⚠</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
          <TouchableOpacity style={styles.retryButton} onPress={handleReconnect}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : !isConnected ? (
        <View style={styles.offlineBanner}>
          <View style={styles.offlineContent}>
            <Text style={styles.offlineIcon}>○</Text>
            <Text style={styles.offlineText}>Offline</Text>
          </View>
          <TouchableOpacity style={styles.reconnectButton} onPress={handleReconnect}>
            <Text style={styles.reconnectText}>Reconnect</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  connectingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(59, 130, 246, 0.2)',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  connectingIcon: {
    color: '#3b82f6',
    fontSize: 14,
    marginRight: 8,
  },
  connectingText: {
    color: '#3b82f6',
    fontSize: 13,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(239, 68, 68, 0.2)',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  errorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  errorIcon: {
    color: '#ef4444',
    fontSize: 14,
    marginRight: 8,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    flex: 1,
  },
  retryButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 12,
    marginLeft: 8,
  },
  retryText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(107, 114, 128, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(107, 114, 128, 0.2)',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  offlineContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  offlineIcon: {
    color: '#6b7280',
    fontSize: 14,
    marginRight: 8,
  },
  offlineText: {
    color: '#6b7280',
    fontSize: 13,
  },
  reconnectButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
    borderRadius: 12,
  },
  reconnectText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245, 158, 11, 0.2)',
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  warningIcon: {
    color: '#f59e0b',
    fontSize: 12,
    marginRight: 6,
  },
  warningText: {
    color: '#f59e0b',
    fontSize: 12,
  },
})
