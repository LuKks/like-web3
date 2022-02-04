/*
 like-web3 (https://npmjs.com/package/like-web3)
 Copyright 2022 Lucas Barrena
 Licensed under MIT (https://github.com/LuKks/like-web3)
*/

// fixbug: Error: Number can only safely store up to 53 bits
// https://github.com/ChainSafe/web3.js/pull/3948#issuecomment-821779691
(function () {
  const fs = require('fs')
  const path = './node_modules/number-to-bn/node_modules/bn.js/lib/bn.js'
  let content = fs.readFileSync(path, 'utf8')
  content = content.replace('assert(false, \'Number can only safely store up to 53 bits\');', 'ret = Number.MAX_SAFE_INTEGER;')
  fs.writeFileSync(path, content, 'utf8')
})()

const Web3 = require('web3')
const { EventEmitter } = require('events')

const Common = require('@ethereumjs/common').default
const Tx = require('./tx.js')

const abiDecoder = require('abi-decoder')
const Decimal = require('decimal.js')

const Contracts = require('./contracts.js')

const ContractETH = require('web3-eth-contract')

Decimal.set({ precision: 30 })
Decimal.set({ rounding: Decimal.ROUND_HALF_FLOOR })

abiDecoder.addABI(Contracts.PANCAKESWAP_ROUTER.abi)

/*
const web3 = new Web3({
  provider: 'https://bsc-dataseed.binance.org',
  network: 'bsc-mainnet',
  privateKey: '0x...'
})

const web3 = new Web3({
  provider: 'https://bsc-dataseed.binance.org',
  network: {
    chainId: 56,
    // networkId: 56 // defaults to chainId
  },
  privateKey: '0x...'
})
*/
class LikeWeb3 extends EventEmitter {
  constructor (opts = {}) {
    super()

    if (!opts.provider) throw new Error('provider is missing')
    if (!opts.network) throw new Error('network is missing')
    if (!opts.privateKey) throw new Error('privateKey is missing') // + should be optional

    // convert network name like 'bsc-mainnet' to params and opts
    // also allows passing an object for custom chainId, etc
    this.network = LikeWeb3.getNetworkDetails(opts.network)

    // automatic support for different provider types (ws, wss, http, https)
    this.web3 = new Web3(LikeWeb3.anyProvider(opts.provider))

    // save chain details
    this.common = Common.custom(
      { name: 'custom', chainId: this.network.chainId, networkId: this.network.networkId },
      { /* chain: this.network.chain, hardfork: this.network.hardfork */ }
    )

    // share a few same props
    this.eth = this.web3.eth
    this.utils = this.web3.utils
    this.setProvider = this.web3.setProvider

    // support for automatic "from" and sign
    this.address = null
    this.privateKey = null

    if (opts.privateKey) {
      this.address = this.privateKeyToAddress(opts.privateKey)
      this.privateKey = opts.privateKey
    }

    // list of current subscriptions and batches related to them
    this.subscriptions = {}
    this.batches = {}

    // cache
    this.cache = {
      names: {},
      decimals: {},
      pairs: {}
    }

    // nonces
    this.nonce = null
  }

