const path = require('path')
const fs = require('fs')
const { downloadTransactionsExcel } = require('./sas-master-excel')
const { parseExcelTransactions } = require('./sas-master-excel-parser')

async function getTransactionsFromExcel(browser, downloadPath) {
  // Download the Excel file
  const excelPath = await downloadTransactionsExcel(browser, downloadPath)

  if (!excelPath) {
    throw new Error('Failed to download Excel file')
  }

  // Wait a bit to ensure file is fully written
  await new Promise(resolve => setTimeout(resolve, 2000))

  // Find the most recent .xlsx file in the download directory
  const files = fs.readdirSync(downloadPath)
    .filter(f => f.endsWith('.xlsx'))
    .map(f => ({
      name: f,
      path: path.join(downloadPath, f),
      time: fs.statSync(path.join(downloadPath, f)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time)

  if (files.length === 0) {
    throw new Error('No Excel file found in download directory')
  }

  const mostRecentFile = files[0].path
  console.log(`\nParsing Excel file: ${mostRecentFile}`)

  // Parse the Excel file
  const transactions = parseExcelTransactions(mostRecentFile)

  return transactions
}

async function filterTransactionsNotSent(ynabApi, transactions, budgetId, accountId) {
  // Skip "BETALT" transactions (payments)
  const purchases = transactions.filter(t => !t.payee.toLowerCase().startsWith('betalt'))

  const earliestDateUtc = purchases.reduce(getEarliestDate, new Date())
  const earliestFullDate = earliestDateUtc.substring(0, 10) // Get YYYY-MM-DD

  const ynabTransactions = await getYnabTransactions(ynabApi, budgetId, accountId, earliestFullDate)

  // Identical rows (same date, amount and payee) are separate purchases.
  // Each YNAB transaction can match only one Excel row, so if the Excel file has
  // 4 identical rows and YNAB has 1, the other 3 are new.
  const unmatchedYnab = [...ynabTransactions]
  return purchases.filter(transaction => {
    const index = unmatchedYnab.findIndex(ynabTransaction => compareTransactions(transaction, ynabTransaction))
    if (index === -1) {
      return true
    }
    unmatchedYnab.splice(index, 1)
    return false
  })
}

function getEarliestDate(earliest, tx) {
  return new Date(earliest) < new Date(tx.date) ? earliest : tx.date
}

async function getYnabTransactions(ynabApi, budgetId, accountId, earliestDate) {
  const transactions = await ynabApi.transactions.getTransactionsByAccount(budgetId, accountId, earliestDate)
  return transactions.data.transactions
}

function compareTransactions(excelTransaction, ynabTransaction) {
  const excelDate = new Date(excelTransaction.date)
  const ynabDate = new Date(ynabTransaction.date)

  const hasSameDate =
    excelDate.getMonth() === ynabDate.getMonth()
    && excelDate.getDate() === ynabDate.getDate()

  // Excel: purchases are positive, so we multiply by -1 to get the expense amount
  // Then multiply by 1 again to match YNAB's negative expense format
  // Net result: Excel positive → YNAB negative (expense)
  const excelAmount = parseAmount(excelTransaction.amount) * -1
  const ynabAmount = parseAmount(ynabTransaction.amount) / 1000

  // Sometimes the ynab amount has a rounding problem, so we fix by looking at the absolute difference
  const hasSameAmount = Math.abs(excelAmount - ynabAmount) < 0.01
  const hasSameName = ynabTransaction.payee_name && ynabTransaction.payee_name.toLowerCase() === excelTransaction.payee.toLowerCase()

  return hasSameDate && hasSameName && hasSameAmount
}

function buildYnabPayload(transactions, accountId) {
  // Filter out uncleared transactions before building payload
  const clearedTransactions = transactions.filter(t => t.isCleared)

  if (clearedTransactions.length < transactions.length) {
    console.log(`\nFiltered out ${transactions.length - clearedTransactions.length} uncleared transactions`)
  }

  return {
    'transactions': clearedTransactions.map(transaction => {
      // Excel format: purchases are positive (money owed), payments are negative (money paid)
      // YNAB format: expenses are negative, income is positive
      // So we flip the sign: Excel positive purchase → YNAB negative expense
      const amount = parseAmount(transaction.amount) * -1

      // Determine flag color based on source (using cardholder names)
      let flagColor = 'orange' // Default
      const sourceLower = transaction.source.toLowerCase()

      if (transaction.source === 'Account' || sourceLower.includes('övriga händelser')) {
        flagColor = 'blue'
      } else if (sourceLower.includes('anderson') || sourceLower.includes('d sousa')) {
        flagColor = 'green' // David's card
      } else if (sourceLower.includes('karina') || sourceLower.includes('silva')) {
        flagColor = 'purple' // Karina's card
      }

      return {
        'account_id': accountId,
        'date': transaction.date,
        'amount': Math.trunc(amount * 1000), // Convert to milliunits
        'payee_id': null,
        'payee_name': transaction.payee,
        'category_id': null,
        'memo': transaction.source !== 'Account' ? `Card: ${transaction.source}` : null,
        'cleared': 'cleared', // All transactions here are cleared (filtered above)
        'approved': false,
        'flag_color': flagColor,
        'import_id': null
      }
    })
  }
}

function parseAmount(amount) {
  return parseFloat(amount.toString().replace('−', '-').replace(',', '.'))
}

module.exports = {
  getTransactionsFromExcel,
  filterTransactionsNotSent,
  buildYnabPayload
}
