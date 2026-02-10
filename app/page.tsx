'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { callAIAgent } from '@/lib/aiAgent'
import type { AIAgentResponse } from '@/lib/aiAgent'
import { FiShield, FiMail, FiUsers, FiActivity, FiCheck, FiX, FiClock, FiSend, FiSearch, FiSettings, FiAlertCircle, FiTrendingUp, FiGlobe, FiBriefcase, FiUser, FiChevronDown, FiChevronUp, FiLoader, FiInfo, FiExternalLink } from 'react-icons/fi'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// Agent IDs
const MANAGER_AGENT_ID = '698b062d01b0a8872f7ad8cf'
const EMAIL_VALIDATION_AGENT_ID = '698b05ecaeac12eb2f65088e'
const LEAD_ENRICHMENT_AGENT_ID = '698b05ec6a442daad7b60b74'
const INTEREST_QUALIFICATION_AGENT_ID = '698b0612aeac12eb2f65088f'
const LYZR_API_KEY = process.env.NEXT_PUBLIC_LYZR_API_KEY || ''

// Theme
const THEME_VARS = {
  '--background': '120 15% 98%',
  '--foreground': '150 30% 10%',
  '--card': '120 15% 96%',
  '--card-foreground': '150 30% 10%',
  '--popover': '120 15% 94%',
  '--popover-foreground': '150 30% 10%',
  '--primary': '142 76% 26%',
  '--primary-foreground': '120 15% 98%',
  '--secondary': '120 15% 92%',
  '--secondary-foreground': '150 30% 15%',
  '--accent': '160 60% 30%',
  '--accent-foreground': '120 15% 98%',
  '--destructive': '0 84% 60%',
  '--destructive-foreground': '0 0% 98%',
  '--muted': '120 12% 90%',
  '--muted-foreground': '150 20% 45%',
  '--border': '120 15% 88%',
  '--input': '120 12% 80%',
  '--ring': '142 76% 26%',
  '--radius': '0.875rem',
} as React.CSSProperties

// Interfaces
interface EmailValidation {
  is_valid?: boolean
  is_business_email?: boolean
  is_disposable?: boolean
  risk_score?: string
  domain?: string
  validation_reasoning?: string
}

interface CompanyEnrichment {
  company_name?: string
  industry?: string
  employee_count?: number
  employee_count_range?: string
  revenue_range?: string
  annual_revenue_range?: string
  headquarters?: string
  headquarters_location?: string
  website?: string
  technologies?: string[]
  technologies_used?: string[]
  funding_stage?: string
  linkedin_url?: string
  fit_score?: number
  fit_reasoning?: string
  key_decision_makers?: string[]
}

interface InterestQualification {
  qualification_score?: number
  intent_level?: string
  buying_signals?: string[]
  disqualification_reasons?: string[]
  recommended_action?: string
  scoring_breakdown?: Record<string, number>
  reasoning?: string
}

interface LeadData {
  lead_name?: string
  lead_email?: string
  lead_role?: string
  final_status?: string
  email_validation?: EmailValidation
  company_enrichment?: CompanyEnrichment
  interest_qualification?: InterestQualification
}

interface ProcessedLead {
  id: string
  leadData: LeadData
  status: 'QUALIFIED' | 'DISQUALIFIED' | 'PROCESSING' | 'ERROR'
  timestamp: string
  expanded: boolean
  summary?: string
}

interface ActivityEvent {
  id: string
  icon: 'receive' | 'email' | 'enrich' | 'qualify' | 'slack' | 'error'
  description: string
  timestamp: string
}

// Helper: generate unique ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

// Helper: generate session ID for activity stream
function generateSessionId(agentId: string): string {
  return `session_${agentId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

// Helper: parse agent response
function parseAgentResponse(apiResponse: AIAgentResponse): LeadData | null {
  if (!apiResponse?.success) return null

  const result = apiResponse?.response?.result
  if (!result) return null

  // If result already has structured data in .data
  if (result?.data?.lead_name || result?.data?.lead_email) return result.data as LeadData
  // If result itself has the fields
  if (result?.lead_name || result?.lead_email) return result as LeadData

  // Try parsing raw_response
  if (apiResponse?.raw_response) {
    try {
      const cleaned = apiResponse.raw_response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim()
      const parsed = JSON.parse(cleaned)
      if (parsed?.data) return parsed.data as LeadData
      if (parsed?.lead_name) return parsed as LeadData
      return parsed as LeadData
    } catch {
      // regex fallback
      return null
    }
  }

  // Return result as-is if it has email_validation etc
  if (result?.email_validation || result?.company_enrichment || result?.interest_qualification) {
    return result as LeadData
  }

  return null
}

// Activity stream hook for manager-subagent pattern
function useActivityStream(sessionId: string | null) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!sessionId || !LYZR_API_KEY) return

    try {
      const wsUrl = `wss://metrics.studio.lyzr.ai/ws/${sessionId}?x-api-key=${LYZR_API_KEY}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          const newEvent: ActivityEvent = {
            id: generateId(),
            icon: data?.type === 'error' ? 'error' : 'qualify',
            description: data?.message || data?.text || JSON.stringify(data),
            timestamp: new Date().toISOString(),
          }
          setEvents((prev) => [...prev, newEvent])
        } catch {
          // ignore parse errors
        }
      }

      ws.onerror = () => {
        // silently handle
      }

      return () => {
        ws.close()
        wsRef.current = null
      }
    } catch {
      // ignore ws connection errors
    }
  }, [sessionId])

  const addEvent = useCallback((event: Omit<ActivityEvent, 'id'>) => {
    setEvents((prev) => [...prev, { ...event, id: generateId() }])
  }, [])

  return { events, addEvent }
}