  /*
  const tx = await web3.transaction('PANCAKESWAP_ROUTER', {
    // abi: [{...}],
    method: 'swap',
    args: [],
    // from: '0x123',
    to: '0x123',
    // value: 0,
    nonce: 1,
    // gasPrice: 5,
    // gasLimit: 250000,
    // privateKey: '0x...'
  })

  const transactionHash = await tx.send() // quickly generates tx.transactionHash
  console.log(tx.transactionHash)

  // wait for 1 confirmation and return transaction details
  const receipt = await tx.wait()
  console.log(tx.receipt)
  */
  async transaction (contract, { abi, method, args, from, to, value, nonce, gasPrice, gasLimit, gasPriceWei, gasLimitWei, privateKey }) {
    let data

    if (method) {
      data = this.encodeABI(contract, { abi, method, args })
    }

    // support named contracts for "to", ie. { .., to: 'PANCAKESWAP_ROUTER', .. }
    if (Contracts[to]) {
      to = Contracts[to].address
    }

    // allow forcing a specific private key per transaction
    if (privateKey) {
      const address = this.privateKeyToAddress(privateKey)
      if (from && from !== address) {
        throw new Error('"from" address is not linked to arg "privateKey"')
      }
      from = address
    } else if (this.privateKey) {
      // otherwise, use global private key
      if (from && from !== this.address) {
        throw new Error('"from" address is not linked to global "privateKey"')
      }
      from = this.address
      privateKey = this.privateKey
    }

    // auto format to hex
    value = this.toHex(value || 0)
    nonce = this.toHex(nonce)

    // manage gas price and limit
    const estimatedGas = await this.estimateGas({ from, to, value, data, gasPrice, gasLimit, gasPriceWei, gasLimitWei })
    gasPrice = estimatedGas.gasPrice
    gasLimit = estimatedGas.gasLimit

    // build and sign tx
    const tx = this.tx({ to, value, data, nonce, gasPrice, gasLimit })
    tx.sign(privateKey)

    // ready to send/wait
    return tx
  }

  async send (...args) {
    const tx = await this.transaction(...args)
    await tx.send()
    return tx
  }

  async submit (...args) {
    const tx = await this.transaction(...args)
    await tx.send()
    await tx.wait()
    return tx
  }

  /*
  const data = web3.encodeABI('PANCAKESWAP_ROUTER', {
    method: 'swapExactTokensForTokens',
    args: [...]
  })
  */
  encodeABI (contract, { abi, method, args }) {
    if (!method) {
      return undefined
    }

    // auto format to hex
    args = this.toHex(args || [])

    // + should create a way to easily use contracts
    const CONTRACT = Contracts.parse(contract, abi)
    const contractAny = new ContractETH(CONTRACT.abi, CONTRACT.address)
    contractAny.setProvider(this.web3.currentProvider)

    // generate encoded data
    return contractAny.methods[method](...args).encodeABI()
  }

  // build a raw tx based on params (later you can: sign, serialize, send, wait, etc)
  // const tx = web3.tx({ to, value, data, nonce, gasPrice, gasLimit })
  //
  // build a raw tx based on already signed data (you can only: send, wait)
  // const tx = web3.tx('0xDaTa...')
  tx (params, opts) {
    if (typeof params === 'string') {
      return new Tx({ web3: this, txData: params })
    }

    return new Tx({
      web3: this,
      params,
      opts: opts || { common: this.common }
    })
  }

  // + maybe estimate gas, etc should all return normal values
  // + and only convert them at the moment of actually making a tx

  // const gasPrice = await web3.estimateGasPrice()
  estimateGasPrice () {
    return this.estimateGas({ gasLimit: -1 }).then(estimated => estimated.gasPrice)
  }

  // const gasLimit = await web3.estimateGasLimit({ from, to, value, data })
  estimateGasLimit ({ from, to, value, data }) {
    return this.estimateGas({ gasPrice: -1, from, to, value, data }).then(estimated => estimated.gasLimit)
  }

