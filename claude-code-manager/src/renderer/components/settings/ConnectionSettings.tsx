import { useState, useEffect, useCallback } from 'react'
import { Server, Laptop, Wifi, WifiOff, Copy, Check, Play, Square, AlertCircle, Globe } from 'lucide-react'
import type { ApiServerConfig, ApiServerStatusResult } from '../../../preload'

type ConnectionMode = 'standalone' | 'server' | 'client'

interface ConnectionSettingsProps {
  onModeChange?: (mode: ConnectionMode) => void
}

export function ConnectionSettings({ onModeChange }: ConnectionSettingsProps) {
  const [mode, setMode] = useState<ConnectionMode>('standalone')
  const [serverStatus, setServerStatus] = useState<{
    running: boolean
    port?: number
    connectedClients?: number
    authToken?: string
    addresses?: string[]
  } | null>(null)
  const [serverPort, setServerPort] = useState(3847)
  const [enableAuth, setEnableAuth] = useState(true)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteToken, setRemoteToken] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState(false)

  // Load saved settings
  useEffect(() => {
    const savedMode = localStorage.getItem('connectionMode') as ConnectionMode | null
    const savedRemoteUrl = localStorage.getItem('remoteUrl')
    const savedRemoteToken = localStorage.getItem('remoteToken')

    if (savedMode) setMode(savedMode)
    if (savedRemoteUrl) setRemoteUrl(savedRemoteUrl)
    if (savedRemoteToken) setRemoteToken(savedRemoteToken)

    // Check API server status
    checkServerStatus()
  }, [])

  const checkServerStatus = useCallback(async () => {
    try {
      const result = await window.electron.apiServer.status()
      if (result.success && result.data) {
        setServerStatus(result.data)
        if (result.data.running) {
          setMode('server')
        }
      }
    } catch (err) {
      console.error('Failed to check server status:', err)
    }
  }, [])

  const handleModeChange = (newMode: ConnectionMode) => {
    setMode(newMode)
    localStorage.setItem('connectionMode', newMode)
    onModeChange?.(newMode)
    setError(null)
  }

  const startServer = async () => {
    setIsStarting(true)
    setError(null)
    try {
      const config: ApiServerConfig = {
        port: serverPort,
        enableAuth
      }
      const result = await window.electron.apiServer.start(config)
      if (result.success && result.data) {
        setServerStatus({
          running: true,
          port: result.data.port,
          connectedClients: result.data.status.connectedClients,
          authToken: result.data.authToken,
          addresses: result.data.addresses
        })
        handleModeChange('server')
      } else {
        setError(result.error || 'Failed to start server')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start server')
    } finally {
      setIsStarting(false)
    }
  }

  const stopServer = async () => {
    setIsStopping(true)
    setError(null)
    try {
      const result = await window.electron.apiServer.stop()
      if (result.success) {
        setServerStatus(null)
        handleModeChange('standalone')
      } else {
        setError(result.error || 'Failed to stop server')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop server')
    } finally {
      setIsStopping(false)
    }
  }

  const copyToken = () => {
    if (serverStatus?.authToken) {
      navigator.clipboard.writeText(serverStatus.authToken)
      setCopiedToken(true)
      setTimeout(() => setCopiedToken(false), 2000)
    }
  }

  const saveClientSettings = () => {
    localStorage.setItem('remoteUrl', remoteUrl)
    localStorage.setItem('remoteToken', remoteToken)
    setError(null)
    // TODO: Test connection and switch to client mode
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-white mb-4">Connection Mode</h3>
        <p className="text-sm text-gray-400 mb-4">
          Choose how this app connects: standalone (local only), server (accept remote connections),
          or client (connect to a remote server).
        </p>
      </div>

      {/* Mode Selection */}
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => handleModeChange('standalone')}
          className={`p-4 rounded-lg border-2 transition-colors ${
            mode === 'standalone'
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
          }`}
        >
          <Laptop className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <div className="text-sm font-medium text-white">Standalone</div>
          <div className="text-xs text-gray-500 mt-1">Local only</div>
        </button>

        <button
          onClick={() => handleModeChange('server')}
          className={`p-4 rounded-lg border-2 transition-colors ${
            mode === 'server'
              ? 'border-green-500 bg-green-500/10'
              : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
          }`}
        >
          <Server className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <div className="text-sm font-medium text-white">Server</div>
          <div className="text-xs text-gray-500 mt-1">Accept connections</div>
        </button>

        <button
          onClick={() => handleModeChange('client')}
          className={`p-4 rounded-lg border-2 transition-colors ${
            mode === 'client'
              ? 'border-purple-500 bg-purple-500/10'
              : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
          }`}
        >
          <Wifi className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <div className="text-sm font-medium text-white">Client</div>
          <div className="text-xs text-gray-500 mt-1">Connect to remote</div>
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Server Mode Settings */}
      {mode === 'server' && (
        <div className="space-y-4 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white">Server Settings</h4>
            {serverStatus?.running ? (
              <span className="flex items-center gap-1.5 text-xs text-green-400">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                Running on port {serverStatus.port}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <WifiOff className="w-3 h-3" />
                Not running
              </span>
            )}
          </div>

          {!serverStatus?.running ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Port</label>
                  <input
                    type="number"
                    value={serverPort}
                    onChange={(e) => setServerPort(parseInt(e.target.value) || 3847)}
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableAuth}
                      onChange={(e) => setEnableAuth(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
                    />
                    <span className="text-sm text-gray-300">Require authentication</span>
                  </label>
                </div>
              </div>

              <button
                onClick={startServer}
                disabled={isStarting}
                className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
              >
                {isStarting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Start Server
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <div className="space-y-3">
                {/* Server Addresses */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1 flex items-center gap-1">
                    <Globe className="w-3 h-3" />
                    Server Addresses
                  </label>
                  <div className="space-y-1">
                    {serverStatus.addresses && serverStatus.addresses.length > 0 ? (
                      serverStatus.addresses.map((addr, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <code className="flex-1 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-green-400 font-mono">
                            http://{addr}:{serverStatus.port}
                          </code>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(`http://${addr}:${serverStatus.port}`)
                            }}
                            className="p-1 hover:bg-gray-700 rounded transition-colors"
                            title="Copy URL"
                          >
                            <Copy className="w-3 h-3 text-gray-400" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <code className="block px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-green-400 font-mono">
                        http://localhost:{serverStatus.port}
                      </code>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Use one of these URLs to connect from your mobile device.
                  </p>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Connected Clients</label>
                  <div className="text-sm text-white">{serverStatus.connectedClients || 0}</div>
                </div>

                {serverStatus.authToken && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Auth Token</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 font-mono truncate">
                        {serverStatus.authToken}
                      </code>
                      <button
                        onClick={copyToken}
                        className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                        title="Copy token"
                      >
                        {copiedToken ? (
                          <Check className="w-4 h-4 text-green-400" />
                        ) : (
                          <Copy className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Share this token with clients to allow them to connect.
                    </p>
                  </div>
                )}
              </div>

              <button
                onClick={stopServer}
                disabled={isStopping}
                className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
              >
                {isStopping ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Stopping...
                  </>
                ) : (
                  <>
                    <Square className="w-4 h-4" />
                    Stop Server
                  </>
                )}
              </button>
            </>
          )}
        </div>
      )}

      {/* Client Mode Settings */}
      {mode === 'client' && (
        <div className="space-y-4 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <h4 className="text-sm font-medium text-white">Remote Server Settings</h4>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Server URL</label>
            <input
              type="text"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="http://192.168.1.100:3847"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Auth Token</label>
            <input
              type="password"
              value={remoteToken}
              onChange={(e) => setRemoteToken(e.target.value)}
              placeholder="Paste token from server"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            onClick={saveClientSettings}
            disabled={!remoteUrl}
            className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Wifi className="w-4 h-4" />
            Connect to Server
          </button>

          <p className="text-xs text-gray-500">
            For remote access over the internet, use Cloudflare Tunnel or Tailscale to securely expose
            your server. The server URL can be a direct IP, hostname, or tunnel URL.
          </p>
        </div>
      )}

      {/* Standalone Mode Info */}
      {mode === 'standalone' && (
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <p className="text-sm text-gray-400">
            In standalone mode, the app runs locally without any remote access.
            All operations are performed directly on this machine.
          </p>
        </div>
      )}
    </div>
  )
}
