import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import session from 'express-session'
import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { MongoSessionStore } from './lib/session-store.js'
import { fetchProjects } from './lib/linear.js'
import { buildForest, partitionCompleted } from './lib/tree.js'
import { renderPage } from './lib/render.js'
import { parseLandingPage } from './lib/parse-landing.js'

// Parse landing page content at startup
const landingData = parseLandingPage('./content/landing.md')
const landingForest = buildForest(landingData.issues)
const landingTrees = landingData.projects
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map(project => {
    const { roots } = landingForest.get(project.id) || { roots: [] }
    const { incomplete, completed, completedCount } = partitionCompleted(roots)
    return { project, incomplete, completed, completedCount }
  })

// Initialize DB client (MongoDB in production, MangoDB in development)
const dbClient = process.env.MONGODB_URI
  ? new MongoClient(process.env.MONGODB_URI)
  : new MangoClient('./data')

await dbClient.connect()
const db = dbClient.db('linear-viewer')
const sessionsCollection = db.collection('sessions')

const sessionStore = new MongoSessionStore({
  collection: sessionsCollection,
  ttl: 24 * 60 * 60 // 24 hours in seconds
})

const app = express()

app.use(express.static('public'))

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}))

// Test-only route and mock data (only available in test mode)
if (process.env.NODE_ENV === 'test') {
  app.get('/test/set-session', (req, res) => {
    req.session.accessToken = 'test-token'
    // Explicitly save session before responding to ensure it's persisted
    req.session.save((err) => {
      if (err) {
        res.status(500).send('session error')
      } else {
        res.send('ok')
      }
    })
  })
}

// Mock data for testing
const testMockData = {
  organizationName: 'Test Workspace',
  projects: [
    { id: 'proj-alpha', name: 'Project Alpha', content: 'First test project', url: 'https://linear.app/test/project/proj-alpha', sortOrder: 1 },
    { id: 'proj-beta', name: 'Project Beta', content: 'Second test project', url: 'https://linear.app/test/project/proj-beta', sortOrder: 2 }
  ],
  issues: [
    { id: 'issue-1', title: 'Parent task in progress', description: 'This is a parent task', estimate: 5, priority: 2, sortOrder: 1, createdAt: '2024-01-01T00:00:00Z', dueDate: '2024-02-01', completedAt: null, url: 'https://linear.app/test/issue/TEST-1', parent: null, project: { id: 'proj-alpha' }, state: { name: 'In Progress', type: 'started' }, assignee: { name: 'Alice' }, labels: { nodes: [{ name: 'feature' }] } },
    { id: 'issue-2', title: 'Child task todo', description: 'A child task', estimate: 2, priority: 3, sortOrder: 2, createdAt: '2024-01-02T00:00:00Z', dueDate: null, completedAt: null, url: 'https://linear.app/test/issue/TEST-2', parent: { id: 'issue-1' }, project: { id: 'proj-alpha' }, state: { name: 'Todo', type: 'unstarted' }, assignee: null, labels: { nodes: [] } },
    { id: 'issue-3', title: 'Completed task', description: 'This task is done', estimate: 1, priority: 4, sortOrder: 3, createdAt: '2024-01-03T00:00:00Z', dueDate: null, completedAt: '2024-01-10T00:00:00Z', url: 'https://linear.app/test/issue/TEST-3', parent: null, project: { id: 'proj-alpha' }, state: { name: 'Done', type: 'completed' }, assignee: { name: 'Bob' }, labels: { nodes: [{ name: 'bug' }] } },
    { id: 'issue-4', title: 'Beta task in progress', description: 'An in-progress task in Beta', estimate: 3, priority: 1, sortOrder: 1, createdAt: '2024-01-04T00:00:00Z', dueDate: '2024-03-01', completedAt: null, url: 'https://linear.app/test/issue/TEST-4', parent: null, project: { id: 'proj-beta' }, state: { name: 'In Progress', type: 'started' }, assignee: { name: 'Charlie' }, labels: { nodes: [{ name: 'urgent' }] } },
    { id: 'issue-5', title: 'Beta todo task', description: 'A todo task in Beta', estimate: null, priority: 0, sortOrder: 2, createdAt: '2024-01-05T00:00:00Z', dueDate: null, completedAt: null, url: 'https://linear.app/test/issue/TEST-5', parent: null, project: { id: 'proj-beta' }, state: { name: 'Backlog', type: 'backlog' }, assignee: null, labels: { nodes: [] } }
  ]
}