  // estimate both (in parallel for increased speed):
  // const { gasPrice, gasLimit } = await web3.estimateGas({ from, to, value, data })
  //
  // only estimate gasPrice:
  // const { gasPrice, gasLimit } = await web3.estimateGas({ gasLimit: '21000' })
  // const { gasPrice, gasLimit } = await web3.estimateGas({ gasLimitWei: '2100000...' })
  //
  // only estimate gasLimit:
  // const { gasPrice, gasLimit } = await web3.estimateGas({ gasPrice: '5', from, to, value, data })
  // const { gasPrice, gasLimit } = await web3.estimateGas({ gasPriceWei: '50000...', from, to, value, data })
  //
  // passing both values doens't make any requests, also you always get them in wei and hex format:
  // const { gasPrice, gasLimit } = await web3.estimateGas({ gasPrice: '5', gasLimit: '21000' })
  // const { gasPrice, gasLimit } = await web3.estimateGas({ gasPriceWei: '50000...', gasLimitWei: '2100000...' })
  //
  // note: gasPrice is a wei value and gasLimit is not
  //
  // + pending optimization
  async estimateGas ({ from, to, value, data, gasPrice, gasLimit, gasPriceWei, gasLimitWei }) {
    if (gasPrice && gasPriceWei) throw new Error('should only use one, either gasPrice or gasPriceWei')
    if (gasLimit && gasLimitWei) throw new Error('should only use one, either gasLimit or gasLimitWei')

    // wei to normal
    gasPrice = gasPriceWei ? this.web3.utils.fromWei(gasPriceWei, 'gwei') : gasPrice
    gasLimit = gasLimitWei ? this.web3.utils.fromWei(gasLimitWei, 'gwei') : gasLimit

    // parallel estimate price and limit
    const promises = []
    promises.push(gasPrice ? null : this.web3.eth.getGasPrice())
    promises.push(gasLimit ? null : this.web3.eth.estimateGas({ from, to, value, data }))

    // wait for fetching gas
    const gas = await Promise.all(promises)
    gasPrice = gas[0] ? this.web3.utils.fromWei(gas[0], 'gwei') : gasPrice
    gasLimit = gas[1] ? gas[1] : gasLimit

    // normal to wei and to hex
    gasPrice = this.toHex(this.web3.utils.toWei(gasPrice.toString(), 'gwei'))
    gasLimit = this.toHex(gasLimit.toString())

    return { gasPrice, gasLimit }
  }

  // await web3.contract('0xa1b2c3').name() // Wrapped BNB
  // await web3.contract('0xa1b2c3').decimals() // '18'
  // await web3.contract('0xa1b2c3').totalSupply() // '99999...'
  // await web3.contract('0xa1b2c3').allowance(web3.address, Contracts.PANCAKESWAP_ROUTER.address) // '10000000000000000'
  // await web3.contract('PANCAKESWAP_FACTORY').getPair('0x123', '0x456')
  // await web3.contract('PANCAKESWAP_ROUTER').getAmountsOut(amountIn, [from, to])
  contract (contractAddress, abi) {
    const self = this

    const CONTRACT = Contracts.parse(contractAddress, abi)
    const contractAny = new ContractETH(CONTRACT.abi, CONTRACT.address)
    contractAny.setProvider(this.web3.currentProvider)

    const funcs = {}
    for (const key in contractAny.methods) {
      const copy = contractAny.methods[key]

      funcs[key] = async function () {
        let args = [...arguments]
        args = self.toHex(args)

        return (copy.apply(this, args)).call()
      }

      contractAny.methods[key] = funcs[key]
    }

    return funcs
  }

  // web3.toHex('1') // single value
  // web3.toHex(['1', '2', '3', '4']) // array
  // web3.toHex(['1', ['2', '3'], '4']) // support for two depth
  // + pending optimization
  toHex (args) {
    if (!Array.isArray(args)) {
      return this.web3.utils.toHex(args)
    }

    return args.map(arg => {
      if (Array.isArray(arg)) {
        return this.toHex(arg)
      }
      return this.web3.utils.toHex(arg)
    })
  }

  // + fromHex?

  // web3.toWei('0.01', 18) // ie. WBNB (18 decimals) => '10000000000000000'
  toWei (amount, decimals) {
    return this.trunc(new Decimal(amount).mul(10 ** decimals).toFixed())
  }

  // web3.fromWei('10000000000000000', 18) // ie. WBNB (18 decimals) => '0.01'
  fromWei (amount, decimals) {
    return new Decimal(amount).div(10 ** decimals).toFixed()
  }

  trunc (amount, decimals) {
    decimals = decimals === undefined ? 0 : parseInt(decimals) + 1
    // + should support Decimal type directly
    const value = amount.toString()
    const decimalPos = value.indexOf('.')
    const substrLength = decimalPos === -1 ? value.length : decimalPos + decimals
    let trimmed = value.substr(0, substrLength)
    trimmed = isNaN(trimmed) ? 0 : trimmed
    return trimmed
  }

  privateKeyToAddress (privateKey) {
    const account = this.web3.eth.accounts.privateKeyToAccount(this.parsePrivateKey(privateKey))
    return account.address
  }

