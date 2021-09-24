# like-web3

Common Web3/BSC for Node.js

![](https://img.shields.io/npm/v/like-web3.svg) ![](https://img.shields.io/npm/dt/like-web3.svg) ![](https://img.shields.io/github/license/LuKks/like-web3.svg)

```javascript
const Web3 = require('like-web3');

const web3 = new Web3({
  providers: ['wss://bsc-ws-node.nariox.org:443'],
  privateKey: '0x...'
});

(async () => {
  console.log(await web3.contract('WBNB').totalSupply());
})();
```

## Install
```
npm i like-web3
```

## Providers
#### Mainnet
```
https://bsc-dataseed.binance.org
wss://bsc-ws-node.nariox.org:443
```

Looking for a stable WebSocket provider? It's free: https://moralis.io/

#### Testnet
```
https://data-seed-prebsc-1-s1.binance.org:8545
```
Moralis.io also gives you a testnet WebSocket provider.

## Notes
It only supports HTTP and WebSocket providers.\
The default provider is `https://bsc-dataseed.binance.org`.

## Examples
#### Setup testnet
```javascript
const web = new Web3({
  providers: ['https://data-seed-prebsc-1-s1.binance.org:8545'],
  testnet: true, // this will use a different network/chain id
  privateKey: '0x...'
});
```

#### Swap tokens in PancakeSwap
```javascript
let tx = await web3.transaction('PANCAKESWAP_ROUTER', {
  method: 'swapExactTokensForTokens',
  args: [
    web3.toWei(0.1, 18), // amountIn (WBNB, 18 decimals)
    web3.toWei(1.89, 18), // amountOutMin (CAKE, 18 decimals)
    [web3.CONTRACTS.WBNB.address, web3.CONTRACTS.CAKE.address], // path (trade route)
    web.wallet.address, // to
    Math.round(Date.now() / 1000) + 120, // deadline
  ],
  to: 'PANCAKESWAP_ROUTER',
  nonce: 1
});
console.log('here tx is valid and it would succeed (estimate gas limit not failed)');

tx = await tx.send(); // make sure to send() otherwise tx will not happen
console.log('swap hash', tx.transactionHash);

let receipt = await tx.wait(); // wait for 1 confirmation and return tx details
console.log('receipt', receipt.status);
```

#### One line method call
```javascript
await web3.contract('0xa1b2c3').name();
await web3.contract('0xa1b2c3').decimals();
await web3.contract('0xa1b2c3').totalSupply();
await web3.contract('PANCAKESWAP_FACTORY').getPair('0x123', '0x456');
await web3.contract('PANCAKESWAP_ROUTER').getAmountsOut(amountIn, [from, to]);
```

#### Re use same contract
```javascript
let cakeContract = web3.contract('0xa1b2c3');
await cakeContract.name();
await cakeContract.decimals();
await cakeContract.totalSupply();
```

#### Watch pending transactions
```javascript
// requires a websocket provider
let subscription = web3.subscribePendingTransactions({ intervalMs: 50 });

web3.on('pendingTransactions', (err, transactionHash, tx) => {
  if (err) throw err;
  console.log(transactionHash, 'tx', tx);
});

// subscription.unsubscribe();
```

#### Util
```javascript
// wei
web3.toWei('0.01', 18); // ie. WBNB (18 decimals) => 10000000000000000
web3.fromWei('10000000000000000', 18); // ie. WBNB (18 decimals) => 0.01

//
let method = web3.decodeMethod(tx.input); // => { name: 'swapExactETHForTokens', ... }
let swap = await web3.decodeSwap({ method, txValue: tx.value }); // => { amountIn: '0.01', ... }

// cached
await web3.getTokenDecimals('0xa1b2c3'); // => '18'
await web3.getTokenName('0xa1b2c3'); // => 'Wrapped BNB'
await web3.getPair('PANCAKESWAP_FACTORY', ['0x123', '0x456']); // => '0x42f6f...'
```

#### Methods from original web3
```javascript
let nonce = await web3.eth.getTransactionCount(web3.wallet.address);
let receipt = await web3.eth.getTransaction(transactionHash);
// etc
```

#### Add more named contracts
```javascript
Web3.addContract('PANCAKESWAP_FACTORY', {
  address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  abi: [...]
});
```

## Tests
```
There are no tests yet.
```

## License
Code released under the [MIT License](https://github.com/LuKks/like-web3/blob/master/LICENSE).
