// Vercel serverless function - receives a full database backup (the
// same JSON shape the Admin > Backup panel's "Export All Data" button
// produces) and commits it to a GitHub repo, so a copy of the data
// exists somewhere durable and completely outside Dexie Cloud. If
// Dexie Cloud itself ever had a serious incident, this is the copy a
// fresh database would be restored from.
//
// GitHub was chosen over other storage options specifically because
// this repo already lives there - no new account, and every backup is
// its own commit, so the full history of past backups is free and
// browsable on github.com with nothing extra to build.
//
// Writes to a DEDICATED branch (BRANCH below), never to main. The
// first version of this shipped without that, committing straight to
// main - within a day it had already collided with a normal
// development push (two unrelated histories fighting over the same
// branch tip) and added a multi-megabyte JSON file to every future
// `git pull` on this repo. A separate branch means backups can never
// conflict with real development work again, and anyone cloning main
// never has to download backup history they don't want.
//
// Called from src/services/backupWorker.js, which runs in the
// background on any logged-in device, throttled to once a day via a
// shared timestamp in db.reportConfig - this endpoint itself has no
// concept of "once a day," it just writes whatever it's given.

const APP_SHARED_KEY = process.env.VITE_APP_SHARED_KEY
const GITHUB_TOKEN = process.env.GITHUB_BACKUP_TOKEN
const GITHUB_OWNER = process.env.GITHUB_BACKUP_OWNER || 'arveedev'
const GITHUB_REPO = process.env.GITHUB_BACKUP_REPO || 'ArVeeBSM'
const BRANCH = process.env.GITHUB_BACKUP_BRANCH || 'backups'
// How many daily backups to keep before the oldest are pruned - about
// a month's worth. Each is a small JSON file and its own commit, so
// this is a generous cushion, not a tight limit. Note: pruning removes
// the FILE from the branch's current state, but - same as any git
// history - the branch's commit history still grows by one commit per
// day forever. At ~6MB per daily snapshot, that's a real, slow-growing
// repo size cost worth knowing about; squashing that branch's history
// periodically (keeping only the latest commit) would cap it, but
// isn't built here yet.
const RETENTION_COUNT = 30

async function readJsonBody(req) {
  // Same defensive parsing as dexie-cloud-tokens.js - Vercel's
  // automatic req.body parsing has been unreliable in some dev
  // configurations.
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

const githubHeaders = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'User-Agent': 'bsm-app-backup',
}

// GitHub's Contents API (used for everything else below) refuses to
// write to a branch that doesn't exist yet - it never auto-creates
// one. This creates BRANCH, pointed at the repo's current default
// branch tip, the first time this function ever runs; every later
// call sees the branch already exists and does nothing.
const ensureBranchExists = async () => {
  const existing = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${BRANCH}`,
    { headers: githubHeaders }
  )
  if (existing.ok) return

  const repoInfo = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`,
    { headers: githubHeaders }
  )
  if (!repoInfo.ok) throw new Error(`Could not read repo info to create ${BRANCH} branch: HTTP ${repoInfo.status}`)
  const { default_branch: defaultBranch } = await repoInfo.json()

  const defaultRef = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${defaultBranch}`,
    { headers: githubHeaders }
  )
  if (!defaultRef.ok) throw new Error(`Could not read ${defaultBranch} ref to create ${BRANCH} branch: HTTP ${defaultRef.status}`)
  const { object: { sha: baseSha } } = await defaultRef.json()

  const createRef = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`,
    {
      method: 'POST',
      headers: githubHeaders,
      body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: baseSha }),
    }
  )
  if (!createRef.ok) {
    const detail = await createRef.text()
    throw new Error(`Could not create ${BRANCH} branch: HTTP ${createRef.status} ${detail}`)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Same shared-key gate as dexie-cloud-tokens.js - without it, this
  // endpoint (once its URL is known) would let anyone commit arbitrary
  // content to this repo. Fails safe (skips the check) if the env var
  // isn't set, matching the same rollout reasoning as that endpoint.
  if (APP_SHARED_KEY && req.headers['x-bsm-app-key'] !== APP_SHARED_KEY) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (!GITHUB_TOKEN) {
    res.status(500).json({ error: 'Server is missing GITHUB_BACKUP_TOKEN environment variable' })
    return
  }

  try {
    await ensureBranchExists()

    const payload = await readJsonBody(req)
    const stamp = new Date().toISOString().slice(0, 10)
    const path = `backups/bsm-backup-${stamp}.json`
    const content = Buffer.from(JSON.stringify(payload, null, 2)).toString('base64')

    // A second automatic backup landing on the same calendar date (two
    // devices both crossing the 24h throttle within the same check
    // window) overwrites today's file rather than erroring - GitHub's
    // Contents API requires the existing file's sha to update it, so
    // this looks it up first. A brand new day has no existing file,
    // which is expected, not an error.
    let sha
    const existing = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${BRANCH}`,
      { headers: githubHeaders }
    )
    if (existing.ok) {
      sha = (await existing.json()).sha
    }

    const putResponse = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
      {
        method: 'PUT',
        headers: githubHeaders,
        body: JSON.stringify({
          message: `Automatic backup ${stamp}`,
          content,
          branch: BRANCH,
          ...(sha ? { sha } : {}),
        }),
      }
    )
    if (!putResponse.ok) {
      const detail = await putResponse.text()
      res.status(502).json({ error: 'GitHub write failed', detail })
      return
    }

    // Retention sweep - list what's in backups/ and prune anything
    // beyond RETENTION_COUNT, oldest first (filenames are date-
    // stamped, so a plain name sort is already chronological). A
    // failure here doesn't fail the whole request - the actual backup
    // above already succeeded, and pruning can simply catch up next run.
    try {
      const listResponse = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/backups?ref=${BRANCH}`,
        { headers: githubHeaders }
      )
      if (listResponse.ok) {
        const files = await listResponse.json()
        const backupFiles = files
          .filter((f) => f.type === 'file' && f.name.endsWith('.json'))
          .sort((a, b) => a.name.localeCompare(b.name))
        const toDelete = backupFiles.slice(0, Math.max(0, backupFiles.length - RETENTION_COUNT))
        for (const file of toDelete) {
          await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${file.path}`,
            {
              method: 'DELETE',
              headers: githubHeaders,
              body: JSON.stringify({ message: `Prune old backup ${file.name}`, sha: file.sha, branch: BRANCH }),
            }
          )
        }
      }
    } catch (pruneErr) {
      console.error('[backup-to-github] Retention prune failed (backup itself still succeeded):', pruneErr)
    }

    res.status(200).json({ ok: true, path, branch: BRANCH })
  } catch (err) {
    console.error('[backup-to-github] Unexpected error:', err)
    res.status(500).json({ error: 'Unexpected server error', detail: err.message })
  }
}
