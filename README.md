# like-web3

Simple Web3 for Node.js

![](https://img.shields.io/npm/v/like-web3.svg) ![](https://img.shields.io/npm/dt/like-web3.svg) ![](https://img.shields.io/github/license/LuKks/like-web3.svg)

```javascript
const Web3 = require('like-web3')
const { Contracts } = require('like-web3')

const web3 = new Web3({
  provider: 'https://bsc-dataseed.binance.org',
  network: 'bsc-mainnet',
  privateKey: '...' 
})

main()

async function main () {
  console.log('my wallet address', web3.address)

  web3.nonce = await web3.getTransactionCount(web3.address)
  console.log('my nonce', web3.nonce)

  console.log('name', await web3.contract('WBNB').name())
  console.log('CAKE contract address', Contracts.CAKE.address)
}
```

## Install
```
npm i like-web3
```

## Providers
Looking for a stable WebSocket provider? It's free: https://moralis.io/

You can also use:
```
BSC Mainnet: https://bsc-dataseed.binance.org
BSC Testnet: https://data-seed-prebsc-1-s1.binance.org:8545
```

It only supports HTTP and WebSocket providers.

## Network names
List of supported network names:
```
eth-mainnet
eth-testnet
bsc-mainnet
bsc-testnet
polygon-mainnet
polygon-testnet
```

Those names are internally mapped with their chainId, networkId, etc.

## Custom network
```javascript
const web3 = new Web3({
  provider: 'https://...',
  network: {
    chainId: 137,
    // networkId: 137, // defaults to chainId
  },
  privateKey: '...'
})
```

## Examples
#### submit()
```javascript
web3.nonce = await web3.getTransactionCount(web3.address)

// submit(): will make a transaction(), tx.send() and tx.wait()
const tx = await web3.submit('PANCAKESWAP_ROUTER', {
  method: 'swapExactETHForTokens',
  value: web3.toWei(0.001, 18), // amountIn (WBNB, 18 decimals)
  args: [
    web3.toWei(0.025, 18), // amountOutMin (CAKE, 18 decimals)
    [Contracts.WBNB.address, Contracts.CAKE.address], // path (trade route)
    web3.address, // to
    Math.round(Date.now() / 1000) + 120 // deadline
  ],
  to: 'PANCAKESWAP_ROUTER',
  nonce: web3.nonce
})

// will take a few seconds but you get transaction hash + receipt
console.log('transactionHash', tx.transactionHash)
console.log('receipt', tx.receipt.status)
```

#### send()
```javascript
// send(): will make a transaction() and tx.send() but won't wait for confirmation
const tx = await web3.send('PANCAKESWAP_ROUTER', {
  method: 'swapExactETHForTokens',
  ...
})

// quickly get a transaction hash
console.log('transactionHash', tx.transactionHash)

await tx.wait()
console.log('receipt', tx.receipt.status)
```

#### Breaked down transaction
```javascript
web3.nonce = await web3.getTransactionCount(web3.address)

// build and sign transaction
const tx = await web3.transaction('PANCAKESWAP_ROUTER', {
  method: 'swapExactETHForTokens',
  ...
})
console.log('here tx is valid and it would succeed (estimate gas limit not failed)')

// make sure to send() otherwise tx will not happen
const transactionHash = await tx.send()
console.log('swap hash', tx.transactionHash)

// wait for 1 confirmation and return tx details
const receipt = await tx.wait()
console.log('receipt', tx.receipt.status)
```

#### One line method call
```javascript
await web3.contract('0xa1b2c3').name()
await web3.contract('0xa1b2c3').decimals()
await web3.contract('0xa1b2c3').totalSupply()
await web3.contract('PANCAKESWAP_FACTORY').getPair('0x123', '0x456')
await web3.contract('PANCAKESWAP_ROUTER').getAmountsOut(amountIn, [from, to])
```

#### Re use same contract
```javascript
const cakeContract = web3.contract('0xa1b2c3')
await cakeContract.name()
await cakeContract.decimals()
await cakeContract.totalSupply()
```

#### Watch pending transactions
Requires a websocket provider

```javascript
web3.subscribe('pendings')

web3.on('pendings', function (transactionHash, tx) {
  console.log(transactionHash, tx)
})

// await web3.unsubscribe('pendings')
```

#### Gas
```javascript
// estimate both gas price and limit (in parallel for increased speed):
const { gasPrice, gasLimit } = await web3.estimateGas({ from, to, value, data })

// simple gas price
const gasPrice = await web3.estimateGasPrice()

// simple gas limit
const gasLimit = await web3.estimateGasLimit({ from, to, value, data })
```

#### Double provider
```javascript
// maybe you like an http provider for sending transactions, etc:
const web3 = new Web3({
  provider: 'https://bsc-dataseed.binance.org',
  network: 'bsc-mainnet',
  privateKey: '...' 
})

// maybe you like a websocket provider just to watch pending transactions to avoid rate limits:
const web3ws = new Web3({
  provider: 'wss://speedy-nodes-nyc.moralis.io/........./bsc/mainnet/ws',
  network: 'bsc-mainnet',
  privateKey: web3.privateKey
})

web3ws.subscribe('pendings')
web3ws.on('pendings', function (transactionHash, tx) {
  console.log(transactionHash, tx)

  // so here you can use "web3" with the http provider
  const tx = await web3.submit('PANCAKESWAP_ROUTER', ...)
})
// await web3ws.unsubscribe('pendings')
```

#### Encode transaction data
Useful to estimate gas limit

```javascript
const data = web3.encodeABI('PANCAKESWAP_ROUTER', {
  method: 'swapExactTokensForTokens',
  args: [...]
})
```

#### Util
```javascript
// wei
web3.toWei('0.01', 18);// ie. WBNB (18 decimals) => '10000000000000000'
web3.fromWei('10000000000000000', 18) // ie. WBNB (18 decimals) => '0.01'

// hex
web.toHex('10000000000000000') // => '0x2386f26fc10000'

// math
web3.trunc(0.123456789, 5) // => '0.12345'

// decode txs
const method = web3.decodeMethod(tx.input) // => { name: 'swapExactETHForTokens', ... }
const swap = await web3.decodeSwap({ method, txValue: tx.value }) // => { amountIn: '0.01', ... }

// useful to generate nonces
const count = await web3.getTransactionCount(web3.address)

// automatic cached values for increased speed in recurrent usage:
await web3.getTokenDecimals('0xa1b2c3') // => '18'
await web3.getTokenName('0xa1b2c3') // => 'Wrapped BNB'
await web3.getPair('PANCAKESWAP_FACTORY', ['0x123', '0x456']) // => '0x42f6f...'

// others
await web3.allowance('WBNB', { sender: web3.address, spender: Contracts.PANCAKESWAP_ROUTER.address }) // => '0.01'
const tx = await web3.approve('WBNB', { spender: Contracts.PANCAKESWAP_ROUTER.address, amount: '0.01', nonce: 1 }) // needs to tx.send(), etc

// pair
await web3.getReserves('PANCAKESWAP_FACTORY', ['0x123', '0x456']) /* => {
  factory: 'PANCAKESWAP_FACTORY',
  price: '0.000961972605218793131889669063837',
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': '175.809168109429715411',
  '0x42f6f551ae042cbe50c739158b4f0cac0edb9096': '182759.017414475433642737',
  blockTimestamp: '1632428882',
  decimals: [Array]
}*/

// disconnect websocket provider for graceful exits
web3.disconnect()

// the next examples are about how web3.transaction() works in relation to gasLimit/gasLimitWei, etc
// only estimate gasPrice:
const { gasPrice, gasLimit } = await web3.estimateGas({ gasLimit: '21000' }) // using normal values
const { gasPrice, gasLimit } = await web3.estimateGas({ gasLimitWei: '2100000...' }) // or using wei values

// only estimate gasLimit:
const { gasPrice, gasLimit } = await web3.estimateGas({ gasPrice: '5', from, to, value, data })
const { gasPrice, gasLimit } = await web3.estimateGas({ gasPriceWei: '50000...', from, to, value, data })

// passing both values doens't make any requests, also you always get them in wei and hex format:
const { gasPrice, gasLimit } = await web3.estimateGas({ gasPrice: '5', gasLimit: '21000' })
const { gasPrice, gasLimit } = await web3.estimateGas({ gasPriceWei: '50000...', gasLimitWei: '2100000...' })

// you can use web3.encodeABI() to generate the "data" variable
```

#### Methods from original web3
```javascript
const nonce = await web3.eth.getTransactionCount(web3.address)
const receipt = await web3.eth.getTransaction(transactionHash)
// etc
```

#### Add more named contracts
```javascript
// single
Contracts.add('PANCAKESWAP_FACTORY', {
  address: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
  abi: [...]
})

// multiple
Contracts.add({
  PANCAKESWAP_FACTORY: {
    address: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    abi: [...]
  },
  PANCAKESWAP_ROUTER: {
    address: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    abi: [...]
  }
})
```

## Tests
```
There are no tests yet.
```

## License
Code released under the [MIT License](https://github.com/LuKks/like-web3/blob/master/LICENSE).
