module.exports = {
  walletAddress: '0x9BeD7776262076B016798d6Ee74Dea3a6B1Ac662',
  kiteRpc: 'https://rpc.gokite.ai/',
  port: process.env.PORT || 3000,
  services: {
    summarize: { price: '0.1', description: 'Summarize any text or URL' },
    sentiment: { price: '0.05', description: 'Analyze sentiment of text' },
    advice: { price: '0.2', description: 'Get AI powered advice on any topic' }
  }
}