  /*
  // requires a websocket provider

  web3.subscribe('pendings')

  web3.on('pendings', function (transactionHash, tx) {
    console.log(transactionHash, tx)
  })

  web3.on('error', function (error) {
    throw error
  })

  // await web3.unsubscribe()

  // you can also choose which event to unsubscribe
  // await web3.unsubscribe('pendings')
  // await web3.unsubscribe('blocks')
  */
  subscribe (type, opts = {}) {
    if (type === 'pendings') {
      if (this.subscriptions.pendings) {
        throw new Error('already subscribed to pendings')
      }

      let { batchCount, batchDelay } = opts
      batchCount = batchCount === undefined ? 50 : batchCount
      batchDelay = batchDelay === undefined ? 50 : batchDelay

      this.batches.pendings = null

      this.subscriptions.pendings = this.web3.eth.subscribe('pendingTransactions', (error, transactionHash) => {
        if (error) {
          this.emit('error', error)
          return
        }

        if (!transactionHash) {
          // + when does this happens?
          return
        }

        if (!this.batches.pendings) {
          this.batches.pendings = new this.web3.eth.BatchRequest()
          this.batches.pendings.$started = Date.now()
        }
        const batch = this.batches.pendings

        // get tx details in batches to avoid too many requests
        batch.add(this.web3.eth.getTransaction.request(transactionHash, (error, tx) => {
          if (error) {
            // + here should detect for reconnecting
            this.emit('error', error)
            return
          }

          // ignore invalid txs?
          if (!tx) {
            // + when does this happens?
            return
          }

          // emit new pending tx
          this.emit('pendings', transactionHash, tx)
        }))

        clearTimeout(batch.$timeoutId)

        if (batch.requests.length >= batchCount || Date.now() - batch.$started >= batchDelay) {
          batch.execute()
          this.batches.pendings = null
        } else {
          batch.$timeoutId = setTimeout(() => {
            batch.execute()
            this.batches.pendings = null
          }, batchDelay)
        }
      })

      return
    }

    if (type === 'blocks') {
      if (this.subscriptions.blocks) {
        throw new Error('already subscribed to blocks')
      }

      // + newBlockHeaders

      throw new Error('type (' + type + ') not implemented yet')
    }

    // + logs?

    throw new Error('type (' + type + ') unknown')
  }

  unsubscribe (type) {
    return new Promise((resolve, reject) => {
      if (!type) {
        Promise.all([
          this.unsubscribe('pendings'),
          this.unsubscribe('blocks')
        ]).then(resolve).catch(reject)
        return
      }

      if (!this.subscriptions[type]) {
        resolve()
        return
      }

      if (this.batches[type]) {
        clearTimeout(this.batches[type].$timeoutId)
        this.batches[type] = null
      }

      this.subscriptions[type].unsubscribe((_, success) => {
        this.subscriptions[type] = null
        resolve()
      })
    })
  }

  disconnect () {
    this.web3.currentProvider.disconnect()
  }

  // const method = web3.decodeMethod(tx.input) // => { name: 'swapExactETHForTokens', ... }
  decodeMethod (txInput) {
    return abiDecoder.decodeMethod(txInput)
  }

  // const swap = web3.decodeSwap({ method, txValue: tx.value }) // => { amountIn: '0.01', ... }
  async decodeSwap ({ method, txValue }) {
    // ignore all other methods
    if (method.name !== 'swapExactETHForTokens' && method.name !== 'swapExactTokensForETH' && method.name !== 'SwapExactTokensForTokens') {
      return
    }

    const params = {}
    method.params.map(param => (params[param.name] = param.value))
    // console.log('decodeSwap params', params)

    let [amountIn, amountOutMin, path, to, deadline] = [0.0, 0.0, [], '', 0]

    const [decimalsIn, decimalsOut] = await Promise.all([
      this.getTokenDecimals(params.path[0]),
      this.getTokenDecimals(params.path[1])
    ])

    if (method.name === 'swapExactETHForTokens') {
      amountIn = this.fromWei(txValue, decimalsIn)
    } else if (method.name === 'swapExactTokensForETH' || method.name === 'SwapExactTokensForTokens') {
      amountIn = this.fromWei(params.amountIn, decimalsIn)
    }
    amountOutMin = this.fromWei(params.amountOutMin, decimalsOut)
    path = params.path
    to = params.to
    deadline = params.deadline

    return { amountIn, amountOutMin, path, to, deadline }
  }

