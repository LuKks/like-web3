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
  providers: ['https://bsc-dataseed.binance.org', 'wss://bsc-ws-node.nariox.org:443'],
  // testnet: true, // this will use a different network/chain id
  privateKey: '0x...'
});
automatically uses http provider for sending txs, etc
and ws only for subscribing to pending txs or new blocks
*/
function LikeWeb3 ({ providers, testnet, privateKey }) {
  if (!(this instanceof LikeWeb3)) {
    return new LikeWeb3(opts);
  }

  EventEmitter.call(this);

  // pool of nodes
  providers = providers || [];
  let providerHTTP = providers.find(provider => provider.startsWith('http://') || provider.startsWith('https://'));
  let providerWS = providers.find(provider => provider.startsWith('ws://') || provider.startsWith('wss://'));
  providerHTTP = providerHTTP || 'https://bsc-dataseed.binance.org';
  providerWS = providerWS || 'wss://bsc-ws-node.nariox.org:443';
  this.web3 = new Web3(providerHTTP);
  this.web3ws = new Web3(new Web3.providers.WebsocketProvider(providerWS));

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
    this.wallet = this.web3.eth.accounts.privateKeyToAccount(parsePrivateKey(privateKey));
  }

  this.CONTRACTS = CONTRACTS;

  // save last instance for reusing
  LikeWeb3.instance = this;
}

util.inherits(LikeWeb3, EventEmitter);

LikeWeb3.CONTRACTS = CONTRACTS;

