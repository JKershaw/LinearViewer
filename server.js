import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import session from 'express-session'
import { fetchRoadmap } from './lib/linear.js'
import { buildForest, partitionCompleted } from './lib/tree.js'
import { renderPage, renderLoginPage } from './lib/render.js'

const app = express()

app.use(express.static('public'))

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}))

// OAuth: Redirect to Linear
app.get('/auth/linear', (req, res) => {
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
    return res.send(renderLoginPage())
  }

  try {
    const { projects, issues } = await fetchRoadmap(req.session.accessToken)
    const forest = buildForest(issues)

    const trees = projects
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(project => {
        const { roots } = forest.get(project.id) || { roots: [] }
        const { incomplete, completed, completedCount } = partitionCompleted(roots)
        return { project, incomplete, completed, completedCount }
      })

    const html = renderPage(trees)
    res.send(html)
  } catch (error) {
    console.error('Error fetching roadmap:', error)

    // If unauthorized, clear session and show login
    if (error.response?.status === 401) {
      req.session.destroy()
      return res.send(renderLoginPage())
    }

    res.status(500).send(`<pre>Error: ${error.message}</pre>`)
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Roadmap server running at http://localhost:${PORT}`)
})
