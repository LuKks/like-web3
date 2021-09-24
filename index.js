/*
 like-web3 (https://npmjs.com/package/like-web3)
 Copyright 2021 Lucas Barrena
 Licensed under MIT (https://github.com/LuKks/like-web3)
*/

'use strict';

// fixbug: Error: Number can only safely store up to 53 bits
// https://github.com/ChainSafe/web3.js/pull/3948#issuecomment-821779691
(function () {
  const fs = require('fs');
  let path = './node_modules/number-to-bn/node_modules/bn.js/lib/bn.js';
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace('assert(false, \'Number can only safely store up to 53 bits\');', 'ret = Number.MAX_SAFE_INTEGER;');
  fs.writeFileSync(path, content, 'utf8');
})();

const Web3 = require('web3');
const Tx = require('ethereumjs-tx').Transaction;
const EthCommon = require('ethereumjs-common').default;
const abiDecoder = require('abi-decoder');
const EventEmitter = require('events').EventEmitter;
const util = require('util');
const Decimal = require('decimal.js');
const CONTRACTS = require('./contracts-list.js');

Decimal.set({ precision: 30 });
Decimal.set({ rounding: Decimal.ROUND_HALF_FLOOR });

abiDecoder.addABI(CONTRACTS.PANCAKESWAP_ROUTER.abi);

module.exports = LikeWeb3;

/*
const web3 = new Web3({
  providers: ['wss://bsc-ws-node.nariox.org:443'],
  // testnet: true, // this will use a different network/chain id
  privateKey: '0x...'
});
*/
function LikeWeb3 ({ providers, testnet, privateKey }) {
  if (!(this instanceof LikeWeb3)) {
    return new LikeWeb3(opts);
  }

  EventEmitter.call(this);

  // pool of nodes
  if (!providers || !providers.length) {
    providers = ['https://bsc-dataseed.binance.org'];
  }
  let provider = providers[0];

  // detect provider protocol
  if (provider.startsWith('http://') || provider.startsWith('https://')) {
    this.web3 = new Web3(provider);
  } else if (provider.startsWith('ws://') || provider.startsWith('wss://')) {
    this.web3 = new Web3(new Web3.providers.WebsocketProvider(provider));
  } else {
    throw 'only supports http/s, ws/s';
  }

  // share the same eth and utils
  this.eth = this.web3.eth;
  this.utils = this.web3.utils;

  // network and chain id
  let blockchainId = testnet ? 97/*testnet*/ : 56/*mainnet*/;
  this.customChain = EthCommon.forCustomChain('mainnet', {
    name: 'BSC ' + testnet ? 'Testnet' : 'Mainnet',
    networkId: blockchainId,
    chainId: blockchainId
  }, 'petersburg');

  // support for automatic "from" and sign
  this.wallet = {
    address: '',
    privateKey: ''
  };
  if (privateKey.length >= 16) {
    this.wallet = this.web3.eth.accounts.privateKeyToAccount(privateKey.slice(2));
  }
}

util.inherits(LikeWeb3, EventEmitter);

LikeWeb3.CONTRACTS = CONTRACTS;

LikeWeb3.addContract = function (key, { address, abi, fee }) {
  // support object with already multiple contracts
  if (typeof key === 'object') {
    let contracts = key;
    for (let name of contracts) {
      LikeWeb3.addContract(name, contracts[name]);
    }
    return;
  }
  // support single contract
  CONTRACTS[key] = {
    address,
    abi
  };
  if (fee) {
    CONTRACTS[key].fee = fee;
  }
}

/*
let tx = await web3.transaction('PANCAKESWAP_ROUTER', {
  // abi: [{...}],
  method: 'swap',
  args: [],
  from: '0x123',
  to: '0x123',
  // value: 0,
  nonce: 1,
  // gasPrice: 5,
  // gasLimit: 250000,
  // privateKey: 'hwwwy123'
});
tx = await tx.send(); // quickly returns { transactionHash, wait() }
console.log(await tx.wait()); // wait for 1 confirmation and return transaction details
*/
LikeWeb3.prototype.transaction = async function (contract, { abi, method, args, from, to, value, nonce, gasPrice, gasLimit, privateKey }) {
  let data;
  if (method) {
    args = this.argsToHex(args);

    let CONTRACT = _nameToContract(contract, abi);
    let contractAny = new this.web3.eth.Contract(CONTRACT.abi, CONTRACT.address);
    data = contractAny.methods[method](...args).encodeABI();
  }

  if (CONTRACTS[to]) {
    to = CONTRACTS[to].address;
  }

  if (!privateKey && this.wallet.privateKey) {
    if (from !== this.wallet.address) {
      throw new Error('you need to set "privateKey" of the "from" arg or remove the "from" arg');
    }
    privateKey = this.wallet.privateKey;
    from = this.wallet.address;
  }

  let transaction = await NewTx({
    from,
    to,
    value: this.web3.utils.toHex(value || 0),
    data,
    nonce: this.web3.utils.toHex(nonce),
    gasPrice,
    gasLimit,
  });

  return {
    send: () => {
      return this.sendTransaction(transaction, { privateKey });
    }
  };
}