  // const name = await web3.getTokenName('0xa1b2c3') // => 'Wrapped BNB'
  async getTokenName (tokenAddress) {
    if (this.cache.names[tokenAddress]) {
      return this.cache.names[tokenAddress]
    }

    const token = new ContractETH(Contracts.GENERIC_TOKEN.abi, tokenAddress)
    token.setProvider(this.web3.currentProvider)
    const name = await token.methods.name().call()
    this.cache.names[tokenAddress] = name
    return name
  }

  // const decimals = await web3.getTokenDecimals('0xa1b2c3') // => '18'
  async getTokenDecimals (tokenAddress) {
    if (this.cache.decimals[tokenAddress]) {
      return this.cache.decimals[tokenAddress]
    }

    const token = new ContractETH(Contracts.GENERIC_TOKEN.abi, tokenAddress)
    token.setProvider(this.web3.currentProvider)
    const decimals = await token.methods.decimals().call()
    this.cache.decimals[tokenAddress] = decimals
    return decimals
  }

  // const pairAddress = await web3.getPair('PANCAKESWAP_FACTORY', ['0x123', '0x456']) // => '0x42f6f...'
  async getPair (factory, pair) {
    const key = factory + '-' + pair[0] + '-' + pair[1]
    if (this.cache.pairs[key]) {
      return this.cache.pairs[key]
    }

    const factoryContract = new ContractETH(Contracts[factory].abi, Contracts[factory].address)
    factoryContract.setProvider(this.web3.currentProvider)
    const pairAddress = await factoryContract.methods.getPair(pair[0], pair[1]).call()
    this.cache.pairs[key] = pairAddress
    return pairAddress
  }

  getTransactionCount (address) {
    return this.web3.eth.getTransactionCount(address)
  }

  // const amount = await web3.allowance('WBNB', { sender: web3.address, spender: Contracts.PANCAKESWAP_ROUTER.address }) // => '0.01'
  async allowance (contract, { sender, spender }) {
    const CONTRACT = Contracts.parse(contract)
    const tokenContract = new ContractETH(CONTRACT.abi, CONTRACT.address)
    tokenContract.setProvider(this.web3.currentProvider)
    const [amount, decimals] = await Promise.all([
      tokenContract.methods.allowance(sender, spender).call(),
      this.getTokenDecimals(CONTRACT.address)
    ])
    return this.fromWei(amount, decimals)
  }

  // const tx = await web3.approve('WBNB', { spender: Contracts.PANCAKESWAP_ROUTER.address, amount: '0.01', nonce: 1 })
  // needs to tx.send(), etc like a normal web3.transaction()
  async approve (contract, { spender, amount, from, nonce, gasPrice, gasLimit, privateKey }) {
    const CONTRACT = Contracts.parse(contract)
    const decimals = await this.getTokenDecimals(CONTRACT.address)
    const tx = await this.transaction(contract, {
      method: 'approve',
      args: [
        spender, // ie. pancakeswap router
        this.toWei(amount, decimals) // ie. wbnb amount in wei
      ],
      from,
      to: contract,
      nonce,
      gasPrice,
      gasLimit,
      privateKey
    })
    return tx
  }

