module.exports = class SessionState {
  constructor (chainstore) {
    this.chainstore = chainstore
    this.unichains = new Map()
    this.resources = new Map()
  }

  addResource (id, value, dealloc) {
    const res = this.resources.get(id)
    if (res) {
      dealloc()
      throw new Error('Resource already exists: ' + id)
    }
    this.resources.set(id, {
      value,
      dealloc
    })
  }

  hasResource (id) {
    return this.resources.has(id)
  }

  getResource (id) {
    const res = this.resources.get(id)
    if (!res) throw new Error('Invalid resource: ' + id)
    return res.value
  }

  deleteResource (id, noDealloc) {
    const res = this.resources.get(id)
    if (!res) throw new Error('Invalid resource: ' + id)
    if (!noDealloc) res.dealloc()
    this.resources.delete(id)
  }

  hasChain (id) {
    return this.unichains.has(id)
  }

  addChain (id, chain, isWeak) {
    if (this.unichains.has(id)) throw new Error('Unichain already exists in session: ' + id)
    if (!isWeak) this.chainstore.cache.increment(chain.discoveryKey.toString('hex'))
    this.unichains.set(id, { chain, isWeak })
  }

  getChain (id) {
    if (!this.unichains.has(id)) throw new Error('Invalid unichain: ' + id)
    const { chain } = this.unichains.get(id)
    return chain
  }

  deleteChain (id) {
    if (!this.unichains.has(id)) throw new Error('Invalid unichain: ' + id)
    const { chain, isWeak } = this.unichains.get(id)
    if (!isWeak) this.chainstore.cache.decrement(chain.discoveryKey.toString('hex'))
    this.unichains.delete(id)
  }

  deleteAll () {
    for (const { dealloc } of this.resources.values()) {
      dealloc()
    }
    for (const id of this.unichains.keys()) {
      this.deleteChain(id)
    }
    this.resources.clear()
  }
}
