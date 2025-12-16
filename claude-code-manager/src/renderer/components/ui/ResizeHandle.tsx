import React, { useCallback, useEffect, useRef } from 'react'
import { cn } from '@renderer/lib/utils'

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
  className?: string
}

export function ResizeHandle({ direction, onResize, className }: ResizeHandleProps) {
  const isDraggingRef = useRef(false)
  const startPosRef = useRef(0)
  const handleRef = useRef<HTMLDivElement>(null)
  const onResizeRef = useRef(onResize)

  // Keep callback ref up to date without triggering effect re-runs
  useEffect(() => {
    onResizeRef.current = onResize
  }, [onResize])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const handle = handleRef.current
    if (!handle) return

    // Capture pointer to ensure we get all events even over iframes/webviews
    handle.setPointerCapture(e.pointerId)

    isDraggingRef.current = true
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY

    // Add visual feedback
    handle.classList.add('bg-primary/50')
  }, [direction])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return

    const currentPos = direction === 'horizontal' ? e.clientX : e.clientY
    const delta = currentPos - startPosRef.current
    startPosRef.current = currentPos
    onResizeRef.current(delta)
  }, [direction])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return

    const handle = handleRef.current
    if (handle) {
      // Release pointer capture
      try {
        handle.releasePointerCapture(e.pointerId)
      } catch {
        // Ignore if capture was already released
      }
      handle.classList.remove('bg-primary/50')
    }

    isDraggingRef.current = false
  }, [])

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    handlePointerUp(e)
  }, [handlePointerUp])

  // Also handle lost pointer capture (e.g., when window loses focus)
  const handleLostPointerCapture = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false
      if (handleRef.current) {
        handleRef.current.classList.remove('bg-primary/50')
      }
    }
  }, [])

  return (
    <div
      ref={handleRef}
      className={cn(
        'shrink-0 transition-colors touch-none',
        direction === 'horizontal'
          ? 'w-1 cursor-col-resize hover:bg-primary/50'
          : 'h-1 cursor-row-resize hover:bg-primary/50',
        className
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
    />
  )
}