  //
  async getReserves (factory, pair) {
    const [decimals0, decimals1, pairAddress] = await Promise.all([
      this.getTokenDecimals(pair[0]),
      this.getTokenDecimals(pair[1]),
      this.getPair(factory, pair)
    ])

    if (!pairAddress || pairAddress === '0x0000000000000000000000000000000000000000') {
      return {
        factory,
        price: '0',
        [pair[0]]: this.fromWei(0, decimals0),
        [pair[1]]: this.fromWei(0, decimals1),
        blockTimestamp: 0
      }
    }

    const pairContract = new ContractETH(Contracts.PANCAKESWAP_PAIR.abi, pairAddress)
    pairContract.setProvider(this.web3.currentProvider)
    let reserves = await pairContract.methods.getReserves().call()

    // let orderedPair = parseInt(pair[0]) < parseInt(pair[1]) ? [pair[0], pair[1]] : [pair[1], pair[0]]
    const orderedPair = new Decimal(pair[0]).lt(pair[1]) ? [pair[0], pair[1]] : [pair[1], pair[0]]
    // let orderedPair = await pairContract.methods.sortTokens(pair[0], pair[1]).call()
    // console.log('not oredered', pair)
    // console.log('orderedPair', orderedPair)
    // pair = orderedPair

    reserves = {
      factory,
      // pair,
      // pairAddress,
      // _reserve0: reserves._reserve0,
      // _reserve1: reserves._reserve1,
      price: '0',
      changed: '',
      [pair[0]]: this.fromWei(pair[0] === orderedPair[0] ? reserves._reserve0 : reserves._reserve1, decimals0),
      [pair[1]]: this.fromWei(pair[0] === orderedPair[0] ? reserves._reserve1 : reserves._reserve0, decimals1),
      blockTimestamp: reserves._blockTimestampLast,
      decimals: [decimals0, decimals1]
    }

    // reserves.price = (new Decimal(reserves[pair[0]]).div(reserves[pair[1]])).toFixed()
    reserves.price = this.fromWei(this.quote(
      this.toWei('1.0', reserves.decimals[1]),
      this.toWei(reserves[pair[1]], reserves.decimals[1]), // reserveIn
      this.toWei(reserves[pair[0]], reserves.decimals[0]) // reserveOut
    ), reserves.decimals[0])

    return reserves
  }

  sync (swap, reserve) {
    // reserve where swap occurred
    const synced = Object.assign({}, reserve)

    // to wei
    synced[swap.path[0]] = this.toWei(synced[swap.path[0]], synced.decimals[0])
    synced[swap.path[1]] = this.toWei(synced[swap.path[1]], synced.decimals[1])

    // calculate in and out for liquidity
    const amountIn = this.toWei(swap.amountIn, synced.decimals[0])
    const amountOut = this.getAmountOut(
      synced.factory,
      amountIn,
      synced[swap.path[0]], // reserveIn
      synced[swap.path[1]] // reserveOut
    )
    swap.amountOut = this.fromWei(amountOut, synced.decimals[1])
    if (swap.amountOutMin && new Decimal(swap.amountOut).lt(swap.amountOutMin)) {
      throw new Error('sync: amountOut (' + swap.amountOut + ') is less than amountOutMin (' + swap.amountOutMin + ') by ' + new Decimal(swap.amountOutMin).minus(swap.amountOut).toFixed())
    }

    // update liquidity
    synced[swap.path[0]] = new Decimal(synced[swap.path[0]]).add(amountIn).toFixed()

    // update price (+ this must be improved but it's not actually used, just for reference)
    // synced.price = new Decimal(synced[swap.path[0]]).div(synced[swap.path[1]]).toFixed();
    const isFirstWBNB = swap.path[0] === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
    synced.price = this.fromWei(this.quote(
      this.toWei('1.0', synced.decimals[isFirstWBNB ? 1 : 0]),
      synced[isFirstWBNB ? swap.path[1] : swap.path[0]], // reserveIn
      synced[isFirstWBNB ? swap.path[0] : swap.path[1]] // reserveOut
    ), synced.decimals[isFirstWBNB ? 0 : 1])

    // update percentage change
    synced.changed = new Decimal(synced.price).div(reserve.price).minus(1.0).toFixed()

    // update liquidity
    synced[swap.path[1]] = new Decimal(synced[swap.path[1]]).minus(amountOut).toFixed()

    // from wei
    synced[swap.path[0]] = this.fromWei(synced[swap.path[0]], synced.decimals[0])
    synced[swap.path[1]] = this.fromWei(synced[swap.path[1]], synced.decimals[1])

    return synced
  }

