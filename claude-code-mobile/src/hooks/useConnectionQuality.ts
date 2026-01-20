import { useState, useEffect, useCallback, useRef } from 'react'
import { useConnectionStore, ConnectionQuality } from '../stores/connection-store'

interface UseConnectionQualityReturn {
  quality: ConnectionQuality
  latency: number | null
  isOnline: boolean
  refresh: () => Promise<void>
}

// Thresholds for connection quality (in ms)
const QUALITY_THRESHOLDS = {
  excellent: 100,
  good: 300,
  fair: 600,
  poor: 1000,
}

export function useConnectionQuality(): UseConnectionQualityReturn {
  const { connectionQuality, lastPingTime, ping, isConnected } = useConnectionStore()
  const [latency, setLatency] = useState<number | null>(lastPingTime)
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Periodic ping to measure latency
  useEffect(() => {
    if (isConnected) {
      // Initial ping
      measureLatency()

      // Set up interval (every 30 seconds)
      pingIntervalRef.current = setInterval(measureLatency, 30000)
    }

    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current)
        pingIntervalRef.current = null
      }
    }
  }, [isConnected])

  const measureLatency = useCallback(async () => {
    const result = await ping()
    if (result !== null) {
      setLatency(result)
    }
  }, [ping])

  const refresh = useCallback(async () => {
    await measureLatency()
  }, [measureLatency])

  return {
    quality: connectionQuality,
    latency,
    isOnline: isConnected,
    refresh,
  }
}

// Helper to get quality from latency
export function getQualityFromLatency(latencyMs: number): ConnectionQuality {
  if (latencyMs < QUALITY_THRESHOLDS.excellent) return 'excellent'
  if (latencyMs < QUALITY_THRESHOLDS.good) return 'good'
  if (latencyMs < QUALITY_THRESHOLDS.fair) return 'fair'
  if (latencyMs < QUALITY_THRESHOLDS.poor) return 'poor'
  return 'offline'
}

// Helper to get color for quality indicator
export function getQualityColor(quality: ConnectionQuality): string {
  switch (quality) {
    case 'excellent':
      return '#22c55e'
    case 'good':
      return '#84cc16'
    case 'fair':
      return '#f59e0b'
    case 'poor':
      return '#ef4444'
    case 'offline':
    default:
      return '#666'
  }
}

// Helper to get label for quality
export function getQualityLabel(quality: ConnectionQuality): string {
  switch (quality) {
    case 'excellent':
      return 'Excellent'
    case 'good':
      return 'Good'
    case 'fair':
      return 'Fair'
    case 'poor':
      return 'Poor'
    case 'offline':
    default:
      return 'Offline'
  }
}

// Helper to get signal bars count (0-4)
export function getSignalBars(quality: ConnectionQuality): number {
  switch (quality) {
    case 'excellent':
      return 4
    case 'good':
      return 3
    case 'fair':
      return 2
    case 'poor':
      return 1
    case 'offline':
    default:
      return 0
  }
}
