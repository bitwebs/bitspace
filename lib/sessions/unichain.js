const LOCK = Symbol('unichain lock')

module.exports = class UnichainSession {
  constructor (client, sessionState) {
    this._client = client
    this._sessionState = sessionState
    this._downloads = new Map()
  }

  // RPC Methods

  close ({ id }) {
    this._sessionState.deleteChain(id)
    this._sessionState.deleteResource('@unichain/append-' + id)
    this._sessionState.deleteResource('@unichain/peer-open-' + id)
    this._sessionState.deleteResource('@unichain/peer-remove-' + id)
    if (this._sessionState.hasResource('@unichain/close-' + id)) {
      this._sessionState.deleteResource('@unichain/close-' + id)
    }
    if (this._sessionState.hasResource('@unichain/download-' + id)) {
      this._sessionState.deleteResource('@unichain/download-' + id)
    }
    if (this._sessionState.hasResource('@unichain/upload-' + id)) {
      this._sessionState.deleteResource('@unichain/upload-' + id)
    }
    const downloadSet = this._downloads.get(id)
    if (!downloadSet) return
    for (const resourceId of downloadSet) {
      this._sessionState.deleteResource(resourceId)
    }
    this._downloads.delete(id)
  }

  async get ({ id, resourceId, seq, wait, ifAvailable, onWaitId }) {
    const chain = this._sessionState.getChain(id)
    const onwait = onWaitId ? seq => this._client.unichain.onWaitNoReply({ id, onWaitId, seq }) : null

    return new Promise((resolve, reject) => {
      const get = chain.get(seq, { wait, ifAvailable, onwait }, (err, block) => {
        if (this._sessionState.hasResource(resourceId)) this._sessionState.deleteResource(resourceId, true)
        if (err) return reject(err)
        return resolve({ block })
      })
      this._sessionState.addResource(resourceId, get, () => chain.cancel(get))
    })
  }

  cancel ({ id, resourceId }) {
    this._sessionState.getChain(id) // make sure it exists
    if (this._sessionState.hasResource(resourceId)) {
      this._sessionState.deleteResource(resourceId)
    }
  }

  async append ({ id, blocks }) {
    const chain = this._sessionState.getChain(id)
    return new Promise((resolve, reject) => {
      chain.append(blocks, (err, seq) => {
        if (err) return reject(err)
        return resolve({
          length: chain.length,
          byteLength: chain.byteLength,
          seq
        })
      })
    })
  }

  async update ({ id, ifAvailable, minLength, hash }) {
    const chain = this._sessionState.getChain(id)
    return new Promise((resolve, reject) => {
      chain.update({ ifAvailable, minLength, hash }, (err, block) => {
        if (err) return reject(err)
        return resolve({ block })
      })
    })
  }

  async seek ({ id, byteOffset, start, end, wait, ifAvailable }) {
    const chain = this._sessionState.getChain(id)
    return new Promise((resolve, reject) => {
      chain.seek(byteOffset, { start, end, wait, ifAvailable }, (err, seq, blockOffset) => {
        if (err) return reject(err)
        return resolve({ seq, blockOffset })
      })
    })
  }

  async has ({ id, seq }) {
    const chain = this._sessionState.getChain(id)
    return new Promise((resolve, reject) => {
      chain.ready(err => {
        if (err) return reject(err)
        return resolve({
          has: chain.has(seq)
        })
      })
    })
  }

  async download ({ id, resourceId, start, end, blocks, linear, live }) {
    const chain = this._sessionState.getChain(id)
    const opts = { start, end: live ? -1 : end, blocks: blocks.length ? blocks : null, linear }
    return new Promise((resolve, reject) => {
      let downloaded = false
      const d = chain.download(opts, (err) => {
        downloaded = true
        if (this._sessionState.hasResource(resourceId)) {
          this._sessionState.deleteResource(resourceId)
        }
        if (err) return reject(err)
        return resolve()
      })
      if (downloaded) return
      this._sessionState.addResource(resourceId, d, () => {
        chain.undownload(d)
      })
      let downloadSet = this._downloads.get(id)
      if (!downloadSet) {
        downloadSet = new Set()
        this._downloads.set(id, downloadSet)
      }
      downloadSet.add(resourceId)
    })
  }

  undownload ({ id, resourceId }) {
    // Loading the chain just in case it's an invalid ID (it should throw in that case).
    this._sessionState.getChain(id)
    if (this._sessionState.hasResource(resourceId)) {
      this._sessionState.deleteResource(resourceId)
    }
    const downloadSet = this._downloads.get(id)
    if (!downloadSet) return
    downloadSet.delete(resourceId)
    if (!downloadSet.size) this._downloads.delete(id)
  }

  registerExtension ({ id, resourceId, name }) {
    const chain = this._sessionState.getChain(id)
    const client = this._client

    chain.extensions.exclusive = false

    const ext = chain.registerExtension(name, {
      onmessage (data, from) {
        client.unichain.onExtensionNoReply({
          id: id,
          resourceId,
          remotePublicKey: from.remotePublicKey,
          data
        })
      }
    })

    this._sessionState.addResource(resourceId, ext, () => ext.destroy())
  }

  unregisterExtension ({ resourceId }) {
    this._sessionState.deleteResource(resourceId)
  }

  sendExtension ({ id, resourceId, remotePublicKey, data }) {
    const chain = this._sessionState.getChain(id)
    const ext = this._sessionState.getResource(resourceId)

    if (!remotePublicKey) {
      ext.broadcast(data)
      return
    }

    for (const peer of chain.peers) {
      if (peer.remotePublicKey && peer.remotePublicKey.equals(remotePublicKey)) {
        ext.send(data, peer)
      }
    }
  }

  downloaded ({ id, start, end }) {
    const chain = this._sessionState.getChain(id)
    const bytes = chain.downloaded(start, end)
    return { bytes }
  }

  async acquireLock ({ id }) {
    const chain = this._sessionState.getChain(id)

    while (true) {
      const lock = chain[LOCK]
      if (!lock) break
      await lock.promise
    }

    const lock = chain[LOCK] = {
      promise: null,
      resolve: null,
      session: this
    }

    lock.promise = new Promise((resolve, reject) => {
      lock.resolve = resolve
    })

    this._sessionState.addResource(LOCK, null, () => lock.resolve())
  }

  releaseLock ({ id }) {
    const chain = this._sessionState.getChain(id)
    const lock = chain[LOCK]

    if (!lock) throw new Error('Chain is not locked')
    if (lock.session !== this) throw new Error('Chain is not locked by you')

    chain[LOCK] = null
    this._sessionState.deleteResource(LOCK)
  }

  async watchDownloads ({ id }) {
    if (this._sessionState.hasResource('@unichain/download-' + id)) {
      return
    }
    const chain = this._sessionState.getChain(id)
    const downloadListener = (seq, data) => {
      this._client.unichain.onDownloadNoReply({
        id,
        seq,
        byteLength: data.length
      })
    }
    chain.on('download', downloadListener)
    this._sessionState.addResource('@unichain/download-' + id, null, () => {
      chain.removeListener('download', downloadListener)
    })
  }

  async unwatchDownloads ({ id }) {
    if (this._sessionState.hasResource('@unichain/download-' + id)) {
      this._sessionState.deleteResource('@unichain/download-' + id)
    }
  }

  async watchUploads ({ id }) {
    if (this._sessionState.hasResource('@unichain/upload-' + id)) {
      return
    }
    const chain = this._sessionState.getChain(id)
    const uploadListener = (seq, data) => {
      this._client.unichain.onUploadNoReply({
        id,
        seq,
        byteLength: data.length
      })
    }
    chain.on('upload', uploadListener)
    this._sessionState.addResource('@unichain/upload-' + id, null, () => {
      chain.removeListener('upload', uploadListener)
    })
  }

  async unwatchUploads ({ id }) {
    if (this._sessionState.hasResource('@unichain/upload-' + id)) {
      this._sessionState.deleteResource('@unichain/upload-' + id)
    }
  }
}