// Sample data
const SAMPLE_LEADS: ProcessedLead[] = [
  {
    id: 'sample-1',
    leadData: {
      lead_name: 'David Park',
      lead_email: 'david.park@securetech.io',
      lead_role: 'VP of IT',
      final_status: 'QUALIFIED',
      email_validation: {
        is_valid: true,
        is_business_email: true,
        is_disposable: false,
        risk_score: 'low',
      },
      company_enrichment: {
        company_name: 'SecureTech Solutions',
        industry: 'Cybersecurity / Information Technology',
        employee_count: 500,
        revenue_range: '$10M-$50M',
        headquarters: 'San Jose, California, United States',
        website: 'https://securetech.io',
        technologies: ['AWS', 'Azure', 'Cisco', 'Office 365', 'VMware', 'Palo Alto Networks'],
        funding_stage: 'Private',
        linkedin_url: 'https://www.linkedin.com/company/securetech-io',
        fit_score: 9,
      },
      interest_qualification: {
        qualification_score: 94,
        intent_level: 'HOT',
        buying_signals: [
          'Budget approved',
          'Decision this quarter (imminent)',
          'Clear enterprise security needs (SSO, compliance)',
          'Scaling remote access',
          'Decision maker outreach',
        ],
        recommended_action: 'Assign to an experienced Enterprise AE. Respond ASAP to schedule a demo/discovery call.',
      },
    },
    status: 'QUALIFIED',
    timestamp: '2026-02-10T09:15:00Z',
    expanded: false,
    summary: 'Lead fully processed through all sub-agents. David Park at SecureTech Solutions is a QUALIFIED HOT lead with a score of 94/100.',
  },
  {
    id: 'sample-2',
    leadData: {
      lead_name: 'Sarah Jones',
      lead_email: 'sarah.jones@cloudflare.com',
      lead_role: 'Director of Engineering',
      final_status: 'QUALIFIED',
      email_validation: {
        is_valid: true,
        is_business_email: true,
        is_disposable: false,
        risk_score: 'low',
      },
      company_enrichment: {
        company_name: 'Cloudflare, Inc.',
        industry: 'Internet Infrastructure & Cybersecurity',
        employee_count: 2500,
        revenue_range: '$900M-$1.1B',
        headquarters: 'San Francisco, California, USA',
        website: 'https://www.cloudflare.com',
        technologies: ['Kubernetes', 'Docker', 'AWS', 'Python', 'Go', 'Terraform', 'Kafka'],
        funding_stage: 'Public (NYSE: NET)',
        linkedin_url: 'https://www.linkedin.com/company/cloudflare/',
        fit_score: 9,
      },
      interest_qualification: {
        qualification_score: 78,
        intent_level: 'WARM',
        buying_signals: [
          'Large enterprise with security focus',
          'Engineering leadership evaluation',
          'Cloud-native infrastructure',
        ],
        recommended_action: 'Schedule a technical deep-dive with their engineering team.',
      },
    },
    status: 'QUALIFIED',
    timestamp: '2026-02-10T08:42:00Z',
    expanded: false,
    summary: 'Cloudflare lead qualified with WARM intent. Strong company fit but needs nurturing.',
  },
  {
    id: 'sample-3',
    leadData: {
      lead_name: 'John Smith',
      lead_email: 'john.smith@tempmail.org',
      lead_role: 'Student',
      final_status: 'DISQUALIFIED',
      email_validation: {
        is_valid: false,
        is_business_email: false,
        is_disposable: true,
        risk_score: 'high',
      },
      company_enrichment: {
        company_name: 'Unknown',
        industry: 'Unknown',
        employee_count: 0,
        revenue_range: 'N/A',
        headquarters: 'Unknown',
        fit_score: 1,
      },
      interest_qualification: {
        qualification_score: 12,
        intent_level: 'COLD',
        buying_signals: [],
        disqualification_reasons: ['Disposable email', 'No company association', 'No buying authority'],
        recommended_action: 'No action. Lead does not meet qualification criteria.',
      },
    },
    status: 'DISQUALIFIED',
    timestamp: '2026-02-10T07:30:00Z',
    expanded: false,
    summary: 'Lead disqualified. Disposable email with no company association.',
  },
]