  quote (amountA, reserveA, reserveB) {
    if (!(amountA > 0)) throw new Error('PancakeLibrary: INSUFFICIENT_AMOUNT')
    if (!(reserveA > 0 && reserveB > 0)) throw new Error('PancakeLibrary: INSUFFICIENT_LIQUIDITY')
    const amountB = new Decimal(new Decimal(amountA).mul(reserveB).toFixed()).div(reserveA).toFixed()
    return this.trunc(amountB)
  }

  getAmountIn (factory, amountOut, reserveIn, reserveOut) {
    if (!(amountOut > 0)) throw new Error('PancakeLibrary: INSUFFICIENT_OUTPUT_AMOUNT')
    if (!(reserveIn > 0 && reserveOut > 0)) throw new Error('PancakeLibrary: INSUFFICIENT_LIQUIDITY')
    const FACTORY = Contracts.parse(factory)
    const FEE = new Decimal(FACTORY.fee).mul(1000).toFixed() // 0.0025 => 2.5
    const numerator = new Decimal(reserveIn).mul(amountOut).mul(1000)
    const denominator = new Decimal(new Decimal(reserveOut).sub(new Decimal(amountOut))).mul(new Decimal(1000).minus(FEE).toFixed()) // 1000 => 997.5
    const amountIn = new Decimal(numerator).div(new Decimal(denominator)).add(1).toFixed()
    return this.trunc(amountIn)
  }

  getAmountOut (factory, amountIn, reserveIn, reserveOut) {
    if (!(amountIn > 0)) throw new Error('PancakeLibrary: INSUFFICIENT_INPUT_AMOUNT')
    if (!(reserveIn > 0 && reserveOut > 0)) throw new Error('PancakeLibrary: INSUFFICIENT_LIQUIDITY')
    const FACTORY = Contracts.parse(factory)
    const FEE = new Decimal(FACTORY.fee).mul(1000).toFixed() // 0.0025 => 2.5
    const amountInWithFee = new Decimal(amountIn).mul(new Decimal(1000).minus(FEE).toFixed()) // 1000 => 997.5
    const numerator = new Decimal(amountInWithFee).mul(reserveOut)
    const denominator = new Decimal(reserveIn).mul(1000).add(new Decimal(amountInWithFee))
    const amountOut = new Decimal(new Decimal(numerator)).div(new Decimal(denominator)).toFixed()
    return this.trunc(amountOut)
  }

  static anyProvider (url) {
    // support for websocket
    if (url.startsWith('wss://') || url.startsWith('ws://')) {
      return new Web3.providers.WebsocketProvider(url)
    }
    // default to http/s
    return url
  }

  static getNetworkDetails (name) {
    // custom
    if (typeof name !== 'string') {
      const net = name
      return {
        chainId: net.chainId, // 1, 3, 56, etc
        networkId: net.networkId || net.chainId, // default to chainId
        chain: Common.Chain[net.chain] || Common.Chain.Mainnet, // default to Mainnet
        hardfork: Common.Hardfork[net.hardfork] || Common.Hardfork.Istanbul // default to Istanbul
      }
    }

    // predefined
    const networks = {
      'eth-mainnet': { chainId: 1, networkId: 1, chain: 'Mainnet', hardfork: 'Istanbul' },
      'eth-testnet': { chainId: 3, networkId: 3, chain: 'Ropsten', hardfork: 'Istanbul' },
      'bsc-mainnet': { chainId: 56, networkId: 56, chain: 'Mainnet', hardfork: 'Istanbul' }, // Petersburg?
      'bsc-testnet': { chainId: 97, networkId: 97, chain: 'Mainnet', hardfork: 'Istanbul' }, // Petersburg?
      'polygon-mainnet': { chainId: 137, networkId: 137, chain: 'Mainnet', hardfork: 'Istanbul' },
      'polygon-testnet': { chainId: 80001, networkId: 80001, chain: 'Goerli', hardfork: 'Istanbul' }
    }

    if (!networks[name]) {
      throw new Error('network name ' + name + ' not found')
    }

    return networks[name]
  }

  parsePrivateKey (privateKey) {
    const has = privateKey.indexOf('0x') === 0 || privateKey.indexOf('0X') === 0
    return has ? privateKey.slice(2) : privateKey
  }
}

LikeWeb3.Contracts = Contracts

module.exports = LikeWeb3