// web3.sendTransaction({ .. }, { privateKey, serialize });
LikeWeb3.prototype.sendTransaction = async function (transaction, { privateKey, serialize }) {
  if (!privateKey && this.wallet.privateKey) {
    privateKey = this.wallet.privateKey;
  }

  if (privateKey && typeof transaction === 'object') {
    transaction.sign(Buffer.from(privateKey.slice(2), 'hex'));
  }

  if (serialize) {
    if (typeof transaction === 'object') {
      return '0x' + transaction.serialize().toString('hex');
    }
    throw 'transaction is a string, should be an object';
  }

  let txData = (typeof transaction === 'object') ? ('0x' + transaction.serialize().toString('hex')) : transaction;
  return await this.broadcast(txData);
}

// web3.broadcast('0xDaTa..');
LikeWeb3.prototype.broadcast = async function (txData) {
  let promise = this.web3.eth.sendSignedTransaction(txData);
  let transactionHash; // + getting hash should be sync

  // wait and get tx hash
  promise.once('transactionHash', hash => transactionHash = hash);
  let started = Date.now();
  while (Date.now() - started < 15000) {
    if (transactionHash) {
      break;
    }
    await sleep(50);
  }

  // + the promise doesn't solve until it has 1 confirmation or it fails (gets rejected)

  return {
    transactionHash,
    wait: async () => {
      try {
        return await promise;
      } catch (err) {
        // console.log('catch send transaction', err);
        if (!err.receipt) {
          throw err;
        }
        return err.receipt;
      }
    }
  };
}

// web3.contract('0xa1b2c3').name(); // Wrapped BNB
// web3.contract('0xa1b2c3').decimals(); // '18'
// web3.contract('0xa1b2c3').totalSupply(); // '99999...'
// web3.contract('0xa1b2c3').allowance(web3.wallet.address, web3.CONTRACTS.PANCAKESWAP_ROUTER); // '10000000000000000'
// web3.contract('PANCAKESWAP_FACTORY').getPair('0x123', '0x456');
// web3.contract('PANCAKESWAP_ROUTER').getAmountsOut(amountIn, [from, to]);
LikeWeb3.prototype.contract = function (contractAddress, abi) {
  const self = this;

  let CONTRACT = _nameToContract(contractAddress, abi);
  let contractAny = new this.web3.eth.Contract(CONTRACT.abi, CONTRACT.address);

  let funcs = {};
  for (let key in contractAny.methods) {
    let copy = contractAny.methods[key];

    funcs[key] = async function () {
      let args = [...arguments];
      args = self.argsToHex(args);

      return (copy.apply(this, args)).call();
    }
    contractAny.methods[key] = funcs[key];
  }

  return funcs;
}

/*
let subscription = web3.subscribePendingTransactions({ intervalMs: 50 });

web3.on('pendingTransactions', (err, transactionHash, tx) => {
  if (err) throw err;
  console.log(transactionHash, 'tx', tx);
});

// subscription.unsubscribe();
*/
LikeWeb3.prototype.subscribePendingTransactions = function ({ intervalMs }) {
  intervalMs = intervalMs === undefined ? 50 : intervalMs;

  let batch = null;
  let batchStarted = 0;

  // subscribe to pending txs
  let subPendingTxs = this.web3.eth.subscribe('pendingTransactions', async function (err, transactionHash) {
    if (err) {
      // console.log('err subscribe', transactionHash, err);
      throw err;
    }

    if (!transactionHash) {
      return;
    }

    if (!batch) {
      batch = new this.web3.eth.BatchRequest();
      batchStarted = Date.now();
    }

    // get tx details in batches to avoid too many requests
    batch.add(this.web3.eth.getTransaction.request(transactionHash, function (err, tx) {
      if (err) {
        // console.log('err batch add cb', transactionHash, err);
        // + here should reconnect or something
        this.emit('pendingTransactions', err, null, null);
        return;
      }

      // ignore invalid txs?
      if (!tx) {
        return;
      }

      // emit new pending tx
      this.emit('pendingTransactions', null, transactionHash, tx);
    }));

    if (batch.requests.length >= 50 || Date.now() - batchStarted >= intervalMs/*millis*/) {
      // console.log('total batch requests', batch.requests.length);
      batch.execute();
      batch = null;
    }
  });

  function unsubscribe () {
    subPendingTxs.unsubscribe((err, success) => {});
    /*
    return new Promise(resolve => {
      subPendingTxs.unsubscribe((err, success) => {
        resolve();
      });
    });
    */
  }

  return { unsubscribe };
}