const SAMPLE_ACTIVITY: ActivityEvent[] = [
  { id: 'sa-1', icon: 'receive', description: 'New lead received: David Park (securetech.io)', timestamp: '2026-02-10T09:15:00Z' },
  { id: 'sa-2', icon: 'email', description: 'Email validated: david.park@securetech.io - Valid business email', timestamp: '2026-02-10T09:15:05Z' },
  { id: 'sa-3', icon: 'enrich', description: 'Company enriched: SecureTech Solutions - Cybersecurity, 500 employees', timestamp: '2026-02-10T09:15:12Z' },
  { id: 'sa-4', icon: 'qualify', description: 'Lead qualified: Score 94/100, Intent: HOT', timestamp: '2026-02-10T09:15:18Z' },
  { id: 'sa-5', icon: 'slack', description: 'Notification sent to #sales-qualified channel', timestamp: '2026-02-10T09:15:20Z' },
  { id: 'sa-6', icon: 'receive', description: 'New lead received: Sarah Jones (cloudflare.com)', timestamp: '2026-02-10T08:42:00Z' },
  { id: 'sa-7', icon: 'email', description: 'Email validated: sarah.jones@cloudflare.com - Valid business email', timestamp: '2026-02-10T08:42:04Z' },
  { id: 'sa-8', icon: 'enrich', description: 'Company enriched: Cloudflare, Inc. - Internet Infrastructure, 2500 employees', timestamp: '2026-02-10T08:42:10Z' },
  { id: 'sa-9', icon: 'qualify', description: 'Lead qualified: Score 78/100, Intent: WARM', timestamp: '2026-02-10T08:42:16Z' },
  { id: 'sa-10', icon: 'slack', description: 'Notification sent to #sales-qualified channel', timestamp: '2026-02-10T08:42:18Z' },
  { id: 'sa-11', icon: 'receive', description: 'New lead received: John Smith (tempmail.org)', timestamp: '2026-02-10T07:30:00Z' },
  { id: 'sa-12', icon: 'email', description: 'Email validation failed: john.smith@tempmail.org - Disposable email', timestamp: '2026-02-10T07:30:04Z' },
  { id: 'sa-13', icon: 'error', description: 'Lead disqualified: No company association, disposable email', timestamp: '2026-02-10T07:30:08Z' },
]

// Loading spinner component using react-icons
function Spinner({ className }: { className?: string }) {
  return <FiLoader className={`animate-spin ${className || 'w-4 h-4'}`} />
}

function formatTimestamp(ts: string): string {
  try {
    const date = new Date(ts)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ts
  }
}

function getIntentColor(intent?: string): string {
  switch (intent?.toUpperCase()) {
    case 'HOT': return 'bg-red-100 text-red-700 border-red-200'
    case 'WARM': return 'bg-amber-100 text-amber-700 border-amber-200'
    case 'COLD': return 'bg-blue-100 text-blue-700 border-blue-200'
    default: return 'bg-muted text-muted-foreground'
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'QUALIFIED': return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    case 'DISQUALIFIED': return 'bg-red-100 text-red-700 border-red-200'
    case 'PROCESSING': return 'bg-amber-100 text-amber-700 border-amber-200'
    case 'ERROR': return 'bg-red-100 text-red-700 border-red-200'
    default: return 'bg-muted text-muted-foreground'
  }
}

function getRiskColor(risk?: string): string {
  switch (risk?.toLowerCase()) {
    case 'low': return 'text-emerald-600'
    case 'medium': return 'text-amber-600'
    case 'high': return 'text-red-600'
    default: return 'text-muted-foreground'
  }
}

function getActivityIcon(icon: string) {
  switch (icon) {
    case 'receive': return <FiMail className="w-4 h-4 text-primary" />
    case 'email': return <FiCheck className="w-4 h-4 text-emerald-500" />
    case 'enrich': return <FiSearch className="w-4 h-4 text-blue-500" />
    case 'qualify': return <FiTrendingUp className="w-4 h-4 text-purple-500" />
    case 'slack': return <FiSend className="w-4 h-4 text-primary" />
    case 'error': return <FiAlertCircle className="w-4 h-4 text-red-500" />
    default: return <FiInfo className="w-4 h-4 text-muted-foreground" />
  }
}

// Progress bar component
function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const barColor = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className={`w-full h-2 bg-muted rounded-full overflow-hidden ${className || ''}`}>
      <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// Lead detail expanded view
