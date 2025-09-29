const puppeteer = require('puppeteer')

async function getSourceTransactions(browser, personNumber) {
  const page = await goToTransactionsPage(browser)
  // const page = await getTransactionsFromLocal(browser)

  const transactions = await extractTransactionsByClicking(page)

  return transactions
}

async function goToTransactionsPage(browser) {
  const page = await browser.newPage()
  await page.goto('https://my.saseurobonusmastercard.se/nis/mypages/login/', {waitUntil: 'networkidle0'})
  const inputField = await page.$('#login-button-sbid')
  await page.waitForSelector('#login-button-sbid')
  if (inputField) {
    await inputField.click()
  }
  await page.waitForSelector('p[aria-label="Alla kort i kontot SAS EuroBonus MC Premium "]')
  await page.goto('https://my.saseurobonusmastercard.se/nis/mypages/sv-SE/account/4a339e3e84d8ea54-10032/')

  // Wait for transactions to load
  await page.waitForTimeout(1000)

  return page
}

async function getTransactionsFromLocal(browser){
  const page = await browser.newPage()
  await page.goto('file:///Users/davidlino/Downloads/utdrag-mars-2023.mht')
  await page.waitForSelector('#transactionTableContent')
  return page
}


async function extractTransactionsByClicking(page) {

  // Find the main transaction row buttons (the ones that actually open drawers)
  const clickableTransactions = await page.evaluate(() => {
    // Look specifically for the main transaction row buttons
    const transactionButtons = [...document.querySelectorAll('.MuiListItemButton-root')]
      .filter(el => {
        const text = el.textContent || ''
        // Must contain an amount in kr and be substantial content
        return text.match(/\d+,\d{2}\s*kr/) && text.length > 30
      })

    return transactionButtons.map((el, index) => {
      const text = el.textContent.trim()
      const rect = el.getBoundingClientRect()

      return {
        index,
        text: text.substring(0, 60),
        tagName: el.tagName,
        className: el.className,
        x: Math.round(rect.x),
        y: Math.round(rect.y)
      }
    })
  })

  if (clickableTransactions.length === 0) {
    console.log('No clickable transactions found')
    return []
  }

  const transactions = []

  // Click each transaction and extract details
  for (let i = 0; i < clickableTransactions.length; i++) {
    const elementInfo = clickableTransactions[i]

    try {
      // Click the specific transaction button by index
      const clicked = await page.evaluate((index) => {
        const transactionButtons = [...document.querySelectorAll('.MuiListItemButton-root')]
          .filter(el => {
            const text = el.textContent || ''
            return text.match(/\d+,\d{2}\s*kr/) && text.length > 30
          })

        if (transactionButtons[index]) {
          transactionButtons[index].click()
          return { success: true, clickedText: transactionButtons[index].textContent.substring(0, 50) }
        }
        return { success: false, error: 'Element not found' }
      }, i)

      if (!clicked.success) {
        console.log(`   ✗ Failed to click element: ${clicked.error}`)
        continue
      }

      // Wait for the details drawer to appear
      await page.waitForSelector('.MuiDrawer-root', { timeout: 1000 })

      // Check if drawer appeared and get its structure
      const drawerInfo = await page.evaluate(() => {
        const drawer = document.querySelector('.MuiDrawer-root')
        if (!drawer) return { found: false }

        // Debug the drawer structure
        const getElementStructure = (el, depth = 0) => {
          if (depth > 3) return '...'
          const children = Array.from(el.children).map(child =>
            `${child.tagName}.${child.className || 'no-class'}`
          ).join(', ')
          return children
        }

        return {
          found: true,
          structure: getElementStructure(drawer),
          childrenCount: drawer.children.length,
          level1: drawer.children[0] ? getElementStructure(drawer.children[0], 1) : 'none',
          level2: drawer.children[0]?.children[0] ? getElementStructure(drawer.children[0].children[0], 2) : 'none'
        }
      })

      // Extract data from the drawer
      const transactionData = await page.evaluate(() => {
        const drawer = document.querySelector('.MuiDrawer-root')
        if (!drawer) return null

        try {
          // Find the paper element in the drawer
          const paperElement = Array.from(drawer.children).find(child =>
            child.className && child.className.includes('MuiPaper-root')
          )

          if (!paperElement) {
            return { error: 'Could not find paper element in drawer' }
          }

          // Look for h3 elements in the entire paper element
          const h3Elements = paperElement.querySelectorAll('h3')

          if (h3Elements.length < 2) {
            return { error: `Only found ${h3Elements.length} h3 elements, need at least 2 for date and amount` }
          }

          // Date is typically the first h3 element
          const rawDate = h3Elements[0]?.textContent.trim() || null

          // Amount is typically the second h3 element
          const rawAmount = h3Elements[1]?.textContent.replace(/\s*kr$/, '').replace(/\s+/g, '') || null

          // Merchant name from ActionList
          const actionLists = drawer.querySelectorAll('[data-testid="ActionList"]')
          let payee = null

          if (actionLists.length > 1) {
            const merchantSection = actionLists[1]
            const merchantSpan = merchantSection.querySelector('span')
            if (merchantSpan) {
              payee = merchantSpan.textContent.trim()
            }
          }

          // Check if transaction is reserved
          const isCleared = !drawer.textContent.includes('Reserverad')

          return {
            rawDate,
            rawAmount,
            payee,
            isCleared
          }
        } catch (error) {
          return { error: error.message }
        }
      })

      if (transactionData && !transactionData.error && transactionData.rawDate && transactionData.rawAmount && transactionData.payee) {
        const date = formatSwedishDate(transactionData.rawDate)
        const transaction = {
          date,
          isCleared: transactionData.isCleared,
          payee: transactionData.payee,
          amount: transactionData.rawAmount.replace(',', '.')
        }

        transactions.push(transaction)
      } else {
        console.log(`✗ Failed to extract transaction ${i + 1}:`, transactionData?.error || 'Missing required data')
      }

      // Close the drawer
      await page.evaluate(() => {
        const drawer = document.querySelector('.MuiDrawer-root')
        if (drawer) {
          const closeButton = drawer.querySelector('button[type="button"]')
          if (closeButton) {
            closeButton.click()
          }
        }
      })

      // Wait a bit before next transaction
      await page.waitForTimeout(500)

    } catch (error) {
      console.log(`✗ Error processing transaction ${i + 1}:`, error.message)
    }
  }

  console.log(`Successfully extracted ${transactions.length} transactions`)
  return transactions
}

