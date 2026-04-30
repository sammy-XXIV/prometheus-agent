const { exec } = require('child_process')

function getBalance() {
  return new Promise((resolve) => {
    exec('kpass wallet balance --output json', (err, stdout) => {
      try {
        const data = JSON.parse(stdout)
        const usdc = data.assets.find(a => a.symbol === 'USDC')
        resolve(parseFloat(usdc?.balance || 0))
      } catch (e) {
        resolve(0)
      }
    })
  })
}

module.exports = getBalance