function LeadDetailView({ lead }: { lead: ProcessedLead }) {
  const d = lead?.leadData
  const ev = d?.email_validation
  const ce = d?.company_enrichment
  const iq = d?.interest_qualification
  const techs = Array.isArray(ce?.technologies) ? ce.technologies : (Array.isArray(ce?.technologies_used) ? ce.technologies_used : [])
  const buyingSignals = Array.isArray(iq?.buying_signals) ? iq.buying_signals : []
  const disqualReasons = Array.isArray(iq?.disqualification_reasons) ? iq.disqualification_reasons : []
  const scoringBreakdown = iq?.scoring_breakdown && typeof iq.scoring_breakdown === 'object' ? iq.scoring_breakdown : null

  return (
    <div className="mt-3 space-y-4 border-t border-border pt-3">
      {/* Email Validation */}
      <div>
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2">
          <FiMail className="w-4 h-4 text-primary" />
          Email Validation
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="bg-background rounded-lg p-2 text-center">
            <div className="text-xs text-muted-foreground">Valid</div>
            <div className="text-sm font-medium">{ev?.is_valid ? <FiCheck className="w-4 h-4 text-emerald-500 mx-auto" /> : <FiX className="w-4 h-4 text-red-500 mx-auto" />}</div>
          </div>
          <div className="bg-background rounded-lg p-2 text-center">
            <div className="text-xs text-muted-foreground">Business</div>
            <div className="text-sm font-medium">{ev?.is_business_email ? <FiCheck className="w-4 h-4 text-emerald-500 mx-auto" /> : <FiX className="w-4 h-4 text-red-500 mx-auto" />}</div>
          </div>
          <div className="bg-background rounded-lg p-2 text-center">
            <div className="text-xs text-muted-foreground">Disposable</div>
            <div className="text-sm font-medium">{ev?.is_disposable ? <FiX className="w-4 h-4 text-red-500 mx-auto" /> : <FiCheck className="w-4 h-4 text-emerald-500 mx-auto" />}</div>
          </div>
          <div className="bg-background rounded-lg p-2 text-center">
            <div className="text-xs text-muted-foreground">Risk</div>
            <div className={`text-sm font-semibold capitalize ${getRiskColor(ev?.risk_score)}`}>{ev?.risk_score ?? 'N/A'}</div>
          </div>
        </div>
      </div>

      {/* Company Enrichment */}
      <div>
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2">
          <FiBriefcase className="w-4 h-4 text-primary" />
          Company Enrichment
        </h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Company</span>
            <span className="font-medium text-foreground">{ce?.company_name ?? 'Unknown'}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Industry</span>
            <span className="font-medium text-foreground">{ce?.industry ?? 'Unknown'}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Employees</span>
            <span className="font-medium text-foreground">{ce?.employee_count ?? ce?.employee_count_range ?? 'N/A'}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Revenue</span>
            <span className="font-medium text-foreground">{ce?.revenue_range ?? ce?.annual_revenue_range ?? 'N/A'}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">HQ</span>
            <span className="font-medium text-foreground truncate ml-2">{ce?.headquarters ?? ce?.headquarters_location ?? 'N/A'}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Funding</span>
            <span className="font-medium text-foreground">{ce?.funding_stage ?? 'N/A'}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Fit Score</span>
            <span className="font-bold text-primary">{ce?.fit_score ?? 'N/A'}/10</span>
          </div>
          {ce?.website && (
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Website</span>
              <span className="font-medium text-primary truncate ml-2">{ce.website}</span>
            </div>
          )}
        </div>
        {techs.length > 0 && (
          <div className="mt-2">
            <span className="text-xs text-muted-foreground">Technologies</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {techs.map((tech, i) => (
                <Badge key={i} variant="secondary" className="text-xs">{String(tech)}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Interest Qualification */}
      <div>
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2">
          <FiTrendingUp className="w-4 h-4 text-primary" />
          Interest Qualification
        </h4>
        <div className="flex items-center gap-3 mb-2">
          <div className="text-2xl font-bold text-foreground">{iq?.qualification_score ?? 0}</div>
          <div className="text-sm text-muted-foreground">/100</div>
          <ProgressBar value={iq?.qualification_score ?? 0} max={100} className="flex-1" />
        </div>
        {buyingSignals.length > 0 && (
          <div className="mt-2">
            <span className="text-xs text-muted-foreground">Buying Signals</span>
            <ul className="mt-1 space-y-1">
              {buyingSignals.map((signal, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                  <FiCheck className="w-3 h-3 text-emerald-500 mt-1 shrink-0" />
                  {String(signal)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {disqualReasons.length > 0 && (
          <div className="mt-2">
            <span className="text-xs text-muted-foreground">Disqualification Reasons</span>
            <ul className="mt-1 space-y-1">
              {disqualReasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-red-600">
                  <FiX className="w-3 h-3 text-red-500 mt-1 shrink-0" />
                  {String(reason)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {scoringBreakdown && (
          <div className="mt-2">
            <span className="text-xs text-muted-foreground">Score Breakdown</span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1 text-sm">
              {Object.entries(scoringBreakdown).map(([key, val]) => (
                <div key={key} className="flex justify-between py-0.5">
                  <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                  <span className="font-medium text-foreground">{String(val)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {iq?.recommended_action && (
          <div className="mt-3 p-3 bg-primary/5 rounded-lg border border-primary/10">
            <span className="text-xs font-semibold text-primary">Recommended Action</span>
            <p className="text-sm text-foreground mt-1">{iq.recommended_action}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// Stat card component
function StatCard({ icon, label, value, subtext }: { icon: React.ReactNode; label: string; value: string | number; subtext?: string }) {
  return (
    <Card className="bg-card/75 backdrop-blur-[16px] border border-white/[0.18] shadow-sm">
      <CardContent className="p-4 flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          <p className="text-2xl font-semibold text-foreground tracking-tight leading-tight">{value}</p>
          {subtext && <p className="text-xs text-muted-foreground mt-0.5">{subtext}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

export default function Home() {
  const [sampleMode, setSampleMode] = useState(false)
  const [formData, setFormData] = useState({ name: '', email: '', company: '', role: '', transcript: '' })
  const [isProcessing, setIsProcessing] = useState(false)
  const [processedLeads, setProcessedLeads] = useState<ProcessedLead[]>([])
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const activityEndRef = useRef<HTMLDivElement>(null)
  const [currentTime, setCurrentTime] = useState('')

  // Set current time on client
  useEffect(() => {
    setCurrentTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
    const interval = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  // Activity stream
  const { events: wsEvents, addEvent: addWsEvent } = useActivityStream(sessionId)

  // Merge ws events into activity
  useEffect(() => {
    if (wsEvents.length > 0) {
      setActivityEvents((prev) => {
        const existingIds = new Set(prev.map(e => e.id))
        const newEvents = wsEvents.filter(e => !existingIds.has(e.id))
        return [...prev, ...newEvents]
      })
    }
  }, [wsEvents])

  // Auto-scroll activity feed
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activityEvents])

  // Fill sample data when toggled on
  useEffect(() => {
    if (sampleMode) {
      setFormData({
        name: 'Mike Chen',
        email: 'mike.chen@techvault.io',
        company: 'TechVault Inc',
        role: 'CTO',
        transcript: 'We are looking to secure our remote workforce. Currently evaluating VPN solutions for our 200+ employees across 3 offices. We need something that integrates with our existing cloud infrastructure on AWS. Budget is allocated for Q1. Can you walk me through your enterprise plans?',
      })
      setProcessedLeads(SAMPLE_LEADS)
      setActivityEvents(SAMPLE_ACTIVITY)
    } else {
      setFormData({ name: '', email: '', company: '', role: '', transcript: '' })
      setProcessedLeads([])
      setActivityEvents([])
    }
  }, [sampleMode])

  const addActivity = useCallback((icon: ActivityEvent['icon'], description: string) => {
    const event: ActivityEvent = {
      id: generateId(),
      icon,
      description,
      timestamp: new Date().toISOString(),
    }
    setActivityEvents((prev) => [...prev, event])
  }, [])

  const handleProcessLead = async () => {
    if (!formData.name.trim() || !formData.email.trim()) {
      setError('Lead name and email are required.')
      return
    }

    setError(null)
    setIsProcessing(true)

    const leadId = generateId()
    const now = new Date().toISOString()

    // Add processing lead
    const processingLead: ProcessedLead = {
      id: leadId,
      leadData: {
        lead_name: formData.name,
        lead_email: formData.email,
        lead_role: formData.role,
      },
      status: 'PROCESSING',
      timestamp: now,
      expanded: false,
    }
    setProcessedLeads((prev) => [processingLead, ...prev])

    // Activity events for pipeline stages
    addActivity('receive', `New lead received: ${formData.name} (${formData.email})`)

    // Generate session ID for activity stream
    const newSessionId = generateSessionId(MANAGER_AGENT_ID)
    setSessionId(newSessionId)

    // Build message for manager agent
    const message = `New lead from Intercom webhook: Name: ${formData.name}, Email: ${formData.email}, Company: ${formData.company || 'Not provided'}, Role: ${formData.role || 'Not provided'}, Conversation: '${formData.transcript || 'No transcript provided'}'`

    setActiveAgentId(MANAGER_AGENT_ID)

    try {
      // Small delay to let WS connect
      await new Promise((r) => setTimeout(r, 300))

      addActivity('email', `Validating email: ${formData.email}...`)

      const result = await callAIAgent(message, MANAGER_AGENT_ID, { session_id: newSessionId })

      if (result?.success) {
        const parsed = parseAgentResponse(result)

        addActivity('email', `Email validated: ${formData.email} - ${parsed?.email_validation?.is_valid ? 'Valid' : 'Check complete'}`)
        addActivity('enrich', `Company enriched: ${parsed?.company_enrichment?.company_name ?? formData.company ?? 'Unknown'}`)

        const finalStatus = parsed?.final_status?.toUpperCase() === 'QUALIFIED' ? 'QUALIFIED' :
          parsed?.final_status?.toUpperCase() === 'DISQUALIFIED' ? 'DISQUALIFIED' : 'QUALIFIED'

        const score = parsed?.interest_qualification?.qualification_score ?? 0
        const intent = parsed?.interest_qualification?.intent_level ?? 'N/A'

        addActivity('qualify', `Lead ${finalStatus.toLowerCase()}: Score ${score}/100, Intent: ${intent}`)

        if (finalStatus === 'QUALIFIED') {
          addActivity('slack', 'Notification sent to #sales-qualified channel')
        } else {
          addActivity('error', `Lead disqualified: ${parsed?.interest_qualification?.recommended_action ?? 'Does not meet criteria'}`)
        }

        setProcessedLeads((prev) =>
          prev.map((l) =>
            l.id === leadId
              ? {
                  ...l,
                  leadData: parsed ?? l.leadData,
                  status: finalStatus as ProcessedLead['status'],
                  summary: result?.response?.result?.summary ?? result?.response?.message ?? undefined,
                }
              : l
          )
        )
      } else {
        addActivity('error', `Processing failed: ${result?.error ?? 'Unknown error'}`)
        setProcessedLeads((prev) =>
          prev.map((l) => (l.id === leadId ? { ...l, status: 'ERROR' } : l))
        )
        setError(result?.error ?? 'Failed to process lead. Please try again.')
      }
    } catch (err) {
      addActivity('error', `Processing error: ${err instanceof Error ? err.message : 'Unknown'}`)
      setProcessedLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, status: 'ERROR' } : l))
      )
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setIsProcessing(false)
      setActiveAgentId(null)
      setSessionId(null)
    }
  }

  const toggleLeadExpand = (id: string) => {
    setProcessedLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, expanded: !l.expanded } : l))
    )
  }

  // Compute metrics
  const displayLeads = processedLeads
  const qualifiedCount = displayLeads.filter((l) => l.status === 'QUALIFIED').length
  const totalProcessed = displayLeads.filter((l) => l.status !== 'PROCESSING').length
  const qualifiedRate = totalProcessed > 0 ? Math.round((qualifiedCount / totalProcessed) * 100) : 0
  const pendingCount = displayLeads.filter((l) => l.status === 'PROCESSING').length
  const sentToSlack = qualifiedCount

  const agents = [
    { id: MANAGER_AGENT_ID, name: 'Lead Qualification Manager', purpose: 'Orchestrates the full qualification pipeline' },
    { id: EMAIL_VALIDATION_AGENT_ID, name: 'Email Validation Agent', purpose: 'Validates email legitimacy and risk' },
    { id: LEAD_ENRICHMENT_AGENT_ID, name: 'Lead Enrichment Agent', purpose: 'Enriches company firmographic data' },
    { id: INTEREST_QUALIFICATION_AGENT_ID, name: 'Interest Qualification Agent', purpose: 'Scores intent and buying signals' },
  ]

  return (
    <div style={THEME_VARS} className="min-h-screen bg-background text-foreground" >
      {/* Gradient background overlay */}
      <div className="fixed inset-0 pointer-events-none" style={{ background: 'linear-gradient(135deg, hsl(120 25% 96%) 0%, hsl(140 30% 94%) 35%, hsl(160 25% 95%) 70%, hsl(100 20% 96%) 100%)' }} />

      <div className="relative z-10">
        {/* Header */}
        <header className="border-b border-border bg-card/75 backdrop-blur-[16px]">
          <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary text-primary-foreground">
                <FiShield className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-foreground" style={{ letterSpacing: '-0.01em' }}>VPN Lead Qualification System</h1>
                <p className="text-sm text-muted-foreground" style={{ lineHeight: '1.55' }}>Automated lead processing & routing pipeline</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">{currentTime}</span>
              <Separator orientation="vertical" className="h-6" />
              <div className="flex items-center gap-2">
                <Label htmlFor="sample-toggle" className="text-sm text-muted-foreground cursor-pointer">Sample Data</Label>
                <Switch id="sample-toggle" checked={sampleMode} onCheckedChange={setSampleMode} />
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 space-y-6">
          {/* Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={<FiUsers className="w-5 h-5" />} label="Today's Leads" value={displayLeads.length} subtext={`${totalProcessed} processed`} />
            <StatCard icon={<FiTrendingUp className="w-5 h-5" />} label="Qualified Rate" value={`${qualifiedRate}%`} subtext={`${qualifiedCount} of ${totalProcessed}`} />
            <StatCard icon={<FiClock className="w-5 h-5" />} label="Pending" value={pendingCount} subtext="In pipeline" />
            <StatCard icon={<FiSend className="w-5 h-5" />} label="Sent to Slack" value={sentToSlack} subtext="Notifications" />
          </div>

          {/* Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Left Column - Lead Processing (3/5) */}
            <div className="lg:col-span-3 space-y-6">
              {/* New Lead Form */}
              <Card className="bg-card/75 backdrop-blur-[16px] border border-white/[0.18] shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-semibold flex items-center gap-2">
                    <FiUser className="w-5 h-5 text-primary" />
                    Process New Lead
                  </CardTitle>
                  <CardDescription style={{ lineHeight: '1.55' }}>Submit lead information to run through the automated qualification pipeline. The system validates emails, enriches company data, and scores buying intent.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="lead-name" className="text-sm font-medium">Lead Name</Label>
                      <Input id="lead-name" placeholder="e.g. David Park" value={formData.name} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} disabled={isProcessing} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="lead-email" className="text-sm font-medium">Email</Label>
                      <Input id="lead-email" type="email" placeholder="e.g. david.park@securetech.io" value={formData.email} onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))} disabled={isProcessing} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="lead-company" className="text-sm font-medium">Company</Label>
                      <Input id="lead-company" placeholder="e.g. SecureTech Solutions" value={formData.company} onChange={(e) => setFormData((prev) => ({ ...prev, company: e.target.value }))} disabled={isProcessing} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="lead-role" className="text-sm font-medium">Role</Label>
                      <Input id="lead-role" placeholder="e.g. VP of IT" value={formData.role} onChange={(e) => setFormData((prev) => ({ ...prev, role: e.target.value }))} disabled={isProcessing} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lead-transcript" className="text-sm font-medium">Conversation Transcript</Label>
                    <Textarea id="lead-transcript" placeholder="Paste the conversation transcript or lead notes here..." className="min-h-[100px] resize-none" value={formData.transcript} onChange={(e) => setFormData((prev) => ({ ...prev, transcript: e.target.value }))} disabled={isProcessing} />
                  </div>
                  {error && (
                    <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                      <FiAlertCircle className="w-4 h-4 shrink-0" />
                      {error}
                    </div>
                  )}
                  <Button onClick={handleProcessLead} disabled={isProcessing} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                    {isProcessing ? (
                      <span className="flex items-center gap-2">
                        <FiLoader className="w-4 h-4 animate-spin" />
                        Processing lead through qualification pipeline...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <FiSend className="w-4 h-4" />
                        Process Lead
                      </span>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Lead Queue */}
              <Card className="bg-card/75 backdrop-blur-[16px] border border-white/[0.18] shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-semibold flex items-center gap-2">
                    <FiUsers className="w-5 h-5 text-primary" />
                    Lead Queue
                    <Badge variant="secondary" className="ml-auto text-xs">{displayLeads.length} leads</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {displayLeads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                      <div className="p-3 rounded-full bg-muted mb-3">
                        <FiUsers className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground">No leads processed yet. Submit a lead above or enable Sample Data to see examples.</p>
                    </div>
                  ) : (
                    <ScrollArea className="max-h-[600px]">
                      <div className="divide-y divide-border">
                        {displayLeads.map((lead) => (
                          <div key={lead.id} className="p-4 hover:bg-muted/30 transition-colors">
                            <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => toggleLeadExpand(lead.id)}>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-foreground">{lead?.leadData?.company_enrichment?.company_name ?? lead?.leadData?.lead_name ?? 'Unknown'}</span>
                                  <Badge className={`text-xs border ${getStatusColor(lead.status)}`}>{lead.status}</Badge>
                                  {lead?.leadData?.interest_qualification?.intent_level && (
                                    <Badge className={`text-xs border ${getIntentColor(lead.leadData.interest_qualification.intent_level)}`}>{lead.leadData.interest_qualification.intent_level}</Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <FiMail className="w-3 h-3" />
                                    {lead?.leadData?.lead_email ?? 'N/A'}
                                  </span>
                                  {lead?.leadData?.lead_role && (
                                    <span className="flex items-center gap-1">
                                      <FiUser className="w-3 h-3" />
                                      {lead.leadData.lead_role}
                                    </span>
                                  )}
                                </div>
                                {lead.status !== 'PROCESSING' && lead.status !== 'ERROR' && (
                                  <div className="flex items-center gap-2 mt-2">
                                    <span className="text-xs text-muted-foreground">Score:</span>
                                    <span className="text-sm font-semibold text-foreground">{lead?.leadData?.interest_qualification?.qualification_score ?? 0}/100</span>
                                    <ProgressBar value={lead?.leadData?.interest_qualification?.qualification_score ?? 0} max={100} className="flex-1 max-w-[150px]" />
                                  </div>
                                )}
                                {lead.status === 'PROCESSING' && (
                                  <div className="flex items-center gap-2 mt-2 text-xs text-amber-600">
                                    <FiLoader className="w-3 h-3 animate-spin" />
                                    Processing through pipeline...
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs text-muted-foreground">{formatTimestamp(lead.timestamp)}</span>
                                {lead.expanded ? <FiChevronUp className="w-4 h-4 text-muted-foreground" /> : <FiChevronDown className="w-4 h-4 text-muted-foreground" />}
                              </div>
                            </div>
                            {lead.expanded && lead.status !== 'PROCESSING' && <LeadDetailView lead={lead} />}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column - Activity Feed & Config (2/5) */}
            <div className="lg:col-span-2 space-y-6">
              {/* Activity Feed */}
              <Card className="bg-card/75 backdrop-blur-[16px] border border-white/[0.18] shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-semibold flex items-center gap-2">
                    <FiActivity className="w-5 h-5 text-primary" />
                    Activity Feed
                    {isProcessing && <FiLoader className="w-4 h-4 animate-spin text-primary ml-auto" />}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {activityEvents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                      <div className="p-3 rounded-full bg-muted mb-3">
                        <FiActivity className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground">Pipeline events will appear here as leads are processed.</p>
                    </div>
                  ) : (
                    <ScrollArea className="max-h-[400px]">
                      <div className="px-4 pb-4 space-y-1">
                        {activityEvents.map((event) => (
                          <div key={event.id} className="flex items-start gap-3 py-2 group">
                            <div className="mt-0.5 shrink-0">{getActivityIcon(event.icon)}</div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-foreground leading-snug">{event.description}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{formatTimestamp(event.timestamp)}</p>
                            </div>
                          </div>
                        ))}
                        <div ref={activityEndRef} />
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>

              {/* Configuration & Agent Info */}
              <Tabs defaultValue="agents" className="w-full">
                <TabsList className="w-full grid grid-cols-2">
                  <TabsTrigger value="agents">Agents</TabsTrigger>
                  <TabsTrigger value="config">Configuration</TabsTrigger>
                </TabsList>

                <TabsContent value="agents" className="mt-3">
                  <Card className="bg-card/75 backdrop-blur-[16px] border border-white/[0.18] shadow-sm">
                    <CardContent className="p-3 space-y-2">
                      {agents.map((agent) => (
                        <div key={agent.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${activeAgentId === agent.id ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">{agent.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{agent.purpose}</p>
                          </div>
                          {activeAgentId === agent.id && <Badge variant="secondary" className="text-xs shrink-0">Active</Badge>}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="config" className="mt-3">
                  <Card className="bg-card/75 backdrop-blur-[16px] border border-white/[0.18] shadow-sm">
                    <CardContent className="p-4 space-y-4">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2">
                          <FiSettings className="w-4 h-4 text-primary" />
                          Qualification Criteria
                        </h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-start gap-2">
                            <Check className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                            <span className="text-muted-foreground">Valid business email (non-disposable, low risk)</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <Check className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                            <span className="text-muted-foreground">Company fit score 5+ / 10</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <Check className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                            <span className="text-muted-foreground">Interest score 50+ / 100 or HOT/WARM intent</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <Check className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                            <span className="text-muted-foreground">Decision-maker or influencer role</span>
                          </div>
                        </div>
                      </div>
                      <Separator />
                      <div>
                        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2">
                          <GlobeIcon className="w-4 h-4 text-primary" />
                          Integrations
                        </h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Webhook URL</span>
                            <Badge variant="secondary" className="text-xs">Configured</Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Slack Channel</span>
                            <Badge className="text-xs bg-emerald-100 text-emerald-700 border border-emerald-200">#sales-qualified</Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Intercom Source</span>
                            <Badge variant="secondary" className="text-xs">Connected</Badge>
                          </div>
                        </div>
                      </div>
                      <Separator />
                      <div>
                        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2">
                          <ShieldIcon className="w-4 h-4 text-primary" />
                          Pipeline Flow
                        </h4>
                        <div className="flex flex-col gap-1 text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">1</div>
                            <span className="text-muted-foreground">Email Validation</span>
                          </div>
                          <div className="ml-2.5 w-px h-3 bg-border" />
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">2</div>
                            <span className="text-muted-foreground">Company Enrichment</span>
                          </div>
                          <div className="ml-2.5 w-px h-3 bg-border" />
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">3</div>
                            <span className="text-muted-foreground">Interest Qualification</span>
                          </div>
                          <div className="ml-2.5 w-px h-3 bg-border" />
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">4</div>
                            <span className="text-muted-foreground">Route to Slack</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
