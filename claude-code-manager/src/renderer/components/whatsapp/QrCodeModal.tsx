/**
 * QR Code Modal
 *
 * Shows QR code for WhatsApp Web pairing.
 * Alternative: pairing code input.
 * Auto-closes on successful connection.
 */

import React, { useState, useEffect, useRef } from 'react'
import { X, QrCode, Keyboard, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { useWhatsAppStore } from '@renderer/stores/whatsapp-store'

export function QrCodeModal() {
  const {
    connectionState,
    setShowQrModal,
  } = useWhatsAppStore()

  const [usePairingCode, setUsePairingCode] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [requestingCode, setRequestingCode] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Auto-close on connected
  useEffect(() => {
    if (connectionState.status === 'connected') {
      setShowQrModal(false)
    }
  }, [connectionState.status, setShowQrModal])

  // Render QR code from base64 data
  useEffect(() => {
    if (!connectionState.qrCode || !canvasRef.current || usePairingCode) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      canvas.width = img.width
      canvas.height = img.height
      ctx.drawImage(img, 0, 0)
    }
    // QR code might be a data URL or base64 string
    img.src = connectionState.qrCode.startsWith('data:')
      ? connectionState.qrCode
      : `data:image/png;base64,${connectionState.qrCode}`
  }, [connectionState.qrCode, usePairingCode])

  // Request pairing code
  const handleRequestPairingCode = async () => {
    if (!phoneNumber.trim()) return
    setRequestingCode(true)
    try {
      const result = await window.electron.whatsapp.requestPairingCode(phoneNumber.trim())
      if (result.success && result.data) {
        setPairingCode(result.data)
      }
    } catch (err) {
      console.error('[QrCodeModal] Pairing code request error:', err)
    } finally {
      setRequestingCode(false)
    }
  }

  const statusText = {
    disconnected: 'Waiting to connect...',
    connecting: 'Connecting to WhatsApp...',
    qr_ready: 'Scan the QR code with your phone',
    pairing: 'Pairing with your phone...',
    connected: 'Connected!',
    reconnecting: 'Reconnecting...',
    logged_out: 'Logged out. Please reconnect.',
  }[connectionState.status]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold">Connect WhatsApp</h3>
          <button
            onClick={() => setShowQrModal(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Status */}
          <p className="text-sm text-muted-foreground text-center mb-4">{statusText}</p>

          {/* Mode toggle */}
          <div className="flex justify-center gap-2 mb-4">
            <Button
              variant={usePairingCode ? 'outline' : 'default'}
              size="sm"
              onClick={() => setUsePairingCode(false)}
            >
              <QrCode className="h-4 w-4 mr-1" />
              QR Code
            </Button>
            <Button
              variant={usePairingCode ? 'default' : 'outline'}
              size="sm"
              onClick={() => setUsePairingCode(true)}
            >
              <Keyboard className="h-4 w-4 mr-1" />
              Pairing Code
            </Button>
          </div>

          {usePairingCode ? (
            /* Pairing code mode */
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1234567890"
                  className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Enter your phone number with country code
                </p>
              </div>

              <Button
                className="w-full"
                onClick={handleRequestPairingCode}
                disabled={!phoneNumber.trim() || requestingCode}
              >
                {requestingCode ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : null}
                Request Pairing Code
              </Button>

              {pairingCode && (
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-2">Enter this code on your phone:</p>
                  <div className="text-3xl font-mono font-bold tracking-[0.3em] text-primary">
                    {pairingCode}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* QR code mode */
            <div className="flex flex-col items-center">
              {connectionState.qrCode ? (
                <canvas
                  ref={canvasRef}
                  className="rounded-lg border border-border"
                  style={{ maxWidth: '280px', maxHeight: '280px' }}
                />
              ) : (
                <div className="w-[280px] h-[280px] rounded-lg border border-border flex items-center justify-center bg-muted">
                  {connectionState.status === 'connecting' || connectionState.status === 'reconnecting' ? (
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  ) : (
                    <QrCode className="h-12 w-12 text-muted-foreground opacity-50" />
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-3 text-center">
                Open WhatsApp on your phone {'>'} Settings {'>'} Linked Devices {'>'} Link a Device
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default QrCodeModal