// OAuth: Redirect to Linear
app.get('/auth/linear', (req, res) => {
  sessionStore.cleanup()

  const state = crypto.randomUUID()
  req.session.oauthState = state

  const params = new URLSearchParams({
    client_id: process.env.LINEAR_CLIENT_ID,
    redirect_uri: process.env.LINEAR_REDIRECT_URI,
    response_type: 'code',
    scope: 'read',
    state
  })

  res.redirect(`https://linear.app/oauth/authorize?${params}`)
})

// OAuth: Handle callback
app.get('/auth/callback', async (req, res) => {
  sessionStore.cleanup()

  const { code, state, error } = req.query

  if (error) {
    return res.status(400).send(`<pre>OAuth error: ${error}</pre>`)
  }

  if (state !== req.session.oauthState) {
    return res.status(400).send('<pre>Invalid state parameter</pre>')
  }

  try {
    const response = await fetch('https://api.linear.app/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.LINEAR_CLIENT_ID,
        client_secret: process.env.LINEAR_CLIENT_SECRET,
        redirect_uri: process.env.LINEAR_REDIRECT_URI,
        code
      })
    })

    const data = await response.json()

    if (!response.ok) {
      return res.status(400).send(`<pre>Token error: ${data.error || 'Unknown error'}</pre>`)
    }

    req.session.accessToken = data.access_token
    res.redirect('/')
  } catch (err) {
    console.error('OAuth callback error:', err)
    res.status(500).send(`<pre>Error: ${err.message}</pre>`)
  }
})

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy()
  res.redirect('/')
})

// Main page
app.get('/', async (req, res) => {
  if (!req.session.accessToken) {
    const html = renderPage(landingTrees, [], landingData.organizationName, { isLanding: true })
    return res.send(html)
  }

  try {
    // Use mock data in test mode
    const isTestMode = process.env.NODE_ENV === 'test' && req.session.accessToken === 'test-token'
    const { organizationName, projects, issues } = isTestMode
      ? testMockData
      : await fetchProjects(req.session.accessToken)
    const forest = buildForest(issues)

    // Extract in-progress issues with project names
    const inProgressIssues = issues
      .filter(i => i.state?.type === 'started')
      .map(issue => ({
        ...issue,
        projectName: projects.find(p => p.id === issue.project?.id)?.name
      }))
      .sort((a, b) => {
        // Priority: 1=Urgent, 2=High, 3=Medium, 4=Low, 0=None
        // Lower number = higher priority, but 0 (none) should sort last
        const aPriority = a.priority || 5
        const bPriority = b.priority || 5
        if (aPriority !== bPriority) return aPriority - bPriority
        // Tiebreaker: createdAt (oldest first, matching Linear's default)
        return new Date(a.createdAt) - new Date(b.createdAt)
      })

    const trees = projects
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(project => {
        const { roots } = forest.get(project.id) || { roots: [] }
        const { incomplete, completed, completedCount } = partitionCompleted(roots)
        return { project, incomplete, completed, completedCount }
      })

    const html = renderPage(trees, inProgressIssues, organizationName)
    res.send(html)
  } catch (error) {
    console.error('Error fetching projects:', error)

    // If unauthorized, clear session and show landing
    if (error.response?.status === 401) {
      req.session.destroy()
      const html = renderPage(landingTrees, [], landingData.organizationName, { isLanding: true })
      return res.send(html)
    }

    res.status(500).send(`<pre>Error: ${error.message}</pre>`)
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Linear Projects Viewer running at http://localhost:${PORT}`)
})
