const { intoPeer } = require('../common')

module.exports = class ChainstoreSession {
  constructor (client, sessionState, chainstore) {
    this._client = client
    this._chainstore = chainstore
    this._sessionState = sessionState

    const feedListener = (feed) => {
      this._client.chainstore.onFeedNoReply({
        key: feed.key
      })
    }
    this._chainstore.on('feed', feedListener)
    this._sessionState.addResource('@unichain/feed', null, () => {
      this._chainstore.removeListener('feed', feedListener)
    })
  }

  // RPC Methods

  async open ({ id, key, name, weak }) {
    if (this._sessionState.hasChain(id)) throw new Error('Session already in use.')

    const chain = this._chainstore.get({ key, name: name })
    this._sessionState.addChain(id, chain, weak)

    // TODO: Delete session if ready fails.
    await new Promise((resolve, reject) => {
      chain.ready(err => {
        if (err) return reject(err)
        return resolve()
      })
    })

    const appendListener = () => {
      this._client.unichain.onAppendNoReply({
        id,
        length: chain.length,
        byteLength: chain.byteLength
      })
    }
    chain.on('append', appendListener)
    this._sessionState.addResource('@unichain/append-' + id, null, () => {
      chain.removeListener('append', appendListener)
    })

    const peerOpenListener = (peer) => {
      this._client.unichain.onPeerOpenNoReply({
        id,
        peer: intoPeer(peer)
      })
    }
    chain.on('peer-open', peerOpenListener)
    this._sessionState.addResource('@unichain/peer-open-' + id, null, () => {
      chain.removeListener('peer-open', peerOpenListener)
    })

    const peerRemoveListener = (peer) => {
      if (!peer.remoteOpened) return
      this._client.unichain.onPeerRemoveNoReply({
        id,
        peer: intoPeer(peer)
      })
    }
    chain.on('peer-remove', peerRemoveListener)
    this._sessionState.addResource('@unichain/peer-remove-' + id, null, () => {
      chain.removeListener('peer-remove', peerRemoveListener)
    })

    if (weak) {
      const closeListener = () => {
        this._client.unichain.onCloseNoReply({ id })
      }
      chain.on('close', closeListener)
      this._sessionState.addResource('@unichain/close-' + id, null, () => {
        chain.removeListener('close', closeListener)
      })
    }

    const peers = chain.peers.filter(p => p.remoteOpened).map(intoPeer)

    return {
      key: chain.key,
      discoveryKey: chain.discoveryKey,
      length: chain.length,
      byteLength: chain.byteLength,
      writable: chain.writable,
      peers
    }
  }
}