LikeWeb3.prototype.NewTx = async function ({ from, to, value, data, nonce, gasPrice, gasLimit }) {
  // console.log('NewTx', { from, to, value, nonce });
  let estimatedGasPrice = await this.estimateGasPrice({ from, to, value, data, gasPrice, gasLimit });
  gasPrice = estimatedGasPrice.gasPrice;
  gasLimit = estimatedGasPrice.gasLimit;
  // console.log('before new tx', { gasPrice, gasLimit }); // { gasPrice: '0x12a05f200', gasLimit: '0x1c6e9' }
  return new Tx({ from, to, value, data, nonce, gasPrice, gasLimit }, { common: BSC_FORK });
}

LikeWeb3.prototype.estimateGasPrice = async function ({ from, to, value, data, gasPrice, gasLimit }) {
  // console.log('estimateGasPrice', { from, to, value, data, gasPrice, gasLimit });

  // let realGasPrice = this.web3.utils.fromWei(await this.web3.eth.getGasPrice(), 'gwei'); // '10000000000' -> '10'
  // console.log('realGasPrice', realGasPrice);
  if (!gasPrice) {
    // gasPrice = realGasPrice;
    gasPrice = this.web3.utils.fromWei(await this.web3.eth.getGasPrice(), 'gwei');
    // console.log('gasPrice changed', gasPrice);
  }

  // let realGasLimit = await this.web3.eth.estimateGas({ from, to, value, data }); // 55351
  // console.log('realGasLimit', realGasLimit);
  if (!gasLimit) {
    // gasLimit = realGasLimit;
    gasLimit = await this.web3.eth.estimateGas({ from, to, value, data });
    // console.log('gasLimit changed', gasLimit);
  }

  // console.log('bef gas', { gasPrice, gasLimit });
  gasPrice = this.web3.utils.toHex(this.web3.utils.toWei(gasPrice, 'gwei'));
  gasLimit = this.web3.utils.toHex(gasLimit);
  // console.log('aft gas', { gasPrice, gasLimit });
  return { gasPrice, gasLimit };
}

// web3.argsToHex(['1', ['2', '3'], '4']); // support for two depth
LikeWeb3.prototype.argsToHex = function (args) {
  return args.map(arg => {
    if (Array.isArray(arg)) {
      return this.argsToHex(arg);
    }
    return this.web3.utils.toHex(arg);
  });
}

// web3.toWei('0.01', 18); // ie. WBNB (18 decimals) => '10000000000000000'
LikeWeb3.prototype.toWei = function (amount, decimals) {
  return new Decimal(amount).mul(10 ** decimals).toFixed(0);
}

// web3.fromWei('10000000000000000', 18); // ie. WBNB (18 decimals) => '0.01'
LikeWeb3.prototype.fromWei = function (amount, decimals) {
  return new Decimal(amount).div(10 ** decimals).toFixed();
}

// let method = web3.decodeMethod(tx.input); // => { name: 'swapExactETHForTokens', ... }
LikeWeb3.prototype.decodeMethod = function (txInput) {
  return abiDecoder.decodeMethod(txInput);
}

// let swap = web3.decodeSwap({ method, txValue: tx.value }); // => { amountIn: '0.01', ... }
LikeWeb3.prototype.decodeSwap = async function ({ method, txValue }) {
  // ignore all other methods
  if (method.name !== 'swapExactETHForTokens' && method.name !== 'SwapExactTokensForTokens') {
    return;
  }

  let params = {};
  method.params.map(param => params[param.name] = param.value);
  // console.log('decodeSwap params', params);

  let [amountIn, amountOutMin, path, to, deadline] = [0.0, 0.0, [], '', 0];

  let [decimalsIn, decimalsOut] = await Promise.all([
    this.getTokenDecimals(params.path[0]),
    this.getTokenDecimals(params.path[1]),
  ]);

  if (method.name === 'swapExactETHForTokens') {
    amountIn = this.fromWei(txValue, decimalsIn);
  } else if (method.name === 'SwapExactTokensForTokens') {
    amountIn = this.fromWei(params.amountIn, decimalsIn);
  }
  amountOutMin = this.fromWei(params.amountOutMin, decimalsOut);
  path = params.path;
  to = params.to;
  deadline = params.deadline;

  // extras
  let priceMax = new Decimal(amountIn).div(amountOutMin).toFixed();

  return { amountIn, amountOutMin, priceMax, realAmountOut: '0', path, to, deadline };
}

