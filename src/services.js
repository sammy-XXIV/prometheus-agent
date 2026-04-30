require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function ask(prompt) {
  const r = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  })
  return r.content[0].text
}

module.exports = {
  auditContract: (code) => ask(`You are a smart contract security auditor. Audit this code for vulnerabilities and security issues:\n\n${code}`),
  summarizeWhitepaper: (text) => ask(`Summarize this crypto whitepaper into key points - what it does, tokenomics, team, and risks:\n\n${text}`),
  explainTransaction: (tx) => ask(`Explain this blockchain transaction in plain English:\n\n${tx}`),
  tokenSentiment: (token) => ask(`Analyze market sentiment for ${token}. Give a buy/hold/sell signal with reasoning.`),
  tradingSignal: (data) => ask(`Analyze this market data and provide a trading signal with entry, exit, and stop loss:\n\n${data}`),
  reviewPitch: (pitch) => ask(`You are a top VC. Review this startup pitch and give detailed feedback:\n\n${pitch}`),
  analyzeBusiness: (plan) => ask(`Analyze this business plan. Strengths, weaknesses, opportunities, threats, score out of 10:\n\n${plan}`),
  summarizeContract: (contract) => ask(`Summarize this legal contract in plain English. Highlight key obligations and red flags:\n\n${contract}`),
  competitorAnalysis: (company) => ask(`Do a detailed competitor analysis for ${company}. Main competitors, differentiators, and threats.`),
  writeJobDescription: (role) => ask(`Write a professional compelling job description for: ${role}`),
  writeBlogPost: (topic) => ask(`Write a professional engaging blog post about: ${topic}. Include intro, 3-5 sections with headers, and conclusion.`),
  writeLinkedIn: (topic) => ask(`Write a high performing LinkedIn post about: ${topic}. Engaging, professional, end with a question.`),
  writeColdEmail: (context) => ask(`Write a compelling cold email for: ${context}. Short, personalized, clear call to action.`),
  writeProductDescription: (product) => ask(`Write a compelling product description for: ${product}. Focus on benefits not features.`),
  reviewResume: (resume) => ask(`Review this resume professionally. Give specific feedback on format, content, and what to improve:\n\n${resume}`),
  debugCode: (code) => ask(`Debug this code. Find all bugs, explain what is wrong, and provide the fixed version:\n\n${code}`),
  explainCode: (code) => ask(`Explain this code in plain English. What does it do and how does it work:\n\n${code}`),
  generateSQL: (request) => ask(`Generate an optimized SQL query for: ${request}. Include comments explaining each part.`),
  writeAPIDocs: (api) => ask(`Write professional API documentation for: ${api}. Include endpoints, parameters, examples, and error codes.`),
  generateTests: (code) => ask(`Generate comprehensive unit tests for this code. Cover happy paths, edge cases, and errors:\n\n${code}`),
  summarize: (text) => ask(`Summarize this text concisely and professionally:\n\n${text}`),
  summarizeResearch: (paper) => ask(`Break down this research paper for a non-academic audience. What did they study, find, and why it matters:\n\n${paper}`),
  interpretData: (data) => ask(`Analyze and interpret this data. Find patterns, anomalies, and actionable insights:\n\n${data}`),
  newsSentiment: (news) => ask(`Analyze the sentiment and implications of this news for the market:\n\n${news}`),
  sentiment: async (text) => {
    const r = await ask(`Analyze sentiment. Return only valid JSON with keys: sentiment (positive/negative/neutral), score (0-100), reasoning (one sentence). Text: ${text}`)
    return JSON.parse(r)
  },
  advice: (topic) => ask(`Give concise professional actionable advice on: ${topic}`)
}
