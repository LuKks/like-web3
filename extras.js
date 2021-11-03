

async function bscTransfer ({ currency, amount, from, to, nonce, privateKey }) {
  console.log('bscTransfer', currency, amount);

  if (currency !== 'BNB') {
    return await bscTransferToken({ currency, amount, from, to, nonce, privateKey });
  }

  let transaction = await NewTx({
    from,
    to,
    value: web3.utils.toHex(web3.utils.toWei(amount.toString(), 'ether')),
    nonce: web3.utils.toHex(nonce || (await web3.eth.getTransactionCount(from))),
  });

  return await sendTransaction(transaction, { privateKey });
  /*receipt => {
    blockHash: '0x88b782f587a670e2d565fe16ce5869a86472b804686996115a0f510a3b481180',
    blockNumber: 11913210,
    contractAddress: null,
    cumulativeGasUsed: 1761395,
    from: '0x15ebcb5d08ef70f7bf9d9925fe1b09893d487303',
    gasUsed: 21000,
    logs: [],
    logsBloom: '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    status: true,
    to: '0xba61420f4a50a446193b49a2cb01cadc2490f7a9',
    transactionHash: '0x1f620c4a3f10137a3cd8f37910165e85edbd558addd74c48583414b2c2376076',
    transactionIndex: 11,
    type: '0x0'
  }*/
}

async function bscTransferToken ({ currency, amount, from, to, nonce, privateKey }) {
  console.log('bscTransferToken', { currency, amount, from, to });

  let contract = new web3.eth.Contract(CONTRACTS[currency].abi, CONTRACTS[currency].address, { from });
  let data = contract.methods.transfer(to, web3.utils.toWei(amount.toString())).encodeABI();

  let transaction = await NewTx({
    from,
    to: CONTRACTS[currency].address,
    value: web3.utils.toHex(0),
    data,
    nonce: web3.utils.toHex(nonce || (await web3.eth.getTransactionCount(from))),
  });

  return await sendTransaction(transaction, { privateKey });
  /*receipt => {
    blockHash: '0x2c3af869fb2977d7d82a51a6667d0298866a641459bb46f4c7f021952a0c427b',
    blockNumber: 11916439,
    contractAddress: null,
    cumulativeGasUsed: 25127032,
    from: '0xe2ffc03af891692a0f621170fe52fad084c83a3f',
    gasUsed: 55351,
    logs: [
      {
        address: '0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee',
        topics: [Array],
        data: '0x00000000000000000000000000000000000000000000000000038d7ea4c68000',
        blockNumber: 11916439,
        transactionHash: '0x092a8c38b7cd7ecef9da3ae591e02e107322c41f80e378707af5608ca1c3c791',
        transactionIndex: 3,
        blockHash: '0x2c3af869fb2977d7d82a51a6667d0298866a641459bb46f4c7f021952a0c427b',
        logIndex: 1,
        removed: false,
        id: 'log_543851d2'
      }
    ],
    logsBloom: '0x00000000000000000000000002000000000000000000000002000000000000000000000000000000000000000000000000800000000000000000000200000000000000000000000000000008080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000002000000000000000000000000000000000200000000000000000000000000000000200000000000000000000000000000000000000000000000000000',
    status: true,
    to: '0xed24fc36d5ee211ea25a80239fb8c4cfd80f12ee',
    transactionHash: '0x092a8c38b7cd7ecef9da3ae591e02e107322c41f80e378707af5608ca1c3c791',
    transactionIndex: 3,
    type: '0x0'
  }*/
}

async function bscTransferTokenFrom ({ currency, amount, sender, from, to, nonce, privateKey }) {
  console.log('bscTransferTokenFrom', { currency, amount, sender, from, to });

  let contract = new web3.eth.Contract(CONTRACTS[currency].abi, CONTRACTS[currency].address, { from });
  let data = contract.methods.transferFrom(
    sender,
    to,
    web3.utils.toWei(amount.toString())
  ).encodeABI();

  let transaction = await NewTx({
    from,
    to: CONTRACTS[currency].address,
    value: web3.utils.toHex(0),
    data,
    nonce: web3.utils.toHex(nonce || (await web3.eth.getTransactionCount(from))),
  });

  return await sendTransaction(transaction, { privateKey });
}