// web3.getTokenDecimals('0xa1b2c3'); // => '18'
const cacheDecimals = {};
LikeWeb3.prototype.getTokenDecimals = async function (tokenAddress) {
  if (cacheDecimals[tokenAddress]) {
    return cacheDecimals[tokenAddress];
  }

  let token = new this.web3.eth.Contract(CONTRACTS.GENERIC_TOKEN.abi, tokenAddress);
  let decimals = await token.methods.decimals().call();
  cacheDecimals[tokenAddress] = decimals;
  return decimals;
}

// web3.getTokenName('0xa1b2c3'); // => 'Wrapped BNB'
const cacheNames = {};
LikeWeb3.prototype.getTokenName = async function (tokenAddress) {
  if (cacheNames[tokenAddress]) {
    return cacheNames[tokenAddress];
  }

  let token = new this.web3.eth.Contract(CONTRACTS.GENERIC_TOKEN.abi, tokenAddress);
  let name = await token.methods.name().call();
  cacheNames[tokenAddress] = name;
  return name;
}

// web3.getPair('PANCAKESWAP_FACTORY', ['0x123', '0x456']); // => '0x42f6f...'
const cachePairs = {};
LikeWeb3.prototype.getPair = async function (factory, pair) {
  let key = factory + '-' + pair[0] + '-' + pair[1];
  if (cachePairs[key]) {
    return cachePairs[key];
  }

  let factoryContract = new this.web3.eth.Contract(CONTRACTS[factory].abi, CONTRACTS[factory].address);
  let pairAddress = await factoryContract.methods.getPair(pair[0], pair[1]).call();
  cachePairs[key] = pairAddress;
  return pairAddress;
}

// web3.allowance('WBNB', { sender: web3.wallet.address, spender: web3.CONTRACTS.PANCAKESWAP_ROUTER }); '0.01'
LikeWeb3.prototype.allowance = async function (contract, { sender, spender }) {
  let CONTRACT = _nameToContract(contract);
  let tokenContract = new this.web3.eth.Contract(CONTRACT.abi, CONTRACT.address);
  let [amount, decimals] = await Promise.all([
    tokenContract.methods.allowance(sender, spender).call(),
    this.getTokenDecimals(tokenAddress),
  ];
  return this.fromWei(amount, decimals);
}
}

//
LikeWeb3.prototype.getReserves = async function (factory, pair) {
  let factoryContract = new this.web3.eth.Contract(CONTRACTS[factory].abi, CONTRACTS[factory].address);

  let [decimals0, decimals1, pairAddress] = await Promise.all([
    this.getTokenDecimals(pair[0]),
    this.getTokenDecimals(pair[1]),
    this.getPair(factory, pair)
  ]);

  if (!pairAddress || pairAddress === '0x0000000000000000000000000000000000000000') {
    return {
      factory,
      price: '0',
      [pair[0]]: this.fromWei(0, decimals0),
      [pair[1]]: this.fromWei(0, decimals1),
      blockTimestamp: 0,
    };
  }

  let pairContract = new this.web3.eth.Contract(CONTRACTS.PANCAKESWAP_PAIR.abi, pairAddress);
  let reserves = await pairContract.methods.getReserves().call();

  // let orderedPair = parseInt(pair[0]) < parseInt(pair[1]) ? [pair[0], pair[1]] : [pair[1], pair[0]];
  let orderedPair = new Decimal(pair[0]).lt(pair[1]) ? [pair[0], pair[1]] : [pair[1], pair[0]];
  // let orderedPair = await pairContract.methods.sortTokens(pair[0], pair[1]).call();
  // console.log('not oredered', pair);
  // console.log('orderedPair', orderedPair);
  // pair = orderedPair;

  reserves = {
    factory,
    // pair,
    // pairAddress,
    // _reserve0: reserves._reserve0,
    // _reserve1: reserves._reserve1,
    price: 0.0,
    [pair[0]]: this.fromWei(pair[0] === orderedPair[0] ? reserves._reserve0 : reserves._reserve1, decimals0),
    [pair[1]]: this.fromWei(pair[0] === orderedPair[0] ? reserves._reserve1 : reserves._reserve0, decimals1),
    blockTimestamp: reserves._blockTimestampLast,
    decimals: [decimals0, decimals1],
  };
  reserves.price = (new Decimal(reserves[pair[0]]).div(reserves[pair[1]])).toFixed();

  return reserves;
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _nameToContract (contract, abi) {
  let CONTRACT = CONTRACTS[contract];
  if (!CONTRACT) {
    abi = abi || CONTRACTS.GENERIC_TOKEN.abi;
    CONTRACT = { abi, address: contract };
  }
  return CONTRACT;
}