LikeWeb3.addContract = function (key, props) {
  let { address, abi, fee } = props = props || {};

  // support object with already multiple contracts
  if (typeof key === 'object') {
    let contracts = key;
    for (let name in contracts) {
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
  // from: '0x123',
  to: '0x123',
  // value: 0,
  nonce: 1,
  // gasPrice: 5,
  // gasLimit: 250000,
  // privateKey: '0xaAb'
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

  if (privateKey) {
    let wallet = this.web3.eth.accounts.privateKeyToAccount(parsePrivateKey(privateKey));
    if (from && from !== wallet.address) {
      throw new Error('"from" address is not linked to "privateKey" arg');
    }
    privateKey = wallet.privateKey;
    from = wallet.address;
  } else if (this.wallet.privateKey) {
    if (from && from !== this.wallet.address) {
      throw new Error('"from" address is not linked to "privateKey" global');
    }
    privateKey = this.wallet.privateKey;
    from = this.wallet.address;
  }

  let transaction = await this.NewTx({
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
    transaction.sign(Buffer.from(parsePrivateKey(privateKey), 'hex'));
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

// await subscription.disconnect();
*/
LikeWeb3.prototype.subscribePendingTransactions = function ({ intervalCount, intervalMs }) {
  intervalCount = intervalCount === undefined ? 50 : intervalCount;
  intervalMs = intervalMs === undefined ? 50 : intervalMs;

  let batch = null;
  let batchStarted = 0;

  // subscribe to pending txs
  let subPendingTxs = this.web3ws.eth.subscribe('pendingTransactions', async (err, transactionHash) => {
    if (err) {
      // console.log('err subscribe', transactionHash, err);
      throw err;
    }

    if (!transactionHash) {
      return;
    }

    if (!batch) {
      batch = new this.web3ws.eth.BatchRequest();
      batchStarted = Date.now();
    }

    // get tx details in batches to avoid too many requests
    batch.add(this.web3ws.eth.getTransaction.request(transactionHash, (err, tx) => {
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

    if (batch.requests.length >= intervalCount || Date.now() - batchStarted >= intervalMs/*millis*/) {
      // console.log('total batch requests', batch.requests.length);
      batch.execute();
      batch = null;
    }
  });

  function disconnect () {
    return new Promise(resolve => {
      subPendingTxs.unsubscribe((err, success) => {
        resolve();
      });
    });
  }

  return { disconnect };
}

LikeWeb3.prototype.NewTx = async function ({ from, to, value, data, nonce, gasPrice, gasLimit }) {
  // console.log('NewTx', { from, to, value, data, nonce, gasPrice, gasLimit });
  let estimatedGasPrice = await this.estimateGasPrice({ from, to, value, data, gasPrice, gasLimit });
  gasPrice = estimatedGasPrice.gasPrice;
  gasLimit = estimatedGasPrice.gasLimit;
  // console.log('before new tx', { gasPrice, gasLimit }); // { gasPrice: '0x12a05f200', gasLimit: '0x1c6e9' }
  return new Tx({ from, to, value, data, nonce, gasPrice, gasLimit }, { common: this.customChain });
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
  gasPrice = this.web3.utils.toHex(this.web3.utils.toWei(gasPrice.toString(), 'gwei'));
  gasLimit = this.web3.utils.toHex(gasLimit.toString());
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
  return this.trunc(new Decimal(amount).mul(10 ** decimals).toFixed());
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
  if (method.name !== 'swapExactETHForTokens' && method.name !== 'swapExactTokensForETH' && method.name !== 'SwapExactTokensForTokens') {
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
  } else if (method.name === 'swapExactTokensForETH' || method.name === 'SwapExactTokensForTokens') {
    amountIn = this.fromWei(params.amountIn, decimalsIn);
  }
  amountOutMin = this.fromWei(params.amountOutMin, decimalsOut);
  path = params.path;
  to = params.to;
  deadline = params.deadline;

  return { amountIn, amountOutMin, path, to, deadline };
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

// web3.allowance('WBNB', { sender: web3.wallet.address, spender: web3.CONTRACTS.PANCAKESWAP_ROUTER }); // => '0.01'
LikeWeb3.prototype.allowance = async function (contract, { sender, spender }) {
  let CONTRACT = _nameToContract(contract);
  let tokenContract = new this.web3.eth.Contract(CONTRACT.abi, CONTRACT.address);
  let [amount, decimals] = await Promise.all([
    tokenContract.methods.allowance(sender, spender).call(),
    this.getTokenDecimals(CONTRACT.address),
  ]);
  return this.fromWei(amount, decimals);
}

// let tx = await web3.approve('WBNB', { spender: '0xpancake', amount: '0.01', nonce: 1 }); // needs to tx.send(), etc
LikeWeb3.prototype.approve = async function (contract, { spender, amount, from, nonce, gasPrice, gasLimit, privateKey }) {
  let CONTRACT = _nameToContract(contract);
  let decimals = await this.getTokenDecimals(CONTRACT.address);
  return this.transaction(contract, {
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
  });
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
    price: '0',
    changed: '',
    [pair[0]]: this.fromWei(pair[0] === orderedPair[0] ? reserves._reserve0 : reserves._reserve1, decimals0),
    [pair[1]]: this.fromWei(pair[0] === orderedPair[0] ? reserves._reserve1 : reserves._reserve0, decimals1),
    blockTimestamp: reserves._blockTimestampLast,
    decimals: [decimals0, decimals1],
  };
  // reserves.price = (new Decimal(reserves[pair[0]]).div(reserves[pair[1]])).toFixed();
  reserves.price = this.fromWei(this.quote(
    this.toWei('1.0', reserves.decimals[1]),
    this.toWei(reserves[pair[1]], reserves.decimals[1]), // reserveIn
    this.toWei(reserves[pair[0]], reserves.decimals[0]), // reserveOut
  ), reserves.decimals[0]);

  return reserves;
}

LikeWeb3.prototype.sync = function (swap, reserve) {
  // reserve where swap occurred
  let synced = Object.assign({}, reserve);

  // to wei
  synced[swap.path[0]] = this.toWei(synced[swap.path[0]], synced.decimals[0]);
  synced[swap.path[1]] = this.toWei(synced[swap.path[1]], synced.decimals[1]);

  // calculate in and out for liquidity
  let amountIn = this.toWei(swap.amountIn, synced.decimals[0]);
  let amountOut = this.getAmountOut(
    synced.factory,
    amountIn,
    synced[swap.path[0]], // reserveIn
    synced[swap.path[1]], // reserveOut
  );
  swap.amountOut = this.fromWei(amountOut, synced.decimals[1]);
  if (swap.amountOutMin && new Decimal(swap.amountOut).lt(swap.amountOutMin)) {
    throw new Error('sync: amountOut (' + swap.amountOut + ') is less than amountOutMin (' + swap.amountOutMin + ') by ' + new Decimal(swap.amountOutMin).minus(swap.amountOut).toFixed());
  }

  // update liquidity
  synced[swap.path[0]] = new Decimal(synced[swap.path[0]]).add(amountIn).toFixed();

  // update price (+ this must be improved but it's not actually used, just for reference)
  // synced.price = new Decimal(synced[swap.path[0]]).div(synced[swap.path[1]]).toFixed();
  let isFirstWBNB = swap.path[0] === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
  synced.price = this.fromWei(this.quote(
    this.toWei('1.0', synced.decimals[isFirstWBNB ? 1 : 0]),
    synced[isFirstWBNB ? swap.path[1] : swap.path[0]], // reserveIn
    synced[isFirstWBNB ? swap.path[0] : swap.path[1]], // reserveOut
  ), synced.decimals[isFirstWBNB ? 0 : 1]);

  // update percentage change
  synced.changed = new Decimal(synced.price).div(reserve.price).minus(1.0).toFixed();

  // update liquidity
  synced[swap.path[1]] = new Decimal(synced[swap.path[1]]).minus(amountOut).toFixed();

  // from wei
  synced[swap.path[0]] = this.fromWei(synced[swap.path[0]], synced.decimals[0]);
  synced[swap.path[1]] = this.fromWei(synced[swap.path[1]], synced.decimals[1]);

  return synced;
}

LikeWeb3.prototype.quote = function (amountA, reserveA, reserveB) {
  if (!(amountA > 0)) new Error('PancakeLibrary: INSUFFICIENT_AMOUNT');
  if (!(reserveA > 0 && reserveB > 0)) throw new Error('PancakeLibrary: INSUFFICIENT_LIQUIDITY');
  let amountB = new Decimal(new Decimal(amountA).mul(reserveB).toFixed()).div(reserveA).toFixed();
  return this.trunc(amountB);
}

LikeWeb3.prototype.getAmountIn = function (factory, amountOut, reserveIn, reserveOut) {
  if (!(amountOut > 0)) throw new Error('PancakeLibrary: INSUFFICIENT_OUTPUT_AMOUNT');
  if (!(reserveIn > 0 && reserveOut > 0)) throw new Error('PancakeLibrary: INSUFFICIENT_LIQUIDITY');
  let FACTORY = _nameToContract(factory);
  let FEE = new Decimal(FACTORY.fee).mul(1000).toFixed(); // 0.0025 => 2.5
  let numerator = new Decimal(reserveIn).mul(amountOut).mul(1000);
  let denominator = new Decimal(new Decimal(reserveOut).sub(new Decimal(amountOut))).mul(new Decimal(1000).minus(FEE).toFixed()); // 1000 => 997.5
  let amountIn = new Decimal(numerator).div(new Decimal(denominator)).add(1).toFixed();
  return this.trunc(amountIn);
}

LikeWeb3.prototype.getAmountOut = function (factory, amountIn, reserveIn, reserveOut) {
  if (!(amountIn > 0)) throw new Error('PancakeLibrary: INSUFFICIENT_INPUT_AMOUNT');
  if (!(reserveIn > 0 && reserveOut > 0)) throw new Error('PancakeLibrary: INSUFFICIENT_LIQUIDITY');
  let FACTORY = _nameToContract(factory);
  let FEE = new Decimal(FACTORY.fee).mul(1000).toFixed(); // 0.0025 => 2.5
  let amountInWithFee = new Decimal(amountIn).mul(new Decimal(1000).minus(FEE).toFixed()); // 1000 => 997.5
  let numerator = new Decimal(amountInWithFee).mul(reserveOut);
  let denominator = new Decimal(reserveIn).mul(1000).add(new Decimal(amountInWithFee));
  let amountOut = new Decimal(new Decimal(numerator)).div(new Decimal(denominator)).toFixed();
  return this.trunc(amountOut);
}

LikeWeb3.prototype.trunc = function (amount, decimals) {
  decimals = decimals === undefined ? 0 : parseInt(decimals) + 1;
  // + should support Decimal type directly
  let value = amount.toString();
  let decimalPos = value.indexOf('.');
  let substrLength = decimalPos === -1 ? value.length : decimalPos + decimals;
  let trimmed = value.substr(0, substrLength);
  trimmed = isNaN(trimmed) ? 0 : trimmed;
  return trimmed;
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

function parsePrivateKey (privateKey) {
  let has = privateKey.indexOf('0x') === 0 || privateKey.indexOf('0X') === 0;
  return has ? privateKey.slice(2) : privateKey;
}
