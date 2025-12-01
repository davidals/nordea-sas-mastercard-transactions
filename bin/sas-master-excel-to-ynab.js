const puppeteer = require('puppeteer')
const ynab = require('ynab')
const path = require('path')
const os = require('os')

const {
  getTransactionsFromExcel,
  filterTransactionsNotSent,
  buildYnabPayload
} = require('../lib/sas-master-excel-flow')

let browser

async function main() {
  try {
    const { accessToken, budgetId, accountId } = getRequiredArgs(process.argv)
    const ynabApi = new ynab.API(accessToken)

    // Set up download directory
    const downloadPath = path.join(os.homedir(), 'Downloads')
    console.log(`Download directory: ${downloadPath}`)

    browser = await puppeteer.launch({ headless: false })
    console.log('>>> Open BankID and authorise (30s to timeout)')

    // Download and parse Excel file
    const sourceTransactions = await getTransactionsFromExcel(browser, downloadPath)
    console.log(`${sourceTransactions.length} transactions found in Excel file`)

    // Show breakdown by source
    const bySource = {}
    sourceTransactions.forEach(txn => {
      if (!bySource[txn.source]) {
        bySource[txn.source] = 0
      }
      bySource[txn.source]++
    })
    console.log('\nTransactions by source:')
    Object.keys(bySource).forEach(source => {
      console.log(`  ${source}: ${bySource[source]} transactions`)
    })

    // Filter out transactions already in YNAB
    const filteredTransactions = await filterTransactionsNotSent(ynabApi, sourceTransactions, budgetId, accountId)
    console.log(`\n${filteredTransactions.length} new transactions (not yet in YNAB)`)

    if (filteredTransactions.length === 0) {
      console.log('\nNo new transactions to import!')
      return
    }

    // Build YNAB payload
    const ynabPayload = buildYnabPayload(filteredTransactions, accountId)

    // Show sample transactions
    console.log('\nSample transactions to import:')
    filteredTransactions.slice(0, 5).forEach(txn => {
      console.log(`  ${txn.date} | ${txn.payee.padEnd(30)} | ${txn.amount} SEK | ${txn.source}`)
    })

    // Upload to YNAB
    console.log(`\nUploading ${ynabPayload.transactions.length} transactions to YNAB...`)
    await ynabApi.transactions.bulkCreateTransactions(budgetId, ynabPayload)
    console.log(`✓ Successfully added ${ynabPayload.transactions.length} transactions to YNAB`)

  } catch (error) {
    console.error('\nError:', error)
    if (error.error && error.error.detail) {
      console.error('YNAB Error:', error.error.detail)
    }
  } finally {
    if (browser) {
      console.log('\nClosing browser in 3 seconds...')
      await new Promise(resolve => setTimeout(resolve, 3000))
      await browser.close()
    }
  }
}

function getRequiredArgs(args) {
  const accessToken = args[2]
  const budgetId = args[3]
  const accountId = args[4]

  if (!accessToken || !budgetId || !accountId) {
    console.error('Usage: node sas-master-excel-to-ynab.js <ynab_access_token> <budget_id> <account_id>')
    process.exit(1)
  }

  return { accessToken, budgetId, accountId }
}

main()
