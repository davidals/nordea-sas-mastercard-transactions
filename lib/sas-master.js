const puppeteer = require('puppeteer')

async function getSourceTransactions(browser, personNumber, ynabApi = null, budgetId = null, accountId = null) {
  const page = await goToTransactionsPage(browser)
  // const page = await getTransactionsFromLocal(browser)

  // If YNAB parameters are provided, use infinite scroll approach
  if (ynabApi && budgetId && accountId) {
    const transactions = await extractAllTransactionsWithInfiniteScroll(page, ynabApi, budgetId, accountId)
    return transactions
  } else {
    // Fallback to original approach
    const transactions = await extractTransactionsByClicking(page)
    return transactions
  }
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


async function scrollToLoadMoreTransactions(page) {
  // Get current transaction count
  const beforeCount = await page.evaluate(() => {
    const transactionButtons = [...document.querySelectorAll('.MuiListItemButton-root')]
      .filter(el => {
        const text = el.textContent || ''
        return text.match(/\d+,\d{2}\s*kr/) && text.length > 30
      })
    return transactionButtons.length
  })

  // Scroll to bottom of page
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight)
  })

  // Wait for potential new content to load
  await page.waitForTimeout(2000)

  // Check if new transactions loaded
  const afterCount = await page.evaluate(() => {
    const transactionButtons = [...document.querySelectorAll('.MuiListItemButton-root')]
      .filter(el => {
        const text = el.textContent || ''
        return text.match(/\d+,\d{2}\s*kr/) && text.length > 30
      })
    return transactionButtons.length
  })

  return afterCount > beforeCount // Returns true if more transactions loaded
}

async function extractTransactionsByClicking(page, startFromIndex = 0) {

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

  // Filter out transactions we've already processed
  const transactionsToProcess = clickableTransactions.slice(startFromIndex)

  if (transactionsToProcess.length === 0) {
    console.log(`All ${clickableTransactions.length} transactions already processed`)
    return []
  }

  console.log(`Processing transactions ${startFromIndex + 1} to ${clickableTransactions.length} (${transactionsToProcess.length} new)`)

  const transactions = []

  // Click each new transaction and extract details
  for (let i = 0; i < transactionsToProcess.length; i++) {
    const actualIndex = startFromIndex + i // Actual index in the full list
    const elementInfo = clickableTransactions[i]

    try {
      // Click the specific transaction button by actual index
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
      }, actualIndex)

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
        console.log(`✗ Failed to extract transaction ${actualIndex + 1}:`, transactionData?.error || 'Missing required data')
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
      console.log(`✗ Error processing transaction ${actualIndex + 1}:`, error.message)
    }
  }

  console.log(`Successfully extracted ${transactions.length} transactions`)
  return transactions
}

