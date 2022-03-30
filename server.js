const path = require('path')
const os = require('os')

const Chainstore = require('@web4/chainstore')
const Networker = require('@web4/chainstore-networker')
const UnichainCache = require('@web4/unichain-cache')
const BitProtocol = require('@web4/bit-protocol')
const unichainStorage = require('@web4/unichain-default-storage')
const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')

const HRPC = require('bitspace-rpc')
const getNetworkOptions = require('bitspace-rpc/socket')

const BitspaceDb = require('./lib/db')
const SessionState = require('./lib/session-state')
const ChainstoreSession = require('./lib/sessions/chainstore')
const UnichainSession = require('./lib/sessions/unichain')
const NetworkSession = require('./lib/sessions/network')
const startTrieExtension = require('./extensions/trie')

const TOTAL_CACHE_SIZE = 1024 * 1024 * 512
const CACHE_RATIO = 0.5
const TREE_CACHE_SIZE = TOTAL_CACHE_SIZE * CACHE_RATIO
const DATA_CACHE_SIZE = TOTAL_CACHE_SIZE * (1 - CACHE_RATIO)

const DEFAULT_STORAGE_DIR = path.join(os.homedir(), '.bitspace', 'storage')
const MAX_PEERS = 256
const SWARM_PORT = 49737
const NAMESPACE = '@bitweb/bitspace'

module.exports = class Bitspace extends Nanoresource {
  constructor (opts = {}) {
    super()

    var storage = opts.storage || DEFAULT_STORAGE_DIR
    if (typeof storage === 'string') {
      const storagePath = storage
      storage = p => unichainStorage(path.join(storagePath, p))
    }

    const chainstoreOpts = {
      storage,
      cacheSize: opts.cacheSize,
      sparse: opts.sparse !== false,
      // Collect networking statistics.
      stats: true,
      cache: {
        data: new UnichainCache({
          maxByteSize: DATA_CACHE_SIZE,
          estimateSize: val => val.length
        }),
        tree: new UnichainCache({
          maxByteSize: TREE_CACHE_SIZE,
          estimateSize: val => 40
        })
      },
      ifAvailable: true
    }
    this.chainstore = new Chainstore(chainstoreOpts.storage, chainstoreOpts)
    startTrieExtension(this.chainstore)

    this.server = HRPC.createServer(opts.server, this._onConnection.bind(this))
    this.db = new BitspaceDb(this.chainstore)
    this.networker = null

    this.noAnnounce = !!opts.noAnnounce

    this._networkOpts = {
      announceLocalNetwork: true,
      preferredPort: SWARM_PORT,
      maxPeers: MAX_PEERS,
      ...opts.network
    }
    this._socketOpts = getNetworkOptions(opts)
    this._networkState = new Map()
  }

  // Nanoresource Methods

  async _open () {
    await this.chainstore.ready()
    await this.db.open()

    // Note: This API is not exposed anymore -- this is a temporary fix.
    const seed = this.chainstore.inner._deriveSecret(NAMESPACE, 'replication-keypair')
    const swarmId = this.chainstore.inner._deriveSecret(NAMESPACE, 'swarm-id')
    this.networker = new Networker(this.chainstore, {
      keyPair: BitProtocol.keyPair(seed),
      id: swarmId,
      ...this._networkOpts
    })
    await this.networker.listen()

    this._registerCoreTimeouts()
    await this._rejoin()

    await this.server.listen(this._socketOpts)
  }

  async _close () {
    await this.server.close()
    await this.networker.close()
    await this.db.close()
    await new Promise((resolve, reject) => {
      this.chainstore.close(err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  // Public Methods

  ready () {
    return this.open()
  }

  // Private Methods

  async _rejoin () {
    if (this.noAnnounce) return
    const networkConfigurations = await this.db.listNetworkConfigurations()
    for (const config of networkConfigurations) {
      if (!config.announce) continue
      const joinProm = this.networker.configure(config.discoveryKey, {
        announce: config.announce,
        lookup: config.lookup,
        // remember/discoveryKey are passed so that they will be saved in the networker's internal configurations list.
        remember: true,
        discoveryKey: config.discoveryKey
      })
      joinProm.catch(err => this.emit('swarm-error', err))
    }
  }

  /**
   * This is where we define our main heuristic for allowing unichain gets/updates to proceed.
   */
  _registerCoreTimeouts () {
    const flushSets = new Map()

    this.networker.on('flushed', dkey => {
      const keyString = dkey.toString('hex')
      if (!flushSets.has(keyString)) return
      const { flushSet, peerAddSet } = flushSets.get(keyString)
      callAllInSet(flushSet)
      callAllInSet(peerAddSet)
    })

    this.chainstore.on('feed', chain => {
      const discoveryKey = chain.discoveryKey
      const peerAddSet = new Set()
      const flushSet = new Set()
      var globalFlushed = false

      if (!this.networker.swarm || this.networker.swarm.destroyed) return
      this.networker.swarm.flush(() => {
        if (this.networker.joined(discoveryKey)) return
        globalFlushed = true
        callAllInSet(flushSet)
        callAllInSet(peerAddSet)
      })

      flushSets.set(discoveryKey.toString('hex'), { flushSet, peerAddSet })
      chain.once('peer-add', () => {
        callAllInSet(peerAddSet)
      })

      const timeouts = {
        get: (cb) => {
          if (this.networker.joined(discoveryKey)) {
            if (this.networker.flushed(discoveryKey)) return cb()
            return flushSet.add(cb)
          }
          if (globalFlushed) return cb()
          return flushSet.add(cb)
        },
        update: (cb) => {
          const oldCb = cb
          cb = (...args) => {
            oldCb(...args)
          }
          if (chain.peers.length) return cb()
          if (this.networker.joined(discoveryKey)) {
            if (this.networker.flushed(discoveryKey) && !chain.peers.length) return cb()
            return peerAddSet.add(cb)
          }
          if (globalFlushed) return cb()
          return peerAddSet.add(cb)
        }
      }
      chain.timeouts = timeouts
    })
  }

  _onConnection (client) {
    const sessionState = new SessionState(this.chainstore)

    this.emit('client-open', client)

    client.on('close', () => {
      sessionState.deleteAll()
      this.emit('client-close', client)
    })

    client.bitspace.onRequest(this)
    client.chainstore.onRequest(new ChainstoreSession(client, sessionState, this.chainstore))
    client.unichain.onRequest(new UnichainSession(client, sessionState))
    client.network.onRequest(new NetworkSession(client, sessionState, this.chainstore, this.networker, this.db, this._networkState, {
      noAnnounce: this.noAnnounce
    }))
  }

  // Top-level RPC Methods

  status () {
    const swarm = this.networker && this.networker.swarm
    const remoteAddress = swarm && swarm.remoteAddress()
    const holepunchable = swarm && swarm.holepunchable()
    return {
      version: require('./package.json').version,
      apiVersion: require('bitspace-rpc/package.json').version,
      holepunchable: holepunchable,
      remoteAddress: remoteAddress ? remoteAddress.host + ':' + remoteAddress.port : ''
    }
  }

  stop () {
    return this.close()
  }
}

function callAllInSet (set) {
  for (const cb of set) {
    cb()
  }
  set.clear()
}
