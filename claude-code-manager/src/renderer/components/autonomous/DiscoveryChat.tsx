/**
 * DiscoveryChat Component
 *
 * Phase 2: Discovery chat - user describes what they want to build,
 * research agents analyze the codebase and gather best practices.
 * This is a placeholder that will be fully implemented in FEAT-019.
 */

import React, { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Loader2, Cpu } from 'lucide-react'
import { Button } from '../ui/button'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { cn } from '@renderer/lib/utils'

export function DiscoveryChat() {
  const {
    chatMessages,
    agentStatuses,
    addChatMessage,
    goToNextPhase,
    selectedProject
  } = useAutonomousStore()

  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // Add initial system message if no messages
  useEffect(() => {
    if (chatMessages.length === 0 && selectedProject) {
      addChatMessage({
        role: 'system',
        content: `Starting discovery for ${selectedProject.isNew ? 'new' : 'existing'} project: ${selectedProject.name}`
      })
      addChatMessage({
        role: 'assistant',
        content: `Welcome! I'll help you plan your ${selectedProject.isNew ? 'new project' : 'feature'}.\n\nPlease describe what you want to build. Be as detailed as possible about:\n- The main features and functionality\n- Any specific technologies or patterns you want to use\n- Integration requirements\n- User experience expectations`
      })
    }
  }, [selectedProject, chatMessages.length, addChatMessage])

  const handleSend = async () => {
    if (!input.trim() || isProcessing) return

    const userMessage = input.trim()
    setInput('')
    setIsProcessing(true)

    // Add user message
    addChatMessage({ role: 'user', content: userMessage })

    // TODO: FEAT-018 will implement the actual discovery chat service
    // For now, simulate a response
    setTimeout(() => {
      addChatMessage({
        role: 'assistant',
        content: 'Thank you for the description. The research agents will analyze your requirements and the codebase.\n\n[Discovery Chat Service not yet implemented - FEAT-018]'
      })
      setIsProcessing(false)
    }, 1000)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Placeholder: proceed to next phase button
  const handleProceedToSpec = () => {
    goToNextPhase()
  }

  return (
    <div className="h-full flex">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatMessages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'flex gap-3',
                message.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              {message.role !== 'user' && (
                <div className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center shrink-0',
                  message.role === 'assistant' ? 'bg-primary/10' : 'bg-secondary'
                )}>
                  <Bot className="h-4 w-4" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[80%] rounded-lg px-4 py-2',
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : message.role === 'system'
                    ? 'bg-secondary/50 text-muted-foreground text-sm italic'
                    : 'bg-secondary'
                )}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                <span className="text-xs opacity-50 mt-1 block">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {message.role === 'user' && (
                <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-border p-4">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Describe what you want to build..."
              className={cn(
                'flex-1 min-h-[60px] max-h-[200px] p-3 rounded-lg',
                'bg-secondary border border-border resize-none',
                'focus:outline-none focus:ring-2 focus:ring-primary'
              )}
              disabled={isProcessing}
            />
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isProcessing}
                className="h-[60px] px-4"
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Temporary: Proceed button for development */}
          <div className="mt-4 flex justify-end">
            <Button onClick={handleProceedToSpec} variant="outline">
              Proceed to Spec Review (Dev Only)
            </Button>
          </div>
        </div>
      </div>

      {/* Agent Status Sidebar */}
      <div className="w-64 border-l border-border p-4 shrink-0">
        <h3 className="font-medium text-sm mb-3 flex items-center gap-2">
          <Cpu className="h-4 w-4" />
          Research Agents
        </h3>
        <div className="space-y-3">
          {agentStatuses.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Agents will be activated when you describe your requirements.
            </p>
          ) : (
            agentStatuses.map((agent) => (
              <div
                key={agent.name}
                className="p-2 bg-secondary/50 rounded text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{agent.name}</span>
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded',
                    agent.status === 'running' && 'bg-blue-500/20 text-blue-500',
                    agent.status === 'complete' && 'bg-emerald-500/20 text-emerald-500',
                    agent.status === 'error' && 'bg-red-500/20 text-red-500',
                    agent.status === 'idle' && 'bg-secondary text-muted-foreground'
                  )}>
                    {agent.status}
                  </span>
                </div>
                {agent.output && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {agent.output}
                  </p>
                )}
              </div>
            ))
          )}

          {/* Placeholder agents */}
          <div className="space-y-2 opacity-50">
            <div className="p-2 bg-secondary/30 rounded text-xs">
              <span className="font-medium">Process Agent</span>
              <span className="text-muted-foreground ml-2">(FEAT-020)</span>
            </div>
            <div className="p-2 bg-secondary/30 rounded text-xs">
              <span className="font-medium">Codebase Analyzer</span>
              <span className="text-muted-foreground ml-2">(FEAT-021)</span>
            </div>
            <div className="p-2 bg-secondary/30 rounded text-xs">
              <span className="font-medium">Spec Builder</span>
              <span className="text-muted-foreground ml-2">(FEAT-022)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