async function extractAllTransactionsWithInfiniteScroll(page, ynabApi, budgetId, accountId) {
  console.log('Getting most recent transaction date from YNAB...')
  const mostRecentYnabDate = await getMostRecentYnabTransactionDate(ynabApi, budgetId, accountId)
  console.log(`Most recent YNAB transaction date: ${mostRecentYnabDate}`)

  let allTransactions = []
  let pageNumber = 1
  let shouldContinue = true
  let lastProcessedIndex = 0 // Track which transactions we've already processed

  while (shouldContinue) {
    console.log(`\nExtracting transactions from page ${pageNumber}...`)

    // Extract only new transactions starting from lastProcessedIndex
    const pageTransactions = await extractTransactionsByClicking(page, lastProcessedIndex)
    console.log(`Found ${pageTransactions.length} new transactions on page ${pageNumber}`)

    if (pageTransactions.length === 0) {
      console.log('No more new transactions found, stopping.')
      break
    }

    // Add transactions to our collection
    allTransactions.push(...pageTransactions)

    // Update the last processed index to current total visible transactions
    const totalVisibleTransactions = await page.evaluate(() => {
      const transactionButtons = [...document.querySelectorAll('.MuiListItemButton-root')]
        .filter(el => {
          const text = el.textContent || ''
          return text.match(/\d+,\d{2}\s*kr/) && text.length > 30
        })
      return transactionButtons.length
    })

    lastProcessedIndex = totalVisibleTransactions

    // Find the earliest (oldest) transaction date on this page
    const earliestDateOnPage = pageTransactions.reduce((earliest, transaction) => {
      const transactionDate = new Date(transaction.date)
      const earliestDate = new Date(earliest)
      return transactionDate < earliestDate ? transaction.date : earliest
    }, pageTransactions[0].date)

    console.log(`Earliest transaction on this page: ${earliestDateOnPage}`)

    // Compare with YNAB's most recent date
    const earliestPageDate = new Date(earliestDateOnPage)
    const ynabMostRecentDate = new Date(mostRecentYnabDate)

    if (earliestPageDate <= ynabMostRecentDate) {
      console.log('Reached transactions that overlap with YNAB, stopping extraction.')
      shouldContinue = false
    } else {
      console.log('All transactions on this page are newer than YNAB, scrolling for more...')

      // Try to scroll and load more transactions
      const moreTransactionsLoaded = await scrollToLoadMoreTransactions(page)

      if (!moreTransactionsLoaded) {
        console.log('No more transactions loaded after scrolling, stopping.')
        shouldContinue = false
      } else {
        console.log('More transactions loaded, continuing to next page...')
        pageNumber++
      }
    }
  }

  console.log(`\nTotal transactions extracted: ${allTransactions.length}`)
  return allTransactions
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

async function filterTransactionsNotSent(ynabApi, transactions, budgetId, accountId) {
  // First, remove any duplicates from the input transactions
  const uniqueTransactions = deduplicateTransactions(transactions)

  if (uniqueTransactions.length < transactions.length) {
    console.log(`Removed ${transactions.length - uniqueTransactions.length} duplicate transactions`)
  }

  const earliestDateUtc = uniqueTransactions.reduce(getEarliestDate, new Date())
  const earliestFullDate = earliestDateUtc.substring(0, earliestDateUtc.indexOf('T'))

  const ynabTransactions = await getYnabTransactions(ynabApi, budgetId, accountId, earliestFullDate)

  const extraTransactions = ynabTransactions.filter(ynabTransaction => isTransactionNotInStatement(ynabTransaction, uniqueTransactions))
  //console.error(extraTransactions)

  return uniqueTransactions.filter(transaction => !isTransactionAlreadyInYnab(transaction, ynabTransactions))
}

function getEarliestDate(earliest, tx) {
  return new Date(earliest) < new Date(tx.date) ? earliest : tx.date
}

async function getYnabTransactions(ynabApi, budgetId, accountId, earliestDate) {
  const transactions = await ynabApi.transactions.getTransactionsByAccount(budgetId, accountId, earliestDate)
  return transactions.data.transactions
}

async function getMostRecentYnabTransactionDate(ynabApi, budgetId, accountId) {
  // Get transactions from the last 35 days to find the most recent one
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 35)
  const earliestDate = ninetyDaysAgo.toISOString().split('T')[0]

  const transactions = await getYnabTransactions(ynabApi, budgetId, accountId, earliestDate)

  if (transactions.length === 0) {
    // If no transactions found, return a date far in the past
    return new Date('1900-01-01').toISOString()
  }

  // Find the most recent transaction date
  const mostRecentDate = transactions.reduce((latest, transaction) => {
    const transactionDate = new Date(transaction.date)
    const latestDate = new Date(latest)
    return transactionDate > latestDate ? transaction.date : latest
  }, transactions[0].date)

  return mostRecentDate
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

function buildYnabPayload(transactions, accountId, allowSendAsCleared = true) {
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
  extractAllTransactionsWithInfiniteScroll,
  filterTransactionsNotSent,
  buildYnabPayload,
}

function parseAmount(amount) {
  return parseFloat(amount.toString().replace('−', '-'))
}

