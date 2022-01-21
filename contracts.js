const Contracts = require('./contracts.json')

Contracts.add = function (key, props) {
  // support multiple contracts
  if (typeof key === 'object') {
    const list = key
    for (const name in list) {
      Contracts.add(name, list[name])
    }
    return
  }

  if (key === 'add' || key === 'parse') {
    throw new Error('name (' + key + ') is a keyword')
  }

  // support single contract
  const { address, abi, fee } = props

  Contracts[key] = { address, abi }
  if (fee) {
    Contracts[key].fee = fee
  }
}

Contracts.parse = function (contract, abi) {
  if (Contracts[contract]) {
    return Contracts[contract]
  }

  abi = abi || Contracts.GENERIC_TOKEN.abi
  return { abi, address: contract }
}

module.exports = Contracts
