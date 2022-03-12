const test = require('tape')
const bittrie = require('@web4/bittrie')
const bitdrive = require('@web4/bitdrive')

const { createOne } = require('./helpers/create')

test('can open a chain', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain = chainstore.get()
  await chain.ready()

  t.same(chain.byteLength, 0)
  t.same(chain.length, 0)
  t.same(chain.key.length, 32)
  t.same(chain.discoveryKey.length, 32)

  await cleanup()
  t.end()
})

test('can get a block', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain = chainstore.get()
  await chain.ready()

  await chain.append(Buffer.from('hello world', 'utf8'))
  const block = await chain.get(0)
  t.same(block.toString('utf8'), 'hello world')

  await cleanup()
  t.end()
})

test('length/byteLength update correctly on append', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain = chainstore.get()
  await chain.ready()

  let appendedCount = 0
  chain.on('append', () => {
    appendedCount++
  })

  const buf = Buffer.from('hello world', 'utf8')
  let seq = await chain.append(buf)
  t.same(seq, 0)
  t.same(chain.byteLength, buf.length)
  t.same(chain.length, 1)

  seq = await chain.append([buf, buf])
  t.same(seq, 1)
  t.same(chain.byteLength, buf.length * 3)
  t.same(chain.length, 3)

  t.same(appendedCount, 2)

  await cleanup()
  t.end()
})

test('downloaded gives the correct result after append', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain = chainstore.get()
  await chain.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await chain.append([buf, buf, buf])
  const downloaded = await chain.downloaded()
  t.same(downloaded, 3)

  await cleanup()
  t.end()
})

test('update with current length returns', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain = chainstore.get()
  await chain.ready()

  const buf = Buffer.from('hello world', 'utf8')
  const seq = await chain.append(buf)
  t.same(seq, 0)
  t.same(chain.byteLength, buf.length)
  t.same(chain.length, 1)

  await chain.update(1)
  t.pass('update terminated')

  try {
    await chain.update({ ifAvailable: true })
    t.fail('should not get here')
  } catch (err) {
    t.true(err, 'should error with no peers')
  }

  await cleanup()
  t.end()
})

test('appending many large blocks works', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain = chainstore.get()
  await chain.ready()

  const NUM_BLOCKS = 200
  const BLOCK_SIZE = 1e5

  const bufs = (new Array(NUM_BLOCKS).fill(0)).map(() => {
    return Buffer.allocUnsafe(BLOCK_SIZE)
  })
  const seq = await chain.append(bufs)
  t.same(seq, 0)
  t.same(chain.byteLength, NUM_BLOCKS * BLOCK_SIZE)

  await cleanup()
  t.end()
})

test('seek works correctly', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain = chainstore.get()
  await chain.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await chain.append([buf, buf])

  {
    const { seq, blockOffset } = await chain.seek(0)
    t.same(seq, 0)
    t.same(blockOffset, 0)
  }

  {
    const { seq, blockOffset } = await chain.seek(5)
    t.same(seq, 0)
    t.same(blockOffset, 5)
  }

  {
    const { seq, blockOffset } = await chain.seek(15)
    t.same(seq, 1)
    t.same(blockOffset, 4)
  }

  await cleanup()
  t.end()
})

test('has works correctly', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain = chainstore.get()
  await chain.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await chain.append(buf)

  const doesHave = await chain.has(0)
  const doesNotHave = await chain.has(1)
  t.true(doesHave)
  t.false(doesNotHave)

  await chain.close()
  await cleanup()
  t.end()
})

test('download works correctly', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain = chainstore.get()
  await chain.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await chain.append(buf)

  for (let i = 0; i < 3; i++) {
    const prom = chain.download({ start: 0, end: 10 })
    await chain.undownload(prom)

    try {
      await prom
    } catch (err) {
      t.same(err.message, 'Download was cancelled')
    }
  }

  await chain.close()
  await cleanup()
  t.end()
})

test('valueEncodings work', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain = chainstore.get({ valueEncoding: 'utf8' })
  await chain.ready()

  await chain.append('hello world')
  const block = await chain.get(0)
  t.same(block, 'hello world')

  await cleanup()
  t.end()
})

test('chainstore default get works', async t => {
  const { client, cleanup } = await createOne()

  const ns1 = client.chainstore('blah')
  const ns2 = client.chainstore('blah2')

  var chain = ns1.default()
  await chain.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await chain.append(buf)
  await chain.close()

  // we have a timing thing here we should fix
  await new Promise(resolve => setTimeout(resolve, 500))
  chain = ns1.default()
  await chain.ready()

  t.same(chain.length, 1)
  t.true(chain.writable)

  chain = ns2.default()
  await chain.ready()
  t.same(chain.length, 0)

  await cleanup()
  t.end()
})

test('weak references work', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain1 = chainstore.get()
  await chain1.ready()

  const chain2 = chainstore.get(chain1.key, { weak: true })
  await chain2.ready()

  await chain1.append(Buffer.from('hello world', 'utf8'))
  t.same(chain2.length, 1)

  const closed = new Promise((resolve) => chain2.once('close', resolve))
  await chain1.close()

  await closed
  t.pass('closed')
  await cleanup()
  t.end()
})

