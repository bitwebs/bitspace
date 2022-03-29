// All tests have been taken directly from BitTrie.
// (with modifications to inject RemoteUnichains)

const tape = require('tape')
const bittrie = require('@web4/bittrie')
const ram = require('random-access-memory')

const BitspaceClient = require('../client')
const BitspaceServer = require('../server')

let server = null
let client = null
let cleanup = null

function create (key, opts) {
  const chainstore = client.chainstore()
  const feed = chainstore.get(key)
  return bittrie(null, null, {
    valueEncoding: 'json',
    ...opts,
    extension: false,
    feed
  })
}

require('@web4/bittrie/test/helpers/create').create = create

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

require('@web4/bittrie/test/basic')
require('@web4/bittrie/test/diff')
require('@web4/bittrie/test/hidden')
require('@web4/bittrie/test/iterator')
require('@web4/bittrie/test/history')
// require('@web4/bittrie/test/watch')
require('@web4/bittrie/test/closest')
require('@web4/bittrie/test/deletes')

tape('end', async function (t) {
  await cleanup()
  t.end()
})
