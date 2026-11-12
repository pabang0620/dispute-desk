import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// README and DEVPOST quote VERIFY.md. These tests fail when a status line in the docs says more (or other)
// than VERIFY records, or when the hosted address differs between them (REVIEW_5 improve loop).

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const README = read('README.md')
const DEVPOST = read('../DEVPOST.md')
const VERIFY = read('VERIFY.md')

const ids = (text) => new Set([...text.matchAll(/\bR(\d{1,2})\b/g)].map((m) => `R${m[1]}`))

function sections(md) {
  const out = new Map()
  const parts = md.split(/^## /m).slice(1)
  for (const part of parts) {
    const [title, ...rest] = part.split('\n')
    out.set(title.trim(), rest.join('\n'))
  }
  return out
}

// Status per VERIFY item, taken from its first "Result" line.
function verifyStatuses() {
  const out = new Map()
  for (const [title, body] of sections(VERIFY)) {
    const id = title.match(/^(R\d{1,2})\./)?.[1]
    if (!id) continue
    const line = body.split('\n').find((l) => /Result/.test(l))
    const status = line?.match(/\b(PASS|PARTIAL|SKIPPED|FAIL)\b/)?.[1]
    assert.ok(status, `VERIFY ${id} has a Result line with a status`)
    out.set(id, status)
  }
  return out
}

function readmeEvidence() {
  const block = sections(README).get('Sandbox evidence (VERIFY.md, 2026-11-12)')
  assert.ok(block, 'README has the Sandbox evidence section')
  const [passPart, rest] = block.split(/^PARTIAL:/m)
  const [partialPart, notClaimed] = rest.split(/^Not claimed:/m)
  const pass = new Set([...passPart.matchAll(/^- \*\*(R\d{1,2})\*\*/gm)].map((m) => m[1]))
  return { pass, partial: ids(partialPart), notClaimed: ids(notClaimed.split('\n')[0]) }
}

test('README PASS list is exactly the VERIFY items marked PASS', () => {
  const status = verifyStatuses()
  const { pass } = readmeEvidence()
  const verifyPass = [...status].filter(([, s]) => s === 'PASS').map(([id]) => id).sort()
  assert.deepEqual([...pass].sort(), verifyPass)
})

test('README PARTIAL and Not claimed lines match VERIFY', () => {
  const status = verifyStatuses()
  const { partial, notClaimed } = readmeEvidence()
  for (const id of partial) assert.equal(status.get(id), 'PARTIAL', `README PARTIAL ${id}`)
  for (const id of notClaimed) assert.ok(status.has(id) && status.get(id) !== 'PASS', `README Not claimed ${id} is ${status.get(id)} in VERIFY`)
  for (const [id, s] of status) if (s === 'SKIPPED') assert.ok(notClaimed.has(id), `VERIFY SKIPPED ${id} is listed under Not claimed`)
})

test('DEVPOST "Proven today" cites only PASS items, "Needs" cites none', () => {
  const status = verifyStatuses()
  const proven = DEVPOST.split('\n').find((l) => l.startsWith('- **Proven today:**'))
  const needs = DEVPOST.split('\n').find((l) => l.startsWith('- **Needs PayPal or partners:**'))
  assert.ok(proven && needs, 'DEVPOST has both status lines')
  assert.ok(ids(proven).size > 0)
  for (const id of ids(proven)) assert.equal(status.get(id), 'PASS', `DEVPOST Proven today cites ${id}`)
  for (const id of ids(needs)) assert.notEqual(status.get(id), 'PASS', `DEVPOST Needs cites ${id}, which VERIFY marks PASS`)
})

test('hosted URL and mode in README and DEVPOST are the ones VERIFY checked', () => {
  const hosting = sections(VERIFY).get('Hosting')
  assert.ok(hosting, 'VERIFY has a Hosting section')
  const result = hosting.split('\n').find((l) => /Result/.test(l))
  assert.match(result, /\bPASS\b/, 'hosting is only advertised after VERIFY passes it')
  const url = result.match(/https:\/\/[^\s)]+?(?=[\s)]|\.?\s)/)?.[0].replace(/\.$/, '')
  assert.ok(url, 'VERIFY Hosting names the URL')
  for (const [name, doc] of [['README', README], ['DEVPOST', DEVPOST]]) {
    const line = doc.split('\n').find((l) => l.startsWith('**Try it:**'))
    assert.ok(line, `${name} has a Try it line`)
    assert.equal(line.match(/https:\/\/\S+/)[0], url, `${name} Try it URL`)
    assert.doesNotMatch(line, /live PayPal|real PayPal|sandbox mode/i, `${name} Try it line claims a mode VERIFY did not run`)
  }
})

test('docs do not mention a hosted address other than the verified one', () => {
  const hosted = /https:\/\/[a-z0-9.-]+\.(?:sslip\.io|nip\.io|vercel\.app|onrender\.com|fly\.dev|railway\.app)\S*/g
  const url = sections(VERIFY).get('Hosting').match(/https:\/\/\S+?sslip\.io/)[0]
  for (const [name, doc] of [['README', README], ['DEVPOST', DEVPOST]]) {
    for (const m of doc.matchAll(hosted)) assert.equal(m[0].replace(/[).,]+$/, ''), url, `${name}: ${m[0]}`)
  }
})