function formatSwedishDate(swedishDate) {
  // Convert "25 september" to proper date format
  const months = {
    'januari': '01', 'februari': '02', 'mars': '03', 'april': '04',
    'maj': '05', 'juni': '06', 'juli': '07', 'augusti': '08',
    'september': '09', 'oktober': '10', 'november': '11', 'december': '12'
  }

  const parts = swedishDate.toLowerCase().split(' ')
  if (parts.length >= 2) {
    const day = parts[0].padStart(2, '0')
    const monthName = parts[1]
    const month = months[monthName]

    if (month) {
      const currentYear = new Date().getFullYear()
      const utcDate = new Date(Date.UTC(currentYear, parseInt(month) - 1, parseInt(day), 0, 0, 0, 0))
      return utcDate.toJSON().toString()
    }
  }

  return new Date().toJSON().toString() // Fallback
}

async function setPersonNumber(personNumber, page) {
  const inputField = await page.$('.id-number-input')
  await inputField.focus()
  await inputField.type(personNumber)
  await inputField.press('Enter')
  await page.waitForSelector('section.overview')
  return page
}

async function filterTransactionsNotSent(ynabApi, transactions, budgetId, accountId) {
  const earliestDateUtc = transactions.reduce(getEarliestDate, new Date())
  const earliestFullDate = earliestDateUtc.substring(0, earliestDateUtc.indexOf('T'))

  const ynabTransactions = await getYnabTransactions(ynabApi, budgetId, accountId, earliestFullDate)

  const extraTransactions = ynabTransactions.filter(ynabTransaction => isTransactionNotInStatement(ynabTransaction, transactions))
  //console.error(extraTransactions)

  return transactions.filter(transaction => !isTransactionAlreadyInYnab(transaction, ynabTransactions))
}

function getEarliestDate(earliest, tx) {
  return new Date(earliest) < new Date(tx.date) ? earliest : tx.date
}

async function getYnabTransactions(ynabApi, budgetId, accountId, earliestDate) {
  const transactions = await ynabApi.transactions.getTransactionsByAccount(budgetId, accountId, earliestDate)
  return transactions.data.transactions
}

function isTransactionNotInStatement(ynabTransaction, transactions) {
  return !isTransactionInStatement(ynabTransaction, transactions)
}

function isTransactionInStatement(ynabTransaction, transactions) {
  return transactions.some(transaction => compareTransactions(transaction, ynabTransaction))
}

function isTransactionAlreadyInYnab(transaction, ynabTransactions) {
  return ynabTransactions.some(ynabTransaction => compareTransactions(transaction, ynabTransaction))
}

function compareTransactions(cardTransaction, ynabTransaction) {
  if (cardTransaction.payee.toLowerCase().startsWith('betalt')) {
    return true
  }

  if (!cardTransaction.isCleared) {
    //Filter out transactions that are not yet cleared
    return true
  }
  const cardTransactionDate = new Date(cardTransaction.date)
  const ynabTransactionDate = new Date(ynabTransaction.date)

  const hasSameDate = 
    cardTransactionDate.getMonth() === ynabTransactionDate.getMonth()
    && cardTransactionDate.getDate() === ynabTransactionDate.getDate()

  const cardTransactionAmount = -1 * parseAmount(cardTransaction.amount)
  const ynabTransactionAmount = parseAmount(ynabTransaction.amount) / 1000

  // Sometimes the ynab amount has a rounding problem, so we fix by looking at the absolute differente
  const hasSameAmount = Math.abs(cardTransactionAmount - ynabTransactionAmount) < 0.001
  const hasSameName = ynabTransaction.payee_name && ynabTransaction.payee_name.toLowerCase() === cardTransaction.payee.toLowerCase()

  return hasSameDate && hasSameName && hasSameAmount
}

function buildYnabPayload(transactions, accountId, allowSendAsCleared = false) {
  return {
    'transactions': transactions.map(transaction => {
      return {
        'account_id': accountId,
        'date': new Date(transaction.date),
        // *-1 since it's an expense, *1000 to convert it to the correct unit
        'amount': Math.trunc(parseAmount(transaction.amount) * -1 * 1000),
        'payee_id': null,
        'payee_name': transaction.payee,
        'category_id': null,
        'memo': null,
        'cleared': (allowSendAsCleared && transaction.isCleared ? 'cleared' : 'uncleared'),
        'approved': false,
        'flag_color': 'orange',
        'import_id': null
      }
    })
  }
}

module.exports = {
  getSourceTransactions,
  filterTransactionsNotSent,
  buildYnabPayload,
}

function parseAmount(amount) {
  return parseFloat(amount.toString().replace('−', '-'))
}