test('chainstore feed event fires', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const emittedFeeds = []
  const emittedProm = new Promise(resolve => {
    chainstore.on('feed', async feed => {
      t.same(feed._id, undefined)
      emittedFeeds.push(feed)
      if (emittedFeeds.length === 3) {
        await onAllEmitted()
        return resolve()
      }
    })
  })

  const chain1 = chainstore.get()
  await chain1.ready()
  const chain2 = chainstore.get()
  await chain2.ready()
  const chain3 = chainstore.get()
  await chain3.ready()
  await emittedProm

  async function onAllEmitted () {
    for (const feed of emittedFeeds) {
      await feed.ready()
    }
    t.true(emittedFeeds[0].key.equals(chain1.key))
    t.true(emittedFeeds[1].key.equals(chain2.key))
    t.true(emittedFeeds[2].key.equals(chain3.key))
    await cleanup()
    t.end()
  }
})

test('can lock and release', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain1 = chainstore.get()
  await chain1.ready()

  const release = await chain1.lock()

  let unlocked = false
  const other = chain1.lock()

  t.pass('locked')
  other.then(() => t.ok(unlocked))
  await new Promise(resolve => setTimeout(resolve, 500))

  release()
  unlocked = true
  await other
  await cleanup()
  t.end()
})

test('cancel a get', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain = chainstore.get()

  const prom1 = chain.get(42, { ifAvailable: false })
  const prom2 = chain.get(43, { ifAvailable: false })

  let cancel1 = false
  let cancel2 = false

  prom1.catch((err) => {
    cancel1 = true
    t.notOk(cancel2, 'cancelled promise 1 first')
    t.ok(err, 'got error')
    chain.cancel(prom2)
  })
  prom2.catch((err) => {
    cancel2 = true
    t.ok(cancel1, 'cancelled promise 1 first')
    t.ok(err, 'got error')
  })

  chain.cancel(prom1)

  try {
    await prom1
    await prom2
  } catch (_) {}

  await cleanup()
  t.end()
})

test('onwait', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain = chainstore.get()

  const a = chain.get(42, {
    onwait (seq) {
      t.ok('should wait')
      t.same(seq, 42)
      chain.cancel(a)
    }
  })

  const b = chain.get(43, {
    onwait (seq) {
      t.ok('should wait')
      t.same(seq, 43)
      chain.cancel(b)
    }
  })

  try {
    await a
  } catch (_) {}
  try {
    await b
  } catch (_) {}

  await cleanup()
  t.end()
})

test('onwait only on missing blocks', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain = chainstore.get()
  await chain.ready()

  await chain.append(Buffer.from('hello world', 'utf8'))
  const block = await chain.get(0, {
    onwait () {
      t.notOk('should not wait')
    }
  })
  t.same(block.toString('utf8'), 'hello world')

  await cleanup()
  t.end()
})

test('can run a bittrie on remote unichain', async t => {
  const { client, cleanup } = await createOne()

  const chainstore = client.chainstore()
  const chain = chainstore.default()
  await chain.ready()

  const trie = bittrie(null, null, {
    feed: chain,
    extension: false,
    valueEncoding: 'utf8'
  })
  await new Promise(resolve => {
    trie.ready(err => {
      t.error(err, 'no error')
      trie.put('/hello', 'world', err => {
        t.error(err, 'no error')
        trie.get('/hello', (err, node) => {
          t.error(err, 'no error')
          t.same(node.value, 'world')
          return resolve()
        })
      })
    })
  })

  await cleanup()
  t.end()
})

test('can run a bitdrive on a remote unichain', async t => {
  const { client, cleanup } = await createOne()

  const drive = bitdrive(client.chainstore(), null, {
    valueEncoding: 'utf8'
  })
  await new Promise(resolve => {
    drive.ready(err => {
      t.error(err, 'no error')
      drive.writeFile('/hello', 'world', err => {
        t.error(err, 'no error')
        drive.readFile('/hello', { encoding: 'utf8' }, (err, contents) => {
          t.error(err, 'no error')
          t.same(contents, 'world')
          return resolve()
        })
      })
    })
  })

  await cleanup()
  t.end()
})

test('can connect over a tcp socket', async t => {
  const { client, cleanup } = await createOne({
    port: 8199
  })

  const chainstore = client.chainstore()
  const chain = chainstore.get()
  await chain.ready()

  t.same(chain.byteLength, 0)
  t.same(chain.length, 0)
  t.same(chain.key.length, 32)
  t.same(chain.discoveryKey.length, 32)

  await cleanup()
  t.end()
})

test('handles chainstore gc correctly', async t => {
  const { client, cleanup } = await createOne({
    cacheSize: 1
  })
  const store1 = client.chainstore()
  const store2 = client.chainstore()

  const chain1 = store1.get()
  await chain1.ready()

  const chain2 = store2.get()
  const chain3 = store2.get(chain1.key)
  await chain2.ready()
  await chain3.ready()

  try {
    await chain3.append('hello world')
    t.pass('append did not error')
  } catch (err) {
    t.fail(err)
  }

  await cleanup()
  t.end()
})
