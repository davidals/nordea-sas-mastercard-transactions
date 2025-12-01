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
  // First, remove any duplicates from the input transactions
  const uniqueTransactions = deduplicateTransactions(transactions)

  if (uniqueTransactions.length < transactions.length) {
    console.log(`Removed ${transactions.length - uniqueTransactions.length} duplicate transactions`)
  }

  const earliestDateUtc = uniqueTransactions.reduce(getEarliestDate, new Date())
  const earliestFullDate = earliestDateUtc.substring(0, 10) // Get YYYY-MM-DD

  const ynabTransactions = await getYnabTransactions(ynabApi, budgetId, accountId, earliestFullDate)

  return uniqueTransactions.filter(transaction => !isTransactionAlreadyInYnab(transaction, ynabTransactions))
}

function deduplicateTransactions(transactions) {
  const seen = new Set()
  return transactions.filter(transaction => {
    // Create a unique key based on date, amount, and payee
    const key = `${transaction.date}-${transaction.amount}-${transaction.payee.toLowerCase()}`

    if (seen.has(key)) {
      console.log(`Removing duplicate transaction: ${transaction.payee} ${transaction.amount}kr on ${transaction.date}`)
      return false
    }

    seen.add(key)
    return true
  })
}

function getEarliestDate(earliest, tx) {
  return new Date(earliest) < new Date(tx.date) ? earliest : tx.date
}

async function getYnabTransactions(ynabApi, budgetId, accountId, earliestDate) {
  const transactions = await ynabApi.transactions.getTransactionsByAccount(budgetId, accountId, earliestDate)
  return transactions.data.transactions
}

function isTransactionAlreadyInYnab(transaction, ynabTransactions) {
  return ynabTransactions.some(ynabTransaction => compareTransactions(transaction, ynabTransaction))
}

function compareTransactions(excelTransaction, ynabTransaction) {
  // Skip "BETALT" transactions (payments)
  if (excelTransaction.payee.toLowerCase().startsWith('betalt')) {
    return true
  }

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
  return {
    'transactions': transactions.map(transaction => {
      // Excel format: purchases are positive (money owed), payments are negative (money paid)
      // YNAB format: expenses are negative, income is positive
      // So we flip the sign: Excel positive purchase → YNAB negative expense
      const amount = parseAmount(transaction.amount) * -1

      return {
        'account_id': accountId,
        'date': transaction.date,
        'amount': Math.trunc(amount * 1000), // Convert to milliunits
        'payee_id': null,
        'payee_name': transaction.payee,
        'category_id': null,
        'memo': transaction.source !== 'Account' ? `Card: ${transaction.source}` : null,
        'cleared': transaction.isCleared ? 'cleared' : 'uncleared',
        'approved': false,
        'flag_color': 'orange',
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
