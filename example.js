const Web3 = require('./index.js');

const web3 = new Web3({
  providers: ['wss://bsc-ws-node.nariox.org:443'],
  privateKey: '0x...'
});

(async () => {
  console.log('name', await web3.contract('WBNB').name());
})();
