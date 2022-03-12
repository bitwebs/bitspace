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

require('@web4/bittrietest/helpers/create').create = create

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

require('@web4/bittrietest/basic')
require('@web4/bittrietest/diff')
require('@web4/bittrietest/hidden')
require('@web4/bittrietest/iterator')
require('@web4/bittrietest/history')
// require('@web4/bittrietest/watch')
require('@web4/bittrietest/closest')
require('@web4/bittrietest/deletes')

tape('end', async function (t) {
  await cleanup()
  t.end()
})