// swapExactETHForTokens({ amount: 0.001, fromCurrency: 'WBNB', toCurrency: 'CAKE', from: '0x123', nonce: 1, privateKey: 'hwwwy123' });
async function swapExactETHForTokens ({ amount, fromCurrency, toCurrency, from, nonce, privateKey }, { serialize }) {
  console.log('swapExactETHForTokens', amount, fromCurrency, toCurrency, from, nonce);

  let contract = new web3.eth.Contract(CONTRACTS.PANCAKESWAP_ROUTER.abi, CONTRACTS.PANCAKESWAP_ROUTER.address, { from });
  let value = web3.utils.toHex(web3.utils.toWei(amount.toString(), 'ether'));
  let data = contract.methods.swapExactETHForTokens(
    web3.utils.toHex(0), // amountOutMin // minimum amount of output tokens that must be received for the transaction not to revert
    [CONTRACTS[fromCurrency].address, CONTRACTS[toCurrency].address], // pools for each consecutive pair of addresses must exist and have liquidity.
    from,
    web3.utils.toHex(Math.round(Date.now() / 1000) + 15 * 60), // deadline, unix timestamp after which the transaction will revert
  ).encodeABI();

  let transaction = await NewTx({
    from,
    to: CONTRACTS.PANCAKESWAP_ROUTER.address,
    value,
    data,
    nonce: web3.utils.toHex(nonce || (await web3.eth.getTransactionCount(from))),
  });

  return await sendTransaction(transaction, { privateKey, serialize });
}

async function swapExactTokensForETH ({ amount, fromCurrency, toCurrency, from, nonce, privateKey }, { serialize }) {
  console.log('swapExactTokensForETH', amount, fromCurrency, toCurrency, from, nonce);

  // approve token spend
  let tokenContract = new web3.eth.Contract(CONTRACTS[fromCurrency].abi, CONTRACTS[fromCurrency].address, { from });
  let approveData = tokenContract.methods.approve(
    CONTRACTS.PANCAKESWAP_ROUTER.address,
    web3.utils.toWei('1', 'ether')
  ).encodeABI();

  let transactionApprove = await NewTx({
    from,
    to: CONTRACTS[fromCurrency].address,
    value: web3.utils.toHex(0),
    data: approveData,
    nonce: web3.utils.toHex(nonce || await web3.eth.getTransactionCount(from))
  });
  let broadcastedApprove = await sendTransaction(transactionApprove, { privateKey })
  let resultApprove = await broadcastedApprove.wait();
  console.log('approved', resultApprove);

  // now can swap
  let pancakeContract = new web3.eth.Contract(CONTRACTS.PANCAKESWAP_ROUTER.abi, CONTRACTS.PANCAKESWAP_ROUTER.address, { from });
  // https://ethereum.stackexchange.com/a/99599
  // let data = pancakeContract.methods.swapExactTokensForETHSupportingFeeOnTransferTokens(
  let data = pancakeContract.methods.swapExactTokensForETH(
    web3.utils.toHex(web3.utils.toWei(amount.toString(), 'ether')), // amountIn
    web3.utils.toHex('0'), // amountOutMin
    [CONTRACTS[fromCurrency].address, CONTRACTS[toCurrency].address],
    from,
    web3.utils.toHex(Math.round(Date.now()/1000)+60*20),
  ).encodeABI();

  let transaction = await NewTx({
    from,
    to: CONTRACTS.PANCAKESWAP_ROUTER.address,
    value: web3.utils.toHex(0),
    data,
    nonce: web3.utils.toHex(nonce || await web3.eth.getTransactionCount(from))
  });
  return await sendTransaction(transaction, { privateKey, serialize });
}

