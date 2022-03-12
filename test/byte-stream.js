// All tests have been taken directly from Bittrie.
// (with modifications to inject RemoteUnichains)

const tape = require('tape')
const ram = require('random-access-memory')
const byteStream = require('@bitweb/unichain-byte-stream')
const BitspaceClient = require('../client')
const BitspaceServer = require('../server')

let server = null
let client = null
let cleanup = null

function createLocal (numRecords, recordSize, cb) {
  const chainstore = client.chainstore()
  const chain = chainstore.get()

  const records = []
  for (let i = 0; i < numRecords; i++) {
    const record = Buffer.allocUnsafe(recordSize).fill(Math.floor(Math.random() * 10))
    records.push(record)
  }

  chain.append(records, err => {
    if (err) return cb(err)
    const stream = byteStream()
    return cb(null, chain, chain, stream, records)
  })
}

require('@web4/unichain-byte-stream/test/helpers/create').createLocal = createLocal

tape('start', async function (t) {
  server = new BitspaceServer({ storage: ram })
  await server.ready()

  client = new BitspaceClient()
  await client.ready()

  cleanup = () => Promise.all([
    server.close(),
    client.close()
  ])

  t.end()
})

require('@web4/unichain-byte-stream/test/basic')

tape('end', async function (t) {
  await cleanup()
  t.end()
})
