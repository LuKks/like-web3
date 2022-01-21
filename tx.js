const { Transaction } = require('@ethereumjs/tx')

/*
// build a tx based on params (later you can: sign, send, wait, serialize, etc)
const tx = new Tx({ web3, params, opts: { common: this.common } })

// build a tx based on already signed data (you can only: send, wait)
const tx = new Tx({ web3, txData: '0xDaTa...' })
*/
class Tx {
  constructor ({ web3, params, opts, txData }) {
    this.web3 = web3 // + should not be necessary to pass web3 object
    this.txData = null
    this.signedTx = null
    this.promise = null
    this.transactionHash = null
    this.receipt = null
    this.tx = null

    if (txData) {
      this.txData = txData
    } else {
      this.tx = Transaction.fromTxData(params, opts)
    }
  }

  sign (privateKey) {
    if (this.txData) throw new Error('you can not sign with txData')

    const privateKeyBuffer = Buffer.from(this.web3.parsePrivateKey(privateKey), 'hex')
    this.signedTx = this.tx.sign(privateKeyBuffer)

    return this.signedTx
  }

  async send () {
    if (this.promise) throw new Error('it was already sent')

    const txData = this.txData || this.serialize()
    this.promise = this.web3.eth.sendSignedTransaction(txData)
    // + getting hash should be sync

    // wait for transaction hash
    let transactionHash
    this.promise.once('transactionHash', hash => (transactionHash = hash))

    const started = Date.now()
    while (Date.now() - started < 30000) {
      if (transactionHash) {
        break
      }
      await sleep(10)
    }

    this.transactionHash = transactionHash

    // + the promise doesn't solve until it has 1 confirmation or it fails (gets rejected)

    return this.transactionHash
  }

  async wait () {
    if (!this.promise) throw new Error('first you have to: tx.send()')

    try {
      this.receipt = await this.promise
      return this.receipt
    } catch (err) {
      if (!err.receipt) {
        throw err
      }
      this.receipt = err.receipt
      return this.receipt
    }
  }

  serialize () {
    if (this.txData) throw new Error('you can not sign with txData')
    if (!this.signedTx) throw new Error('first you have to: tx.sign(privateKey)')

    return '0x' + this.signedTx.serialize().toString('hex')
  }
}

module.exports = Tx

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