async function swapExactTokensForTokens ({ method, amountIn, amountOutMin, fromCurrency, toCurrency, from, nonce, gasPrice, gasLimit, privateKey }, { serialize }) {
  // console.log('swapExactTokensForTokens', method, amountIn, fromCurrency, toCurrency, from, nonce);

  // approve token spend
  /*let transactionApprove = await approveToken({
    currency: fromCurrency,
    from,
    spender: CONTRACTS.PANCAKESWAP_ROUTER.address,
    amount: 1000000000,
    privateKey
  }, { serialize: false });
  let resultApprove = await transactionApprove.wait();
  console.log('approved', resultApprove);*/

  // now can swap
  let pancakeContract = new web3.eth.Contract(CONTRACTS.SIMPLESWAP_ROUTER.abi, CONTRACTS.SIMPLESWAP_ROUTER.address, { from });
  // swapTokensForExactTokens
  let data = pancakeContract.methods[method](
    web3.utils.toHex(amountIn), // amountIn
    web3.utils.toHex(amountOutMin), // amountOutMin
    [fromCurrency, toCurrency],
    CONTRACTS.SIMPLESWAP_ROUTER.address,
    // web3.utils.toHex(Math.round(Date.now() / 1000) + 15 * 60),
  ).encodeABI();

  // console.time('nonce getTransactionCount');
  nonce = web3.utils.toHex(nonce || await web3.eth.getTransactionCount(from));
  // console.timeEnd('nonce getTransactionCount');

  let transaction = await NewTx({
    from,
    to: CONTRACTS.SIMPLESWAP_ROUTER.address,
    value: web3.utils.toHex(0),
    data,
    nonce,
    gasPrice,
    gasLimit
  });

  return {
    send: () => {
      return sendTransaction(transaction, { privateKey, serialize });
    }
  };
}

async function isSwapSafe ({ method, amountIn, amountOutMin, fromCurrency, toCurrency, from, nonce, gasPrice, gasLimit, privateKey }, { serialize }) {
  console.log('isSwapSafe', method, amountIn, fromCurrency, toCurrency, from, nonce);

  // approve token spend
  /*let transactionApprove = await approveToken({
    currency: fromCurrency,
    from,
    spender: CONTRACTS.PANCAKESWAP_ROUTER.address,
    amount: 1000000000,
    privateKey
  }, { serialize: false });
  let resultApprove = await transactionApprove.wait();
  console.log('approved', resultApprove);*/

  // now can swap
  let pancakeContract = new web3.eth.Contract(CONTRACTS.SIMPLESWAP_ROUTER.abi, CONTRACTS.SIMPLESWAP_ROUTER.address, { from });
  // swapTokensForExactTokens
  let data = pancakeContract.methods[method](
    web3.utils.toHex(amountIn), // amountIn
    web3.utils.toHex(amountOutMin), // amountOutMin
    [fromCurrency, toCurrency],
    CONTRACTS.SIMPLESWAP_ROUTER.address,
    // web3.utils.toHex(Math.round(Date.now() / 1000) + 15 * 60),
  ).encodeABI();

  let transaction = await NewTx({
    from,
    to: CONTRACTS.SIMPLESWAP_ROUTER.address,
    value: web3.utils.toHex(0),
    data,
    nonce: web3.utils.toHex(nonce || await web3.eth.getTransactionCount(from)),
    gasPrice,
    gasLimit
  });

  return {
    send: () => {
      return sendTransaction(transaction, { privateKey, serialize });
    }
  };
}

async function allowance ({ currency, sender, spender, from }) {
  let tokenContract = new web3.eth.Contract(CONTRACTS[currency].abi, CONTRACTS[currency].address, { from });
  let allowanceLimit = await tokenContract.methods.allowance(sender, spender).call();
  let decimals = await tokenContract.methods.decimals().call();
  return allowanceLimit / (10 ** decimals);
}

async function approveToken ({ currency, from, spender, amount, nonce, privateKey }, { serialize }) {
  let tokenContract = new web3.eth.Contract(CONTRACTS[currency].abi, CONTRACTS[currency].address, { from });
  let approveData = tokenContract.methods.approve(
    spender,
    web3.utils.toWei(amount.toString(), 'ether')
  ).encodeABI();

  let transaction = await NewTx({
    from,
    to: CONTRACTS[currency].address,
    value: web3.utils.toHex(0),
    data: approveData,
    nonce: web3.utils.toHex(nonce || await web3.eth.getTransactionCount(from))
  });
  return await sendTransaction(transaction, { privateKey, serialize });
}
